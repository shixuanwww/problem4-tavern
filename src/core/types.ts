/**
 * 全应用数据契约。
 *
 * 设计原则（答辩要点）：
 *  - 消息上有【两个互相独立】的布尔开关：`uiHidden`（只影响渲染）与 `excluded`（只影响上下文装配）。
 *    「删除」不是第三个标志位，而是真的从 store 里删掉这条记录 —— 三者在数据层就是三种不同的事实。
 *  - 所有可被"回放"的东西都尽量做成纯数据（SendSnapshot 里只有 parts / activations / skipped），
 *    不含任何函数或 DOM 引用，这样快照落库后再读回来仍然完整。
 */

export type Role = 'system' | 'user' | 'assistant';

/** 消息完成状态。interrupted = 被刷新打断，不允许永远停在 streaming。 */
export type MessageStatus = 'complete' | 'streaming' | 'interrupted';

export interface Message {
  id: string;
  sessionId: string;
  role: Role;
  /** 原始正文，含 <tavern-panel> 标签，存储层不做任何清理（渲染时才解析）。 */
  content: string;
  createdAt: number;
  status: MessageStatus;

  /** 只影响渲染：折叠 / 半透明。发给 AI 的内容完全不变。 */
  uiHidden: boolean;
  /** 只影响装配：不参与上下文与扫描集。正文仍在，可随时加回。 */
  excluded: boolean;

  /** 会话内单调递增序号。用于稳定排序 + "重试不重复插入同一条 user 消息"。 */
  seq: number;
  /** 生成该条回复所用的请求快照 id（assistant 消息才有）。 */
  requestId?: string;
}

export interface CharacterCardLite {
  id: string;
  /** ← V2 data.name */
  name: string;
  /** ← V2 data.description */
  description: string;
  /** ← V2 data.first_mes（开场白），也接受 first_message 别名 */
  firstMes: string;
  /** PNG 导入时的原图（可选） */
  avatarDataUrl?: string;
  /** 原始 JSON 全量保留：未支持字段 / 未知 extensions 导出时原样写回。 */
  raw: unknown;
  specVersion?: string;
}

export interface SessionSettings {
  /** 世界书扫描深度 N（默认 4，范围 1–100）。语义：最近 N 条合格历史 + 本次待发送。 */
  scanDepth: number;
  /** 上下文上限（默认 32768）。 */
  contextLimit: number;
  /** 世界书占上下文的比例上限（默认 25，见 README「预算机制是自定的」）。 */
  worldBookBudgetPct: number;
  /** 提醒阈值百分比（默认 80）。 */
  contextWarnPct: number;
  stream: boolean;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  characterCardId?: string;
  worldBookIds: string[];
  presetId?: string;
  settings: SessionSettings;
  /** 会话级自定义变量表（供 {{变量}} 模板展开，等级 4）。 */
  variables?: Record<string, string>;
}

export interface WorldBookEntry {
  /** 稳定 ID：创建即分配，编辑内容不变更。 */
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  /** 优先级，越大越优先；同级按 id 的 ASCII 升序。 */
  priority: number;
}

export interface WorldBook {
  id: string;
  name: string;
  entries: WorldBookEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetModule {
  id: string;
  name: string;
  role: Role;
  /** 可含 {{变量}} */
  content: string;
  enabled: boolean;
  order: number;
  /** 插入位置：系统提示区 / 历史之后（post-history） */
  position: 'system' | 'postHistory';
  template?: boolean;
}

export interface Preset {
  id: string;
  format: string;
  formatVersion: string;
  name: string;
  modules: PresetModule[];
  contextConfig: {
    contextLimit: number;
    scanDepth: number;
    worldBookBudgetPct: number;
    contextWarnPct: number;
  };
  raw?: unknown;
}

/** 世界书激活证据：回答"哪个关键词、哪条消息触发了它"。 */
export interface Activation {
  entryId: string;
  entryName: string;
  reason: 'constant' | 'keyword';
  matchedKey?: string;
  matchedMessageId?: string;
}

/**
 * 未发送原因。
 * ⚠️ `duplicate_id` 是 PLAN §4.10「被丢弃的重复条目必须记入 skipped」所必需、
 *    但 §3 的枚举里没有列出的一个取值 —— 详见 docs/notes-plan-conflicts.md。
 */
export type SkipReason =
  | 'disabled'
  | 'no_keyword_match'
  | 'empty_content'
  | 'budget_exceeded'
  | 'out_of_scan_depth'
  | 'message_excluded'
  | 'message_incomplete'
  | 'duplicate_id';

export interface SkippedEntry {
  entryId: string;
  entryName: string;
  reason: SkipReason;
  /** 判别字段：本行来自世界书条目，还是来自某条被排除在外的消息。 */
  source: 'entry' | 'message';
}

export type SnapshotPartKind =
  | 'persona'
  | 'character'
  | 'preset-system'
  | 'worldbook'
  | 'history'
  | 'pending'
  | 'post-history';

export interface SnapshotPart {
  index: number;
  kind: SnapshotPartKind;
  sourceId?: string;
  label: string;
  content: string;
  tokens: number;
  /**
   * 该部分对应的角色，用于把 parts 还原成真正发给模型的消息数组。
   * ⚠️ PLAN §3 的 SnapshotPart 没有这个字段，但没有它就无法把冻结的快照回放成一次真实请求
   *    （快照回放是题面的硬要求），因此这里做了一处【纯增量的可选字段】补充 —— 见 docs/notes-plan-conflicts.md。
   */
  role?: Role;
}

/** 请求快照：发送后即冻结，后续编辑一律不得改写。 */
export interface RequestSnapshot {
  id: string;
  sessionId: string;
  createdAt: number;
  model: string;
  parts: SnapshotPart[];
  totalTokens: number;
  contextLimit: number;
  activations: Activation[];
  skipped: SkippedEntry[];
  scanDepth: number;
}

export interface StatusPanel {
  kind: 'status';
  raw: string;
  data: Record<string, unknown>;
}
export interface ChoicesPanel {
  kind: 'choices';
  raw: string;
  options: { label: string; text: string }[];
}
export interface ErrorPanel {
  kind: 'error';
  raw: string;
  problem: string;
  panelType?: string;
}

export type PanelBlock = StatusPanel | ChoicesPanel | ErrorPanel;

export interface ParsedMessage {
  segments: ({ kind: 'text'; text: string } | PanelBlock)[];
}

/** 送给模型的最小消息结构（OpenAI 兼容）。 */
export interface ChatMessage {
  role: Role;
  content: string;
}

/** 模型设置面板 / settings store。 */
export interface AppSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  stream: boolean;
  /**
   * 上次打开的会话 id（刷新后据此恢复"停留在哪个会话"）。
   * 会话被删除时不指向任何存在的会话 ⇒ hydrate 时自动回落"最近更新的会话"。
   */
  lastActiveSessionId?: string;
}

export const STORE_NAMES = [
  'sessions',
  'messages',
  'worldbooks',
  'presets',
  'characters',
  'snapshots',
  'settings',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];
