import type {
  AppSettings,
  CharacterCardLite,
  Message,
  Preset,
  RequestSnapshot,
  Session,
  SessionSettings,
  WorldBook,
} from '../core/types.ts';
import { cryptoRandomId } from '../core/assembly.ts';
import { repairStreamingMessages } from '../core/messaging.ts';
import { DEFAULT_CHARACTER } from '../core/defaultCharacter.ts';
import {
  idbBulkPut,
  idbDelete,
  idbDeleteMany,
  idbGet,
  idbGetAll,
  idbGetBySession,
  idbPut,
} from './idb.ts';

/**
 * repo 层：所有落库操作都从这里走，state 层只维护内存镜像。
 *
 * 级联规则（题面只要求 CRUD，这里补齐以免留悬空引用）：
 *  - 删会话 → 级联删它的 messages 与 snapshots
 *  - 删世界书 / 条目 → 由调用方从各 session.worldBookIds 里一并摘掉
 *  - 删预设 → 已绑定该预设的会话不受影响（会话保留自己的 settings 快照）
 */

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  scanDepth: 4,
  contextLimit: 32768,
  worldBookBudgetPct: 25,
  contextWarnPct: 80,
  stream: true,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  stream: true,
};

export const SETTINGS_ID = 'app';

export interface LoadedDb {
  sessions: Session[];
  messages: Message[];
  worldBooks: WorldBook[];
  presets: Preset[];
  characters: CharacterCardLite[];
  snapshots: RequestSnapshot[];
  settings: AppSettings;
}

// ---------------------------------------------------------------- 读取

export async function loadAll(): Promise<LoadedDb> {
  const [sessions, messages, worldBooks, presets, characters, snapshots, settingsRows] =
    await Promise.all([
      idbGetAll<Session>('sessions'),
      idbGetAll<Message>('messages'),
      idbGetAll<WorldBook>('worldbooks'),
      idbGetAll<Preset>('presets'),
      idbGetAll<CharacterCardLite>('characters'),
      idbGetAll<RequestSnapshot>('snapshots'),
      idbGetAll<AppSettings & { id: string }>('settings'),
    ]);

  const stored = settingsRows[0];
  const settings: AppSettings = stored
    ? { baseUrl: stored.baseUrl ?? '', model: stored.model ?? '', apiKey: stored.apiKey ?? '', stream: stored.stream !== false }
    : { ...DEFAULT_APP_SETTINGS };

  return { sessions, messages, worldBooks, presets, characters, snapshots, settings };
}

/**
 * 启动时的"中断修复"：刷新会打断正在生成的回复，
 * 这里把所有还停在 streaming 的消息标成 interrupted（保留已收到的部分文本），
 * 不允许永远停在"生成中"。
 *
 * 判定本身是纯函数（`core/messaging.ts#repairStreamingMessages`）⇒ 可被单测直接覆盖；
 * 本函数只负责"读库 → 批量写回"。
 */
export async function repairInterrupted(): Promise<Message[]> {
  const messages = await idbGetAll<Message>('messages');
  const fixed = repairStreamingMessages(messages);
  if (fixed.length === 0) return [];
  await idbBulkPut('messages', fixed);
  return fixed;
}

// ---------------------------------------------------------------- 写

export async function saveSettings(settings: AppSettings): Promise<void> {
  await idbPut('settings', { id: SETTINGS_ID, ...settings });
}

export async function saveSession(session: Session): Promise<void> {
  await idbPut('sessions', syncUpdatedAt(session));
}

export async function saveMessage(message: Message): Promise<void> {
  await idbPut('messages', message);
}

export async function saveMessages(messages: Message[]): Promise<void> {
  await idbBulkPut('messages', messages);
}

export async function deleteMessage(id: string): Promise<void> {
  await idbDelete('messages', id);
}

export async function deleteMessages(ids: string[]): Promise<void> {
  await idbDeleteMany('messages', ids);
}

export async function saveSnapshot(snapshot: RequestSnapshot): Promise<void> {
  await idbPut('snapshots', snapshot);
}

export async function saveWorldBook(worldBook: WorldBook): Promise<void> {
  await idbPut('worldbooks', { ...worldBook, updatedAt: Date.now() });
}

export async function savePreset(preset: Preset): Promise<void> {
  await idbPut('presets', preset);
}

export async function deletePreset(id: string): Promise<void> {
  await idbDelete('presets', id);
}

export async function saveCharacter(card: CharacterCardLite): Promise<void> {
  await idbPut('characters', card);
}

export async function deleteCharacter(id: string): Promise<void> {
  await idbDelete('characters', id);
}

export async function fetchSessionMessages(sessionId: string): Promise<Message[]> {
  return idbGetBySession<Message>('messages', sessionId);
}

export async function fetchSessionSnapshots(sessionId: string): Promise<RequestSnapshot[]> {
  return idbGetBySession<RequestSnapshot>('snapshots', sessionId);
}

