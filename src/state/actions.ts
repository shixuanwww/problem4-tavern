import type {
  AppSettings,
  CharacterCardLite,
  Message,
  Preset,
  RequestSnapshot,
  Session,
  WorldBook,
} from '../core/types.ts';
import type { LoadedDb } from '../storage/repo.ts';
import { DEFAULT_APP_SETTINGS } from '../storage/repo.ts';

/** 内存镜像：React 只读这里，写操作一律先落库再 dispatch */
export interface AppState {
  ready: boolean;
  loadError: string | null;
  sessions: Session[];
  activeSessionId: string | null;
  /** 所有会话的消息都在内存里（本地应用，量级小；查询时按 sessionId 过滤） */
  messages: Message[];
  worldBooks: WorldBook[];
  presets: Preset[];
  characters: CharacterCardLite[];
  snapshots: RequestSnapshot[];
  settings: AppSettings;
  /** sessionId → 正在生成的那条 assistant 消息 id */
  generating: Record<string, string>;
  /** 会话级错误提示（模型失败等），不清空聊天记录 */
  errors: Record<string, string>;
}

export const initialState: AppState = {
  ready: false,
  loadError: null,
  sessions: [],
  activeSessionId: null,
  messages: [],
  worldBooks: [],
  presets: [],
  characters: [],
  snapshots: [],
  settings: { ...DEFAULT_APP_SETTINGS },
  generating: {},
  errors: {},
};

export type Action =
  | { type: 'hydrate'; db: LoadedDb; preferredActiveId?: string | null }
  | { type: 'load/error'; message: string }
  | { type: 'session/upsert'; sessions: Session[] }
  /**
   * 覆盖导入专用：把某个会话连同它的消息与快照**整体替换**成导入包里的内容。
   * 与 `session/upsert` 的区别是它会先丢掉该 sessionId 下的旧 messages / snapshots，
   * 与 `repo.persistImport` 的"覆盖 = 替换"语义保持一致（否则内存里会留下旧消息）。
   */
  | { type: 'session/replace'; session: Session; messages: Message[]; snapshots: RequestSnapshot[] }
  | { type: 'session/remove'; id: string }
  | { type: 'session/activate'; id: string | null }
  | { type: 'message/upsert'; messages: Message[] }
  | { type: 'message/append'; id: string; chunk: string }
  | { type: 'message/remove'; ids: string[] }
  | { type: 'worldbook/upsert'; worldBooks: WorldBook[] }
  | { type: 'worldbook/remove'; id: string }
  | { type: 'worldbook/cascade'; sessions: Session[]; id: string }
  | { type: 'preset/upsert'; presets: Preset[] }
  | { type: 'preset/remove'; id: string }
  | { type: 'character/upsert'; characters: CharacterCardLite[] }
  | { type: 'character/remove'; id: string }
  | { type: 'snapshot/upsert'; snapshots: RequestSnapshot[] }
  | { type: 'settings/set'; settings: AppSettings }
  | { type: 'generating/set'; sessionId: string; messageId: string | null }
  | { type: 'error/set'; sessionId: string; text: string | null };

function upsertById<T extends { id: string }>(list: T[], items: T[]): T[] {
  if (items.length === 0) return list;
  const map = new Map(list.map((item) => [item.id, item]));
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate': {
      const { db } = action;
      const preferred = action.preferredActiveId ?? null;
      const exists = preferred ? db.sessions.some((s) => s.id === preferred) : false;
      const activeSessionId = exists
        ? preferred
        : mostRecent(db.sessions)?.id ?? null;
      return {
        ...state,
        ready: true,
        loadError: null,
        sessions: sortSessions(db.sessions),
        activeSessionId,
        messages: db.messages,
        worldBooks: db.worldBooks,
        presets: db.presets,
        characters: db.characters,
        snapshots: db.snapshots,
        settings: db.settings,
      };
    }

    case 'load/error':
      return { ...state, ready: true, loadError: action.message };

    case 'session/upsert':
      return { ...state, sessions: sortSessions(upsertById(state.sessions, action.sessions)) };

    case 'session/replace': {
      const sessionId = action.session.id;
      return {
        ...state,
        sessions: sortSessions(upsertById(state.sessions, [action.session])),
        messages: [...state.messages.filter((m) => m.sessionId !== sessionId), ...action.messages],
        snapshots: [
          ...state.snapshots.filter((s) => s.sessionId !== sessionId),
          ...action.snapshots,
        ],
      };
    }

    case 'session/remove': {
      const sessions = state.sessions.filter((s) => s.id !== action.id);
      const activeSessionId =
        state.activeSessionId === action.id ? (mostRecent(sessions)?.id ?? null) : state.activeSessionId;
      return {
        ...state,
        sessions,
        activeSessionId,
        messages: state.messages.filter((m) => m.sessionId !== action.id),
        snapshots: state.snapshots.filter((s) => s.sessionId !== action.id),
        generating: withoutKey(state.generating, action.id),
        errors: withoutKey(state.errors, action.id),
      };
    }

    case 'session/activate':
      return { ...state, activeSessionId: action.id };

    case 'message/upsert':
      return { ...state, messages: upsertById(state.messages, action.messages) };

    case 'message/append':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: m.content + action.chunk } : m,
        ),
      };

    case 'message/remove': {
      const drop = new Set(action.ids);
      return { ...state, messages: state.messages.filter((m) => !drop.has(m.id)) };
    }

    case 'worldbook/upsert':
      return { ...state, worldBooks: upsertById(state.worldBooks, action.worldBooks) };

    case 'worldbook/remove':
      return {
        ...state,
        worldBooks: state.worldBooks.filter((w) => w.id !== action.id),
        sessions: state.sessions.map((s) =>
          s.worldBookIds.includes(action.id)
            ? { ...s, worldBookIds: s.worldBookIds.filter((id) => id !== action.id) }
            : s,
        ),
      };

    case 'worldbook/cascade':
      return {
        ...state,
        worldBooks: state.worldBooks.filter((w) => w.id !== action.id),
        sessions: upsertById(state.sessions, action.sessions),
      };

    case 'preset/upsert':
      return { ...state, presets: upsertById(state.presets, action.presets) };

    case 'preset/remove':
      return { ...state, presets: state.presets.filter((p) => p.id !== action.id) };

    case 'character/upsert':
      return { ...state, characters: upsertById(state.characters, action.characters) };

    case 'character/remove':
      return { ...state, characters: state.characters.filter((c) => c.id !== action.id) };

    case 'snapshot/upsert':
      return { ...state, snapshots: upsertById(state.snapshots, action.snapshots) };

    case 'settings/set':
      return { ...state, settings: action.settings };

    case 'generating/set': {
      const generating = { ...state.generating };
      if (action.messageId === null) delete generating[action.sessionId];
      else generating[action.sessionId] = action.messageId;
      return { ...state, generating };
    }

    case 'error/set': {
      const errors = { ...state.errors };
      if (action.text === null) delete errors[action.sessionId];
      else errors[action.sessionId] = action.text;
      return { ...state, errors };
    }

    default:
      return state;
  }
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

function mostRecent(sessions: Session[]): Session | undefined {
  return sortSessions(sessions)[0];
}
