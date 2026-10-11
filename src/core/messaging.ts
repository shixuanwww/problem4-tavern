import type { Message, MessageStatus } from './types.ts';

/**
 * L1「必须正确处理」的四条里，有三条是**消息生命周期规则**（而不是副作用）：
 *   ① 重试不重复插入同一条用户消息
 *   ② 生成中切换会话，结果仍属于发起请求的会话
 *   ③ 刷新打断的生成必须标为中断，不能永远停在「生成中」
 *
 * 题面把这几条点名为硬要求，但它们原先只存在于 `state/store.tsx` 与 `storage/repo.ts`
 * 的函数体里 —— 那两层依赖 React 与 IndexedDB，Node 内置 test runner 碰不到，
 * 于是**一条测试也覆盖不了**。这里把其中**纯判断**的部分抽出来（谁是要重试的锚点、
 * 要丢掉哪些消息、生成收尾到底算 complete 还是 interrupted、启动时怎么修中断），
 * 让 `store` / `repo` 只负责"落库 + dispatch"这两件有副作用的事。
 *
 * ② 的归属判定在 reducer 层（`state/actions.ts`），那里本来就是纯函数，见测试。
 */

/** 会话内消息按 `seq` 升序排列（`Array#sort` 稳定，seq 相同保持原有先后） */
export function orderedSessionMessages(messages: Message[], sessionId: string): Message[] {
  return messages
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.seq - b.seq);
}

export interface RetryPlan {
  /** 重试的锚点：该会话里最后一条 user 消息 —— 它的 id / seq / 正文都**原样复用** */
  anchor: Message;
  /** 锚点之后的所有消息（失败的 assistant 等）要丢掉的 id */
  dropIds: string[];
}

/**
 * 重试计划。返回 `null` 表示"没有可重试的锚点"（该会话里还没有 user 消息）。
 *
 * 🔴 「重试不重复插入同一条用户消息」这条要求就落在这个函数上：重试**只**删锚点之后的
 *    assistant，锚点自己既不在 `dropIds` 里，也不会被重新创建 —— 调用方拿到的是
 *    同一个 `id` 与同一个 `seq`，所以重试前后用户消息的条数恒等。
 */
export function planRetry(messages: Message[], sessionId: string): RetryPlan | null {
  const ordered = orderedSessionMessages(messages, sessionId);
  let anchorIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (ordered[i]?.role === 'user') {
      anchorIndex = i;
      break;
    }
  }
  if (anchorIndex < 0) return null;
  const anchor = ordered[anchorIndex] as Message;
  return { anchor, dropIds: ordered.slice(anchorIndex + 1).map((m) => m.id) };
}

/**
 * 生成收尾的唯一判定（原先内联在 `runGeneration` 的末尾）：
 *  - 正常读到流尾且没被中止 ⇒ `complete`
 *  - 被用户停掉 / 被刷新打断 / 网络中断在流尾之前 ⇒ `interrupted`
 *
 * 🔴 不允许出现"既没 complete 也没 interrupted"的第三条路，否则消息会永远停在
 *    `streaming`（题面点名禁止）。
 */
export function finalStreamStatus(finished: boolean, aborted: boolean): MessageStatus {
  return finished && !aborted ? 'complete' : 'interrupted';
}

/**
 * 启动时的中断修复（原先内联在 `repo.repairInterrupted`）：
 * 刷新会打断正在生成的回复，凡是库里还停在 `streaming` 的消息一律标成 `interrupted`，
 * **保留已经收到的部分正文**（所以是 `{...m, status}`，不是丢记录）。
 */
export function repairStreamingMessages(messages: Message[]): Message[] {
  return messages
    .filter((m) => m.status === 'streaming')
    .map((m) => ({ ...m, status: 'interrupted' as const }));
}
