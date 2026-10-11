import { useState } from 'react';
import { useApp } from '../state/store.tsx';
import { ActivationTable, PartList, SkippedTable } from './RequestPreview.tsx';

/**
 * 检查视图 —— 题面要求至少能回答四个问题：
 *   1. 实际发送了哪些内容，顺序是什么？
 *   2. 每部分来自哪条消息 / 哪个模块 / 哪个世界书条目？
 *   3. 哪个关键词、哪条消息触发了世界书？
 *   4. 某条内容为什么没有发送？
 * 另外提供历史快照列表 + 只读回放（"旧快照不变"的可视化验收点）。
 */
export function SnapshotInspector() {
  const { state } = useApp();
  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (!session) return <p className="hint">先选中一个会话。</p>;

  const snapshots = state.snapshots
    .filter((s) => s.sessionId === session.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  const current = snapshots.find((s) => s.id === pickedId) ?? snapshots[0] ?? null;

  return (
    <div className="panel-body">
      {snapshots.length === 0 ? (
        <p className="hint">这个会话还没有发送过请求。发一条消息后再来看。</p>
      ) : (
        <>
          <section className="form-section">
            <h3>历史请求快照（倒序）</h3>
            <p className="hint">快照一旦写入就只读 —— 之后改消息或改设置都不会改写它们。</p>
            <ul className="snapshot-list">
              {snapshots.map((snap) => (
                <li key={snap.id}>
                  <button
                    type="button"
                    className={`snapshot-item ${snap.id === current?.id ? 'is-on' : ''}`}
                    onClick={() => setPickedId(snap.id)}
                  >
                    <span>{formatTime(snap.createdAt)}</span>
                    <span className="snapshot-model">{snap.model || '(未设置模型)'}</span>
                    <span>{snap.totalTokens} tok</span>
                    <span className="hint">N={snap.scanDepth}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {current ? (
            <>
              <div className="stat-row">
                <span>
                  快照 #{current.id.slice(0, 8)} · {formatTime(current.createdAt)}
                </span>
                <span>
                  估算 {current.totalTokens} / {current.contextLimit} tok
                </span>
                <span>扫描深度 N = {current.scanDepth}</span>
                <span className="hint">只读回放</span>
              </div>

              <h4>① 实际发送了哪些内容（按顺序）</h4>
              <h4 className="sub">② 每部分来自哪里（见每行的来源标签）</h4>
              <PartList parts={current.parts} />

              <h4>③ 哪个关键词、哪条消息触发了世界书</h4>
              <ActivationTable activations={current.activations} />

              <h4>④ 为什么有些内容没有发送</h4>
              <SkippedTable skipped={current.skipped} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
