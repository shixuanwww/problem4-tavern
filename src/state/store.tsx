import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type {
  AppSettings,
  CharacterCardLite,
  Message,
  MessageStatus,
  Preset,
  Session,
  SessionSettings,
  WorldBook,
} from '../core/types.ts';
import { buildRequest, cryptoRandomId, freezeSnapshot, partsToChat } from '../core/assembly.ts';
import { finalStreamStatus, planRetry } from '../core/messaging.ts';
import { fetchDefaults, streamChat } from '../core/llm.ts';
import * as repo from '../storage/repo.ts';
import type { BundleCheck, SessionBundle } from '../storage/repo.ts';
import { initialState, reducer, type AppState } from './actions.ts';

/** 流式写库节流阈值（PLAN §4.8 / §11：≥500ms 或累计 200 字符写一次） */
const FLUSH_INTERVAL_MS = 500;
const FLUSH_CHARS = 200;

export interface AppActions {
  newSession: (characterId?: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  activateSession: (id: string | null) => void;

  sendMessage: (sessionId: string, text: string) => Promise<void>;
  retryLast: (sessionId: string) => Promise<void>;
  stopGeneration: (sessionId: string) => void;

  editMessage: (id: string, content: string) => Promise<void>;
  setMessageFlags: (ids: string[], patch: { uiHidden?: boolean; excluded?: boolean }) => Promise<void>;
  removeMessages: (ids: string[]) => Promise<void>;

  saveWorldBook: (worldBook: WorldBook) => Promise<void>;
  removeWorldBook: (worldBookId: string) => Promise<void>;
  setSessionWorldBooks: (sessionId: string, worldBookIds: string[]) => Promise<void>;
  savePreset: (preset: Preset) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  attachPreset: (sessionId: string, presetId: string | undefined) => Promise<void>;
  importCharacter: (card: CharacterCardLite) => Promise<void>;
  attachCharacter: (sessionId: string, card: CharacterCardLite) => Promise<void>;

  saveSessionSettings: (sessionId: string, patch: Partial<SessionSettings>) => Promise<void>;
  saveAppSettings: (settings: AppSettings) => Promise<void>;

  exportSession: (sessionId: string) => Promise<void>;
  inspectBundleFile: (file: File) => Promise<BundleCheck>;
  applyImport: (bundle: SessionBundle, mode: 'overwrite' | 'copy') => Promise<void>;
}

interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 <AppProvider> 内部使用');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 异步动作里要读到最新 state，但又不想把它们都做成 useCallback 的依赖（会导致整棵树重建）。
  const stateRef = useRef(state);
  stateRef.current = state;

  /** 正在进行的生成：assistant 消息 id → AbortController */
  const controllers = useRef(new Map<string, AbortController>());
  /**
   * 已被删除的会话。删除会话时级联删消息是异步的，而正在跑的 `runGeneration` 的收尾/节流写库
   * 还在后面 —— 没有这个集合，它会把刚删掉的消息重新写回库里（留下孤儿记录）。
   */
  const removedSessions = useRef(new Set<string>());
  /**
   * 指向 `saveAppSettings` 的 ref。
   * 为什么用 ref 而不是直接引用：`activateSession` / `removeSession` 声明在 `saveAppSettings`
   * **之前**，直接写进依赖数组会在渲染期触发 TDZ（块级作用域变量未初始化）。
   */
  const persistSettings = useRef<(settings: AppSettings) => Promise<void>>(async () => {});

  // ------------------------------------------------------------ 启动加载
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 先修复被刷新打断的生成（不能永远停在 streaming）
        const repaired = await repo.repairInterrupted();
        const db = await repo.loadAll();
        // ensureDefaultCharacter 只写库、不返回给内存镜像 ⇒ 这里手动并进 db，
        // 否则"全新浏览器首次启动"时 state.characters 为空，装配找不到角色卡。
        const defaultCharacter = await repo.ensureDefaultCharacter();
        if (!db.characters.some((c) => c.id === defaultCharacter.id)) {
          db.characters = [...db.characters, defaultCharacter];
        }
        if (cancelled) return;

        if (repaired.length > 0) {
          const map = new Map(db.messages.map((m) => [m.id, m]));
          for (const m of repaired) map.set(m.id, m);
          db.messages = Array.from(map.values());
        }
        // 刷新后恢复到"上次打开的那个会话"（它已被删掉时由 reducer 回落到最近更新的会话）
        dispatch({ type: 'hydrate', db, preferredActiveId: db.settings.lastActiveSessionId ?? null });

