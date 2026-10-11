import { isOverWarnThreshold } from '../core/tokens.ts';

/**
 * 上下文用量条 + "快满了"提醒。
 *
 * 口径（写进 README）：提醒条按**当前待发送内容（实时装配结果）**判定 —— 也就是题面说的
 * "待发送内容达到设置的 80% 时提示"。发送瞬间冻结的快照里也记着当时的 `totalTokens / contextLimit`，
 * 可在「检查视图」里核对；两者用途不同，不互相替代。
 * 提醒条必须带"可处理的消息入口"，点击即把较早的消息选中（随后一键批量"不进上下文"）。
 */
export function UsageBar({
  used,
  limit,
  warnPct,
  onOpenMessages,
}: {
  used: number;
  limit: number;
  warnPct: number;
  onOpenMessages: () => void;
}) {
  const pct = limit > 0 ? Math.round((used * 100) / limit) : 0;
  // 判据用精确比较（不经过四舍五入），避免 79.5% 被显示成 80% 而提前告警
  const over = isOverWarnThreshold(used, limit, warnPct);
  const width = Math.max(0, Math.min(100, pct));

  return (
    <div className={`usage ${over ? 'usage-warn' : ''}`}>
      <div className="usage-track" title={`${used} / ${limit} tokens（估算）`}>
        <div className="usage-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="usage-text">
        上下文 {used.toLocaleString()} / {limit.toLocaleString()}（{pct}%）
        {over ? `　▲ 已到 ${warnPct}%，可以排除较早的消息` : ''}
      </span>
      {over ? (
        <button type="button" className="mini" onClick={onOpenMessages}>
          选中较早的消息
        </button>
      ) : null}
    </div>
  );
}
