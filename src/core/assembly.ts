import type {
  Activation,
  ChatMessage,
  Message,
  Preset,
  PresetModule,
  RequestSnapshot,
  Session,
  SkippedEntry,
  SnapshotPart,
  WorldBook,
  WorldBookEntry,
  CharacterCardLite,
} from './types.ts';
import { estimate, worldBookBudget } from './tokens.ts';
import { activateWorldBook } from './worldbook.ts';
import { expandTemplate } from './template.ts';

/**
 * 上下文装配 buildRequest() —— 纯函数。
 *
 * 装配顺序（题面未规定，本项目自定义并在 README 声明）：
 *   1. character     角色卡：名称 + 描述
 *   2. preset-system 预设中 position='system' 且 enabled 的模块，按 order 升序
 *   3. worldbook     世界书激活内容（拼为一个部分，每条一行）
 *   4. history       status==='complete' && excluded===false，按 seq 升序，再排除 seq===pendingSeq 的那条
 *   5. pending       本次待发送的用户输入（全文只在此出现一次）
 *   6. post-history  预设中 position='postHistory' 且 enabled 的模块
 *
 * 参与装配的消息必须【同时】满足 excluded===false 且 status==='complete'。
 * uiHidden 不参与任何过滤 —— 这是题面明确要求的"隐藏显示不改变发给 AI 的内容"。
 */

export interface BuildRequestInput {
  session: Session;
  messages: Message[];
  worldBooks: WorldBook[];
  preset?: Preset;
  character?: CharacterCardLite;
  pendingUserText: string;
  pendingSeq: number;
  /** 模板变量表（等级 4）：char 由角色卡注入，其余来自会话自定义变量。 */
  variables?: Record<string, string>;
}

export interface BuildRequestResult {
  parts: SnapshotPart[];
  activations: Activation[];
  skipped: SkippedEntry[];
  totalTokens: number;
}