        // 从 dev server / static-proxy 取回 .env 里的默认 baseUrl / model 预填设置面板（不含 key）
        const defaults = await fetchDefaults();
        if (defaults && !cancelled) {
          const current = stateRef.current.settings;
          if (!current.baseUrl && !current.model) {
            const next: AppSettings = {
              ...current,
              baseUrl: defaults.baseUrl,
              model: defaults.model,
            };
            await repo.saveSettings(next);
            dispatch({ type: 'settings/set', settings: next });
          }
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'load/error', message: (error as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------ 生成
  const runGeneration = useCallback(
    async (sessionId: string, pendingText: string, pendingSeq: number, extraMessages: Message[]) => {
      const snap = stateRef.current;
      const session = snap.sessions.find((s) => s.id === sessionId);
      if (!session) return;

      // 🔴 配置快照：深拷贝进闭包，流式回调绝不读"最新设置"（生成期间改设置只影响下一次）
      const config: AppSettings = { ...snap.settings };
      const sessionSnapshot: Session = { ...session, settings: { ...session.settings } };

      /**
       * 注意：这里可能把同一条 user 消息传两遍（`snap.messages` 里已有一份 + `extraMessages` 一份）。
       * `buildRequest` 入口会按 id 去重并按 `pendingSeq` 剔除，因此不会重复装配、也不会占两格扫描窗口。
       */
      const messages = [...snap.messages.filter((m) => m.sessionId === sessionId), ...extraMessages];
      const worldBooks = snap.worldBooks.filter((wb) => sessionSnapshot.worldBookIds.includes(wb.id));
      const preset = snap.presets.find((p) => p.id === sessionSnapshot.presetId);
      const character = snap.characters.find((c) => c.id === sessionSnapshot.characterCardId);

      const built = buildRequest({
        session: sessionSnapshot,
        messages,
        worldBooks,
        preset,
        character,
        pendingUserText: pendingText,
        pendingSeq,
      });

      // 发送瞬间冻结快照 —— 之后任何编辑都不许改写它
      const snapshot = freezeSnapshot(sessionSnapshot, config.model, built);
      await repo.saveSnapshot(snapshot);
      dispatch({ type: 'snapshot/upsert', snapshots: [snapshot] });

      const assistant: Message = {
        id: cryptoRandomId(),
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
        uiHidden: false,
        excluded: false,
        seq: pendingSeq + 1,
        requestId: snapshot.id,
      };
      await repo.saveMessage(assistant);
      dispatch({ type: 'message/upsert', messages: [assistant] });
      dispatch({ type: 'generating/set', sessionId, messageId: assistant.id });
      dispatch({ type: 'error/set', sessionId, text: null });

      const controller = new AbortController();
      controllers.current.set(assistant.id, controller);

      let acc = '';
      let lastFlushAt = Date.now();
      let lastFlushLen = 0;
      let finished = false;
      let errorText: string | null = null;

      /**
       * 落库 assistant 消息。
       * 🔴 用内存里**最新的那条**做基底、只覆盖 `content` / `status` —— 否则用户在生成期间
       *    对这条消息做的「隐藏 / 不进上下文」会被收尾写覆盖回原值。
       * 🔴 会话已被删除时直接跳过：级联删除是异步的，写回去只会在库里留孤儿记录。
       */
      const flush = (status: MessageStatus): Promise<void> => {
        if (removedSessions.current.has(sessionId)) return Promise.resolve();
        const current = stateRef.current.messages.find((m) => m.id === assistant.id);
        return repo.saveMessage({ ...(current ?? assistant), content: acc, status });
      };

      try {
        await streamChat(
          {
            settings: config,
            model: config.model,
            messages: partsToChat(built.parts),
            signal: controller.signal,
          },
          {
            onDelta: (chunk) => {
              acc += chunk;
              dispatch({ type: 'message/append', id: assistant.id, chunk });
              const now = Date.now();
              if (now - lastFlushAt >= FLUSH_INTERVAL_MS || acc.length - lastFlushLen >= FLUSH_CHARS) {
                lastFlushAt = now;
                lastFlushLen = acc.length;
                void flush('streaming');
              }
            },
            onDone: (full) => {
              if (full) acc = full;
              finished = true;
            },
            onError: (message) => {
              errorText = message;
            },
          },
        );
      } finally {
        controllers.current.delete(assistant.id);
      }

      if (removedSessions.current.has(sessionId)) return;

      // 统一收尾：complete / interrupted 只在这里判定（规则见 core/messaging.ts）
      const status: MessageStatus = finalStreamStatus(finished, controller.signal.aborted);
      const latest = stateRef.current.messages.find((m) => m.id === assistant.id);
      const finalMessage: Message = { ...(latest ?? assistant), content: acc, status };
      await repo.saveMessage(finalMessage);
      dispatch({ type: 'message/upsert', messages: [finalMessage] });
      dispatch({ type: 'generating/set', sessionId, messageId: null });
      if (errorText) dispatch({ type: 'error/set', sessionId, text: errorText });
    },
    [],
  );

  const sendMessage = useCallback(
    async (sessionId: string, text: string) => {
      if (text.trim() === '') return;
      const snap = stateRef.current;
      const session = snap.sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const seq = nextSeq(snap.messages, sessionId);
      // 🔴 用户消息【入库即 complete 并在入库时分配 seq】；
      //    装配时按 seq === pendingSeq 把它排除，保证它全文只出现在 pending 一次
      const userMessage: Message = {
        id: cryptoRandomId(),
        sessionId,
        role: 'user',
        content: text,
        createdAt: Date.now(),
        status: 'complete',
        uiHidden: false,
        excluded: false,
        seq,
      };
      await repo.saveMessage(userMessage);
      dispatch({ type: 'message/upsert', messages: [userMessage] });

      const updated: Session = { ...session, updatedAt: Date.now() };
      await repo.saveSession(updated);
      dispatch({ type: 'session/upsert', sessions: [updated] });

      await runGeneration(sessionId, text, seq, [userMessage]);
    },
    [runGeneration],
  );

  /**
   * 重试：只重新生成最后一条 assistant 回复。
   * 🔴 绝不再次插入那条 user 消息（seq 与 id 都不变）—— 这是等级 1 的硬要求。
   */
  const retryLast = useCallback(
    async (sessionId: string) => {
      // 锚点与要丢弃的消息由纯函数给出（可被 tests/ 直接覆盖，见 core/messaging.ts）
      const plan = planRetry(stateRef.current.messages, sessionId);
      if (!plan) return;

      if (plan.dropIds.length > 0) {
        await repo.deleteMessages(plan.dropIds);
        dispatch({ type: 'message/remove', ids: plan.dropIds });
      }

      await runGeneration(sessionId, plan.anchor.content, plan.anchor.seq, []);
    },
    [runGeneration],
  );

  const stopGeneration = useCallback((sessionId: string) => {
    const generatingId = stateRef.current.generating[sessionId];
    if (!generatingId) return;
    controllers.current.get(generatingId)?.abort();
  }, []);

  // ------------------------------------------------------------ 会话
  const newSession = useCallback(async (characterId?: string) => {
    const card =
      stateRef.current.characters.find((c) => c.id === characterId) ??
      stateRef.current.characters.find((c) => c.id === 'char-default');
    const created = await repo.createSession({ character: card });
    // 角色卡本身也进内存镜像：全新浏览器首次启动时 characters 可能还是空的
    // （ensureDefaultCharacter 只写库），不补这一步装配就找不到角色卡。
    removedSessions.current.delete(created.session.id);
    dispatch({ type: 'character/upsert', characters: [created.character] });
    dispatch({ type: 'session/upsert', sessions: [created.session] });
    if (created.opening) dispatch({ type: 'message/upsert', messages: [created.opening] });
    dispatch({ type: 'session/activate', id: created.session.id });
    void persistSettings.current({ ...stateRef.current.settings, lastActiveSessionId: created.session.id });
  }, []);

  const renameSession = useCallback(async (id: string, title: string) => {
    const session = stateRef.current.sessions.find((s) => s.id === id);
    if (!session) return;
    const next: Session = { ...session, title: title.trim() || session.title, updatedAt: Date.now() };
    await repo.saveSession(next);
    dispatch({ type: 'session/upsert', sessions: [next] });
  }, []);

  const removeSession = useCallback(async (id: string) => {
    // 先标记"这个会话没了"：正在跑的生成收尾时据此跳过写库（否则会写回刚删掉的消息）
    removedSessions.current.add(id);
    // 会话正在生成 → 先掐掉
    const generatingId = stateRef.current.generating[id];
    if (generatingId) controllers.current.get(generatingId)?.abort();
    await repo.deleteSessionCascade(id);
    dispatch({ type: 'session/remove', id });
    if (stateRef.current.settings.lastActiveSessionId === id) {
      await persistSettings.current({ ...stateRef.current.settings, lastActiveSessionId: undefined });
    }
  }, []);

  /**
   * 切换会话。除了 dispatch，还把"当前会话"落到 settings（IndexedDB）——
   * 刷新后才能真正恢复到上次停留的会话（hydrate 用 `lastActiveSessionId` 作 preferredActiveId）。
   */
  const activateSession = useCallback((id: string | null) => {
    dispatch({ type: 'session/activate', id });
    const settings = stateRef.current.settings;
    if ((settings.lastActiveSessionId ?? null) === (id ?? null)) return;
    void persistSettings.current({ ...settings, lastActiveSessionId: id ?? undefined });
  }, []);

  // ------------------------------------------------------------ 消息三分离

  const setMessageFlags = useCallback(
    async (ids: string[], patch: { uiHidden?: boolean; excluded?: boolean }) => {
      const snap = stateRef.current;
      const idSet = new Set(ids);
      const touched = snap.messages
        .filter((m) => idSet.has(m.id))
        .map((m) => ({ ...m, ...patch }));
      if (touched.length === 0) return;
      await repo.saveMessages(touched);
      dispatch({ type: 'message/upsert', messages: touched });
    },
    [],
  );

  const editMessage = useCallback(async (id: string, content: string) => {
    const message = stateRef.current.messages.find((m) => m.id === id);
    if (!message) return;
    const next: Message = { ...message, content };
    await repo.saveMessage(next);
    dispatch({ type: 'message/upsert', messages: [next] });
  }, []);

  const removeMessages = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await repo.deleteMessages(ids);
    dispatch({ type: 'message/remove', ids });
  }, []);

