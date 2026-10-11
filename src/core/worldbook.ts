import type { Activation, Message, SkippedEntry, WorldBookEntry } from './types.ts';
import { clampScanDepth } from './tokens.ts';

/**
 * 世界书激活引擎 —— 本题最关键的一块，纯函数，不依赖 DOM / React。
 *
 * 严格按题面 §3「世界书五条规则」实现，并刻意见避开"真 SillyTavern 的印象"：
 *   ① 扫描最近 N 条合格历史 + 本次待发送消息（共 N+1 条参与关键词匹配）；
 *   ② 匹配只在【单条消息正文内】做子串包含，【不跨消息拼接】；
 *   ③ 已启用的常驻条目直接成为候选；禁用条目始终排除；
 *   ④ 不递归扫世界书正文，不扫角色设定 / 提示词模块；
 *   ⑤ 候选按 priority 降序处理，priority 相同按 id 的 ASCII 升序，同一条目最多插入一次。
 *
 * 处理语义（题面未规定，本项目的自定默认值，README 声明）：
 *   处理 = 按优先级降序逐个尝试选中并计入世界书预算；
 *   装不下的 skip('budget_exceeded') 后 continue（继续尝试后面的小条目），不是 break。
 *   ⇒ "先处理的先占预算"正是"处理顺序"有意义的原因。
 */

export interface ActivateInput {
  /** 本会话启用的所有世界书条目（已汇总，可能来自多本世界书）。 */
  entries: WorldBookEntry[];
  /** 该会话全部消息（函数内部会按 seq 升序）。 */
  messages: Message[];
  /** 本次待发送的用户输入。 */
  pendingUserText: string;
  /** 扫描深度 N。 */
  scanDepth: number;
  /** 世界书预算（token）。 */
  budgetTokens: number;
  /** token 估算函数（注入以便单测与 UI 用同一套口径）。 */
  estimate: (text: string) => number;
}

export interface ActivateResult {
  activated: { entry: WorldBookEntry; activation: Activation }[];
  skipped: SkippedEntry[];
  usedTokens: number;
}

/** 扫描集里代表"本次待发送消息"的伪消息 id（不是任何真实消息 id）。 */
export const PENDING_SCAN_ID = '__pending__';

interface ScanItem {
  id: string;
  content: string;
}

/**
 * 在【单条消息】内做关键词包含匹配。
 * 返回第一个命中的 (消息, 关键词)；消息按扫描集顺序（旧 → 新 → pending）遍历。
 * 大小写不敏感；key 先 trim，空串视为无效。
 */
function matchKeyword(
  keys: string[],
  scanSet: ScanItem[],
): { msgId: string; key: string } | null {
  for (const msg of scanSet) {
    const haystack = msg.content.toLowerCase();
    for (const rawKey of keys) {
      const key = rawKey.trim();
      if (key === '') continue;
      if (haystack.includes(key.toLowerCase())) {
        return { msgId: msg.id, key };
      }
    }
  }
  return null;
}

export function activateWorldBook(input: ActivateInput): ActivateResult {
  const { estimate } = input;
  const scanDepth = clampScanDepth(input.scanDepth);

  const ordered = [...input.messages].sort((a, b) => a.seq - b.seq);
  // 合格 = 没被排除出上下文 且 已完成（uiHidden 不影响 —— 隐藏不改变发给 AI 的内容）
  const eligible = ordered.filter((m) => m.excluded === false && m.status === 'complete');

  const recent = eligible.slice(Math.max(0, eligible.length - scanDepth));
  // 被扫描深度截断在外的合格历史 —— 作为"消息级未发送原因"的产出通路
  const truncated = eligible.slice(0, Math.max(0, eligible.length - scanDepth));

  const skipped: SkippedEntry[] = truncated.map((m) => ({
    entryId: m.id,
    entryName: `消息 #${m.seq}`,
    reason: 'out_of_scan_depth',
    source: 'message',
  }));

  const scanSet: ScanItem[] = [
    ...recent.map((m) => ({ id: m.id, content: m.content })),
    { id: PENDING_SCAN_ID, content: input.pendingUserText },
  ];

  const seen = new Set<string>();
  const candidates: { entry: WorldBookEntry; activation: Activation }[] = [];

  for (const entry of input.entries) {
    // 去重：同一条目最多一次；被丢弃者必须记入 skipped，不得静默丢条目
    if (seen.has(entry.id)) {
      skipped.push({
        entryId: entry.id,
        entryName: entry.name,
        reason: 'duplicate_id',
        source: 'entry',
      });
      continue;
    }
    seen.add(entry.id);

    // 规则 3：禁用条目始终排除（优先级最高，压过"常驻"与"关键词命中"）
    if (!entry.enabled) {
      skipped.push({
        entryId: entry.id,
        entryName: entry.name,
        reason: 'disabled',
        source: 'entry',
      });
      continue;
    }

    let activation: Activation;
    if (entry.constant) {
      // 规则 3：已启用的常驻条目直接成为候选
      activation = { entryId: entry.id, entryName: entry.name, reason: 'constant' };
    } else if (entry.keys.length === 0) {
      // 无关键词的非常驻条目不参与（视为永远未命中）
      skipped.push({
        entryId: entry.id,
        entryName: entry.name,
        reason: 'no_keyword_match',
        source: 'entry',
      });
      continue;
    } else {
      const hit = matchKeyword(entry.keys, scanSet);
      if (!hit) {
        skipped.push({
          entryId: entry.id,
          entryName: entry.name,
          reason: 'no_keyword_match',
          source: 'entry',
        });
        continue;
      }
      activation = {
        entryId: entry.id,
        entryName: entry.name,
        reason: 'keyword',
        matchedKey: hit.key,
        matchedMessageId: hit.msgId,
      };
    }

    if (entry.content.trim() === '') {
      skipped.push({
        entryId: entry.id,
        entryName: entry.name,
        reason: 'empty_content',
        source: 'entry',
      });
      continue;
    }

    candidates.push({ entry, activation });
  }

  // 规则 5：priority 降序；同级按 id 的 ASCII 升序（字符串比较 = 码元序，对 ASCII 即字典序）
  candidates.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
    if (a.entry.id < b.entry.id) return -1;
    if (a.entry.id > b.entry.id) return 1;
    return 0;
  });

  const activated: { entry: WorldBookEntry; activation: Activation }[] = [];
  let usedTokens = 0;
  for (const cand of candidates) {
    const t = estimate(cand.entry.content);
    if (usedTokens + t > input.budgetTokens) {
      skipped.push({
        entryId: cand.entry.id,
        entryName: cand.entry.name,
        reason: 'budget_exceeded',
        source: 'entry',
      });
      continue;
    }
    usedTokens += t;
    activated.push(cand);
  }

  return { activated, skipped, usedTokens };
}