function byOrderThenId(a: PresetModule, b: PresetModule): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function buildRequest(input: BuildRequestInput): BuildRequestResult {
  const { session, messages, worldBooks, preset, character } = input;
  const parts: SnapshotPart[] = [];
  const skipped: SkippedEntry[] = [];
  let cursor = 0;

  const push = (part: Omit<SnapshotPart, 'index'>): void => {
    parts.push({ index: cursor, ...part });
    cursor += 1;
  };

  const vars: Record<string, string> = { char: character?.name ?? '', ...(session.variables ?? {}), ...(input.variables ?? {}) };
  const renderModule = (m: PresetModule): string =>
    m.template ? expandTemplate(m.content, vars).text : m.content;

  /**
   * 🔴 装配入口先做两件归一化，保证"预览"与"真实发送"看到的是同一份消息集合：
   *  1) **按 id 去重**：调用方可能把同一条消息既从 state.messages 又从 extraMessages 传进来
   *     （见 state/store.tsx 的 runGeneration）。同 id 只保留一份，否则它会占掉两格扫描窗口。
   *  2) **剔除本次待发送的那条 user 消息**：它已经入库（seq === pendingSeq），但语义上属于
   *     "本次待发送"，只在 pending 部分出现一次；**也不再参与世界书扫描集的历史部分** ——
   *     否则它会挤掉一格扫描窗口，导致"预览里激活、真正发送时不激活"的静默不一致。
   */
  const ordered = [...new Map(messages.map((m) => [m.id, m])).values()].sort((a, b) => a.seq - b.seq);
  const contextMessages = ordered.filter((m) => m.seq !== input.pendingSeq);

  // ---- 1. character -------------------------------------------------------
  if (character) {
    const content = character.description
      ? `${character.name}\n${character.description}`
      : character.name;
    push({
      kind: 'character',
      sourceId: character.id,
      label: `角色卡「${character.name}」`,
      content,
      tokens: estimate(content),
      role: 'system',
    });
  }

  // ---- 2. preset-system ---------------------------------------------------
  const enabledModules = (preset?.modules ?? []).filter((m) => m.enabled).sort(byOrderThenId);
  for (const m of enabledModules) {
    if (m.position !== 'system') continue;
    const content = renderModule(m);
    push({
      kind: 'preset-system',
      sourceId: m.id,
      label: `预设模块「${m.name}」`,
      content,
      tokens: estimate(content),
      role: m.role,
    });
  }

  // ---- 3. worldbook -------------------------------------------------------
  const entryOwner = new Map<string, string>();
  const flatEntries: WorldBookEntry[] = [];
  for (const wb of worldBooks) {
    for (const e of wb.entries) {
      if (!entryOwner.has(e.id)) entryOwner.set(e.id, wb.name);
      flatEntries.push(e);
    }
  }

  const wb = activateWorldBook({
    entries: flatEntries,
    messages: contextMessages,
    pendingUserText: input.pendingUserText,
    scanDepth: session.settings.scanDepth,
    budgetTokens: worldBookBudget(session.settings.contextLimit, session.settings.worldBookBudgetPct),
    estimate,
  });

  const budgetSkipped = wb.skipped.filter((s) => s.reason === 'budget_exceeded').length;

  if (wb.activated.length > 0 || budgetSkipped > 0) {
    const names = wb.activated.map(
      (a) => `世界书「${entryOwner.get(a.entry.id) ?? '?'}」/ 条目「${a.entry.name}」`,
    );
    let content = wb.activated.map((a) => a.entry.content).join('\n');
    if (budgetSkipped > 0) {
      // ⚠️ 按 PLAN §4.4 / §11 原文，预算标记追加在 worldbook 部分末尾（可观测性优先）。
      const marker = `（世界书预算已满，共 ${budgetSkipped} 条未插入）`;
      content = content ? `${content}\n${marker}` : marker;
    }
    push({
      kind: 'worldbook',
      label: names.length > 0 ? `世界书激活内容（${names.join('、')}）` : '世界书激活内容（0 条）',
      content,
      tokens: estimate(content),
    });
  }

  // ---- 4. history ---------------------------------------------------------
  for (const msg of contextMessages) {
    if (msg.excluded) continue;
    if (msg.status !== 'complete') continue;
    push({
      kind: 'history',
      sourceId: msg.id,
      label: `历史 #${msg.seq} · ${msg.role}`,
      content: msg.content,
      tokens: estimate(msg.content),
      role: msg.role,
    });
  }

  // ---- 5. pending ---------------------------------------------------------
  if (input.pendingUserText !== '') {
    push({
      kind: 'pending',
      sourceId: undefined,
      label: '本次待发送（user）',
      content: input.pendingUserText,
      tokens: estimate(input.pendingUserText),
      role: 'user',
    });
  }

  // ---- 6. post-history ----------------------------------------------------
  for (const m of enabledModules) {
    if (m.position !== 'postHistory') continue;
    const content = renderModule(m);
    push({
      kind: 'post-history',
      sourceId: m.id,
      label: `预设模块「${m.name}」（历史之后）`,
      content,
      tokens: estimate(content),
      role: m.role,
    });
  }

  // ---- 消息级未发送原因（检查视图据此回答"这条为什么没发送"）-----------------
  for (const msg of ordered) {
    if (msg.excluded) {
      skipped.push({
        entryId: msg.id,
        entryName: `消息 #${msg.seq}`,
        reason: 'message_excluded',
        source: 'message',
      });
    } else if (msg.status !== 'complete') {
      skipped.push({
        entryId: msg.id,
        entryName: `消息 #${msg.seq}`,
        reason: 'message_incomplete',
        source: 'message',
      });
    }
  }

  const allSkipped: SkippedEntry[] = [...wb.skipped, ...skipped];
  const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);

  return {
    parts,
    activations: wb.activated.map((a) => a.activation),
    skipped: allSkipped,
    totalTokens,
  };
}

/** 把冻结的 parts 还原成真正发给模型的消息数组（快照回放 / 正式发送共用）。 */
export function partsToChat(parts: SnapshotPart[]): ChatMessage[] {
  return parts
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ role: p.role ?? 'system', content: p.content }));
}

/** 由一次装配结果冻结成请求快照（发送瞬间调用一次，之后只读）。 */
export function freezeSnapshot(
  session: Session,
  model: string,
  built: BuildRequestResult,
  now: number = Date.now(),
  id: string = cryptoRandomId(),
): RequestSnapshot {
  return {
    id,
    sessionId: session.id,
    createdAt: now,
    model,
    parts: built.parts.map((p) => ({ ...p })),
    totalTokens: built.totalTokens,
    contextLimit: session.settings.contextLimit,
    activations: built.activations.map((a) => ({ ...a })),
    skipped: built.skipped.map((s) => ({ ...s })),
    scanDepth: session.settings.scanDepth,
  };
}

export function cryptoRandomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