  // ------------------------------------------------------------ 资源

  const saveWorldBook = useCallback(async (worldBook: WorldBook) => {
    // 先 dispatch 再落盘：受控输入框必须立刻拿到新 value，否则 IME 组合输入
    // （中文拼音）会在等待 IndexedDB 写入期间被旧 value 打断，字母漏进文本框。
    dispatch({ type: 'worldbook/upsert', worldBooks: [{ ...worldBook, updatedAt: Date.now() }] });
    try {
      await repo.saveWorldBook(worldBook);
    } catch (error) {
      console.error('世界书落盘失败（界面已更新）', error);
    }
  }, []);

  const removeWorldBook = useCallback(async (worldBookId: string) => {
    const touched = await repo.deleteWorldBookCascade(worldBookId);
    dispatch({ type: 'worldbook/cascade', id: worldBookId, sessions: touched });
  }, []);

  const setSessionWorldBooks = useCallback(async (sessionId: string, worldBookIds: string[]) => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const next: Session = { ...session, worldBookIds, updatedAt: Date.now() };
    await repo.saveSession(next);
    dispatch({ type: 'session/upsert', sessions: [next] });
  }, []);

  const savePreset = useCallback(async (preset: Preset) => {
    // 同 saveWorldBook：先 dispatch 再落盘，避免 IME 组合输入被打断。
    dispatch({ type: 'preset/upsert', presets: [preset] });
    try {
      await repo.savePreset(preset);
    } catch (error) {
      console.error('预设落盘失败（界面已更新）', error);
    }
  }, []);

  const removePreset = useCallback(async (id: string) => {
    await repo.deletePreset(id);
    dispatch({ type: 'preset/remove', id });
  }, []);

  const attachPreset = useCallback(async (sessionId: string, presetId: string | undefined) => {
    const snap = stateRef.current;
    const session = snap.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    // 预设的 contextConfig 只作【初值】：仅在会话当前没有该预设时写入一次
    const preset = presetId ? snap.presets.find((p) => p.id === presetId) : undefined;
    const settings: SessionSettings = preset
      ? {
          ...session.settings,
          contextLimit: preset.contextConfig.contextLimit,
          scanDepth: preset.contextConfig.scanDepth,
          worldBookBudgetPct: preset.contextConfig.worldBookBudgetPct,
          contextWarnPct: preset.contextConfig.contextWarnPct,
        }
      : session.settings;
    const next: Session = { ...session, presetId, settings, updatedAt: Date.now() };
    await repo.saveSession(next);
    dispatch({ type: 'session/upsert', sessions: [next] });
  }, []);

  const importCharacter = useCallback(async (card: CharacterCardLite) => {
    await repo.saveCharacter(card);
    dispatch({ type: 'character/upsert', characters: [card] });
  }, []);

  const attachCharacter = useCallback(async (sessionId: string, card: CharacterCardLite) => {
    const snap = stateRef.current;
    const session = snap.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    await repo.saveCharacter(card);
    const next: Session = { ...session, characterCardId: card.id, updatedAt: Date.now() };
    await repo.saveSession(next);
    dispatch({ type: 'character/upsert', characters: [card] });
    dispatch({ type: 'session/upsert', sessions: [next] });
  }, []);

  const saveSessionSettings = useCallback(async (sessionId: string, patch: Partial<SessionSettings>) => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const next: Session = {
      ...session,
      settings: { ...session.settings, ...patch },
      updatedAt: Date.now(),
    };
    await repo.saveSession(next);
    dispatch({ type: 'session/upsert', sessions: [next] });
  }, []);

  const saveAppSettings = useCallback(async (settings: AppSettings) => {
    await repo.saveSettings(settings);
    dispatch({ type: 'settings/set', settings });
  }, []);
  // 让声明在前面的 activateSession / removeSession 也能落到这份实现（见 persistSettings 的注释）
  persistSettings.current = saveAppSettings;

  // ------------------------------------------------------------ 导出 / 导入

  const exportSession = useCallback(async (sessionId: string) => {
    const snap = stateRef.current;
    const session = snap.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const bundle = repo.buildSessionBundle(
      session,
      snap.messages.filter((m) => m.sessionId === sessionId),
      snap.snapshots.filter((s) => s.sessionId === sessionId),
      snap.characters.find((c) => c.id === session.characterCardId),
      snap.worldBooks.filter((wb) => session.worldBookIds.includes(wb.id)),
    );
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFileName(session.title)}-${stamp()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const inspectBundleFile = useCallback(async (file: File): Promise<BundleCheck> => {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: `JSON 语法错误：${(error as Error).message}` };
    }
    // 五类资源的同 ID 冲突都要报（覆盖模式下它们都会被替换，只在会话 ID 上判断会漏）
    const snap = stateRef.current;
    return repo.checkBundle(raw, snap.sessions.map((s) => s.id), {
      messages: snap.messages.map((m) => m.id),
      snapshots: snap.snapshots.map((s) => s.id),
      worldBooks: snap.worldBooks.map((w) => w.id),
      characters: snap.characters.map((c) => c.id),
    });
  }, []);

  const applyImport = useCallback(async (bundle: SessionBundle, mode: 'overwrite' | 'copy') => {
    const result = await repo.persistImport(
      bundle,
      mode,
      stateRef.current.sessions.map((s) => s.title),
    );
    // 导入的会话 ID 可能刚好是刚被删掉的那个 ⇒ 清掉"已删除"标记，别把后续生成挡掉
    removedSessions.current.delete(result.session.id);
    if (mode === 'overwrite') {
      // 覆盖 = 整体替换（与 repo.persistImport 的语义一致），不能只 upsert 让新旧消息混在一起
      dispatch({
        type: 'session/replace',
        session: result.session,
        messages: result.messages,
        snapshots: result.snapshots,
      });
    } else {
      dispatch({ type: 'session/upsert', sessions: [result.session] });
      if (result.messages.length > 0) dispatch({ type: 'message/upsert', messages: result.messages });
      if (result.snapshots.length > 0) dispatch({ type: 'snapshot/upsert', snapshots: result.snapshots });
    }
    if (result.characterCard) dispatch({ type: 'character/upsert', characters: [result.characterCard] });
    // 🔴 随包导入的世界书必须进内存镜像，否则会话引用了它们却不生效（刷新后才出现）
    if (result.worldBooks && result.worldBooks.length > 0) {
      dispatch({ type: 'worldbook/upsert', worldBooks: result.worldBooks });
    }
    dispatch({ type: 'session/activate', id: result.session.id });
    void persistSettings.current({ ...stateRef.current.settings, lastActiveSessionId: result.session.id });
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      newSession,
      renameSession,
      removeSession,
      activateSession,
      sendMessage,
      retryLast,
      stopGeneration,
      editMessage,
      setMessageFlags,
      removeMessages,
      saveWorldBook,
      removeWorldBook,
      setSessionWorldBooks,
      savePreset,
      removePreset,
      attachPreset,
      importCharacter,
      attachCharacter,
      saveSessionSettings,
      saveAppSettings,
      exportSession,
      inspectBundleFile,
      applyImport,
    }),
    [
      newSession,
      renameSession,
      removeSession,
      activateSession,
      sendMessage,
      retryLast,
      stopGeneration,
      editMessage,
      setMessageFlags,
      removeMessages,
      saveWorldBook,
      removeWorldBook,
      setSessionWorldBooks,
      savePreset,
      removePreset,
      attachPreset,
      importCharacter,
      attachCharacter,
      saveSessionSettings,
      saveAppSettings,
      exportSession,
      inspectBundleFile,
      applyImport,
    ],
  );

  const value = useMemo<AppContextValue>(() => ({ state, actions }), [state, actions]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function nextSeq(messages: Message[], sessionId: string): number {
  let max = 0;
  for (const m of messages) {
    if (m.sessionId === sessionId && m.seq > max) max = m.seq;
  }
  return max + 1;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'session';
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