/** 删会话：级联删掉它的消息与快照，不留孤儿记录 */
export async function deleteSessionCascade(sessionId: string): Promise<void> {
  const [messages, snapshots] = await Promise.all([
    idbGetBySession<Message>('messages', sessionId),
    idbGetBySession<RequestSnapshot>('snapshots', sessionId),
  ]);
  await Promise.all([
    idbDeleteMany('messages', messages.map((m) => m.id)),
    idbDeleteMany('snapshots', snapshots.map((s) => s.id)),
    idbDelete('sessions', sessionId),
  ]);
}

/** 删整本世界书：同时把引用它的会话摘干净 */
export async function deleteWorldBookCascade(worldBookId: string): Promise<Session[]> {
  const sessions = await idbGetAll<Session>('sessions');
  const touched = sessions
    .filter((s) => s.worldBookIds.includes(worldBookId))
    .map((s) => ({ ...s, worldBookIds: s.worldBookIds.filter((id) => id !== worldBookId), updatedAt: Date.now() }));
  await Promise.all([idbDelete('worldbooks', worldBookId), idbBulkPut('sessions', touched)]);
  return touched;
}

// ---------------------------------------------------------------- 新建会话

export interface CreateSessionResult {
  session: Session;
  /** 开场白消息（来自绑定的角色卡 firstMes），没有则不插 */
  opening: Message | null;
}

/**
 * 新建会话。
 * 🔴 开场白机制：绑定角色卡 → 立刻插入一条 role='assistant' / status='complete' 的消息。
 *    L1 没有角色卡导入，所以默认绑内置默认角色卡；L3 导入后可换成卡内 first_mes。
 */
export async function createSession(input: {
  title?: string;
  character?: CharacterCardLite;
  settings?: Partial<SessionSettings>;
} = {}): Promise<CreateSessionResult> {
  const now = Date.now();
  const character = input.character ?? DEFAULT_CHARACTER;

  const session: Session = {
    id: cryptoRandomId(),
    title: input.title?.trim() || defaultTitle(),
    createdAt: now,
    updatedAt: now,
    characterCardId: character.id,
    worldBookIds: [],
    settings: { ...DEFAULT_SESSION_SETTINGS, ...(input.settings ?? {}) },
  };

  const opening: Message | null = character.firstMes.trim()
    ? {
        id: cryptoRandomId(),
        sessionId: session.id,
        role: 'assistant',
        content: character.firstMes,
        createdAt: now,
        status: 'complete',
        uiHidden: false,
        excluded: false,
        seq: 1,
      }
    : null;

  // 角色卡本身也落库，这样 L3 的"角色卡管理"能看到它
  await Promise.all([
    idbPut('characters', character),
    idbPut('sessions', session),
    ...(opening ? [idbPut('messages', opening)] : []),
  ]);

  return { session, opening };
}

export async function ensureDefaultCharacter(): Promise<CharacterCardLite> {
  const existing = await idbGet<CharacterCardLite>('characters', DEFAULT_CHARACTER.id);
  if (existing) return existing;
  await idbPut('characters', DEFAULT_CHARACTER);
  return DEFAULT_CHARACTER;
}

function defaultTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `新会话 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function syncUpdatedAt(session: Session): Session {
  return { ...session, updatedAt: Date.now() };
}

// ---------------------------------------------------------------- 会话导出 / 导入

export const SESSION_BUNDLE_FORMAT = 'tavern-lite-session';
export const SESSION_BUNDLE_VERSION = '1.0';

export interface SessionBundle {
  format: string;
  formatVersion: string;
  session: Session;
  messages: Message[];
  snapshots: RequestSnapshot[];
  characterCard?: CharacterCardLite;
  worldBooks?: WorldBook[];
}

export function buildSessionBundle(
  session: Session,
  messages: Message[],
  snapshots: RequestSnapshot[],
  characterCard?: CharacterCardLite,
  worldBooks?: WorldBook[],
): SessionBundle {
  return {
    format: SESSION_BUNDLE_FORMAT,
    formatVersion: SESSION_BUNDLE_VERSION,
    session,
    messages,
    snapshots,
    characterCard,
    worldBooks,
  };
}

export interface BundleCheck {
  ok: boolean;
  error?: string;
  bundle?: SessionBundle;
  /** 目标库里是否已存在同 ID 的会话（存在则 UI 要弹"覆盖 / 创建副本 / 取消"） */
  idConflict?: boolean;
}

export function checkBundle(raw: unknown, existingSessionIds: string[]): BundleCheck {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '文件内容不是 JSON 对象' };
  const obj = raw as Record<string, unknown>;

  if (obj.format !== SESSION_BUNDLE_FORMAT) {
    return {
      ok: false,
      error: `格式标识不匹配：期望 "${SESSION_BUNDLE_FORMAT}"，实际 ${JSON.stringify(obj.format)}`,
    };
  }
  if (obj.formatVersion !== SESSION_BUNDLE_VERSION) {
    return {
      ok: false,
      error: `不支持的格式版本：${JSON.stringify(obj.formatVersion)}（本应用支持 ${SESSION_BUNDLE_VERSION}）`,
    };
  }
  const session = obj.session as Session | undefined;
  if (typeof session !== 'object' || session === null || typeof session.id !== 'string') {
    return { ok: false, error: '缺少合法的 session（至少要有字符串 id）' };
  }
  if (!Array.isArray(obj.messages)) return { ok: false, error: 'messages 必须是数组' };
  if (!Array.isArray(obj.snapshots)) return { ok: false, error: 'snapshots 必须是数组' };

  return {
    ok: true,
    idConflict: existingSessionIds.includes(session.id),
    bundle: {
      format: SESSION_BUNDLE_FORMAT,
      formatVersion: SESSION_BUNDLE_VERSION,
      session,
      messages: obj.messages as Message[],
      snapshots: obj.snapshots as RequestSnapshot[],
      characterCard: obj.characterCard as CharacterCardLite | undefined,
      worldBooks: Array.isArray(obj.worldBooks) ? (obj.worldBooks as WorldBook[]) : undefined,
    },
  };
}

export interface ImportResult {
  session: Session;
  messages: Message[];
  snapshots: RequestSnapshot[];
  characterCard?: CharacterCardLite;
  /**
   * 随包导入的世界书（副本模式下条目 ID 也已重映射）。
   * ⚠️ 原先 `persistImport` 已经把它写进库，却没有放进返回值 —— 调用方拿不到"这次到底导了哪几本"。
   *    这里补上（纯增量字段，不影响既有调用方）。
   */
  worldBooks?: WorldBook[];
  /** 本次导入因为同 ID 而重新分配的映射（旧 ID → 新 ID），供 UI 展示 */
  idMap: Record<string, string>;
}

/**
 * 导入的**纯计划**部分：算出这次要写哪些记录、ID 怎么映射（不碰 IndexedDB）。
 *
 * mode：
 *  - `overwrite`：沿用原 ID，直接覆盖库里的同名资源
 *  - `copy`：所有资源重新分配 ID，标题加「（副本 N）」后缀，引用一次性重写
 *
 * 🔴 固定顺序（先分配新 ID → 用**同一张** `idMap` 一次性重写所有引用 → 最后才写库），
 *    绝不"先改被引用资源再补引用"，否则会留悬空 ID。
 *
 * 抽成纯函数是为了让 L1 的「导入同 ID 时必须区分覆盖 / 创建副本」这条要求在
 * Node 内置 test runner 里能直接断言（见 `tests/l1-behaviors.test.ts`）。
 */
export function planImport(
  bundle: SessionBundle,
  mode: 'overwrite' | 'copy',
  existingTitles: string[],
): ImportResult {
  const idMap: Record<string, string> = {};
  const mapId = (oldId: string): string => {
    if (mode === 'overwrite') return oldId;
    if (!idMap[oldId]) idMap[oldId] = cryptoRandomId();
    return idMap[oldId];
  };

  const newSessionId = mapId(bundle.session.id);
  const session: Session = {
    ...bundle.session,
    id: newSessionId,
    title: mode === 'copy' ? copyTitle(bundle.session.title, existingTitles) : bundle.session.title,
    updatedAt: Date.now(),
    characterCardId: bundle.session.characterCardId
      ? mapId(bundle.session.characterCardId)
      : bundle.session.characterCardId,
    worldBookIds: (bundle.session.worldBookIds ?? []).map((id) => mapId(id)),
  };

  const messages: Message[] = bundle.messages.map((m) => ({
    ...m,
    id: mapId(m.id),
    sessionId: newSessionId,
  }));

  const snapshots: RequestSnapshot[] = bundle.snapshots.map((s) => ({
    ...s,
    id: mapId(s.id),
    sessionId: newSessionId,
  }));

  const characterCard = bundle.characterCard
    ? { ...bundle.characterCard, id: mapId(bundle.characterCard.id) }
    : undefined;

  const worldBooks = bundle.worldBooks?.map((wb) => ({
    ...wb,
    id: mapId(wb.id),
    entries: wb.entries.map((e) => ({ ...e, id: mapId(e.id) })),
  }));

  return { session, messages, snapshots, characterCard, worldBooks, idMap };
}

/** 落库：把 `planImport` 的结果写进 IndexedDB（同一次 Promise.all，无悬空引用） */
export async function persistImport(
  bundle: SessionBundle,
  mode: 'overwrite' | 'copy',
  existingTitles: string[],
): Promise<ImportResult> {
  const plan = planImport(bundle, mode, existingTitles);
  await Promise.all([
    idbPut('sessions', plan.session),
    idbBulkPut('messages', plan.messages),
    idbBulkPut('snapshots', plan.snapshots),
    ...(plan.characterCard ? [idbPut('characters', plan.characterCard)] : []),
    ...(plan.worldBooks ? [idbBulkPut('worldbooks', plan.worldBooks)] : []),
  ]);
  return plan;
}

export function copyTitle(title: string, existingTitles: string[]): string {
  const base = title.replace(/（副本 \d+）$/, '');
  let n = 2;
  let candidate = `${base}（副本 ${n}）`;
  while (existingTitles.includes(candidate)) {
    n += 1;
    candidate = `${base}（副本 ${n}）`;
  }
  return candidate;
}
