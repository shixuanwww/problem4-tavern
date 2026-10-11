/**
 * 上下文用量条 + "快满了"提醒。
 *
 * 口径（写进 README）：预览时的百分比只是【预估】；真正判定以发送瞬间冻结的快照为准。
 * 提醒条必须带"可处理的消息入口"，点击打开批量面板。
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
  const over = limit > 0 && pct >= warnPct;
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
          去处理消息
        </button>
      ) : null}
    </div>
  );
}
