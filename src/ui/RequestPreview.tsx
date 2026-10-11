import { useMemo } from 'react';
import type { SnapshotPart, SkipReason } from '../core/types.ts';
import { buildRequest, type BuildRequestResult } from '../core/assembly.ts';
import { useApp, nextSeq } from '../state/store.tsx';

const PART_KIND_LABEL: Record<SnapshotPart['kind'], string> = {
  persona: 'persona',
  character: '角色卡',
  'preset-system': '预设·系统区',
  worldbook: '世界书',
  history: '历史',
  pending: '待发送',
  'post-history': '预设·历史之后',
};

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  disabled: '条目被禁用',
  no_keyword_match: '关键词未命中',
  empty_content: '正文为空',
  budget_exceeded: '超出世界书预算',
  out_of_scan_depth: '超出世界书扫描深度',
  message_excluded: '消息被排除出上下文',
  message_incomplete: '消息未完成（生成中 / 已中断）',
  duplicate_id: '条目 ID 重复被去重',
};

/** 当前会话 + 当前输入框的装配结果（预览与用量提醒共用） */
export function useAssembly(pendingText: string): { session: ReturnType<typeof useApp>['state']['sessions'][number]; built: BuildRequestResult } | null {
  const { state } = useApp();
  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  return useMemo(() => {
    if (!session) return null;
    const messages = state.messages.filter((m) => m.sessionId === session.id);
    const worldBooks = state.worldBooks.filter((wb) => session.worldBookIds.includes(wb.id));
    const preset = state.presets.find((p) => p.id === session.presetId);
    const character = state.characters.find((c) => c.id === session.characterCardId);
    const pendingSeq = nextSeq(state.messages, session.id);
    const built = buildRequest({
      session,
      messages,
      worldBooks,
      preset,
      character,
      pendingUserText: pendingText,
      pendingSeq,
    });
    return { session, built };
  }, [session, state.messages, state.worldBooks, state.presets, state.characters, pendingText]);
}

export function PartList({ parts }: { parts: SnapshotPart[] }) {
  if (parts.length === 0) return <p className="hint">（本次请求没有任何内容）</p>;
  return (
    <ol className="part-list">
      {parts.map((part) => (
        <li className="part-item" key={`${part.index}-${part.sourceId ?? part.kind}`}>
          <div className="part-head">
            <span className="part-index">{part.index + 1}</span>
            <span className={`kind-tag kind-${part.kind}`}>{PART_KIND_LABEL[part.kind]}</span>
            <span className="part-label">{part.label}</span>
            {part.role ? <span className="role-tag role-tag-mini">{part.role}</span> : null}
            <span className="part-tokens">{part.tokens} tok</span>
          </div>
          <details>
            <summary>查看内容</summary>
            <pre className="part-content">{part.content}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function ActivationTable({ activations }: { activations: BuildRequestResult['activations'] }) {
  if (activations.length === 0) return <p className="hint">本次没有世界书条目被激活。</p>;
  return (
    <table className="data-table">
      <caption>哪条世界书条目被激活、被哪个关键词、在哪条消息里触发</caption>
      <thead>
        <tr>
          <th>条目</th>
          <th>原因</th>
          <th>命中关键词</th>
          <th>命中消息</th>
        </tr>
      </thead>
      <tbody>
        {activations.map((a) => (
          <tr key={a.entryId}>
            <td>{a.entryName}</td>
            <td>{a.reason === 'constant' ? '常驻' : '关键词'}</td>
            <td>{a.matchedKey ?? '—'}</td>
            <td>
              {a.matchedMessageId === '__pending__'
                ? '本次待发送消息'
                : a.matchedMessageId
                  ? <a href={`#msg-${a.matchedMessageId}`}>{shortId(a.matchedMessageId)}</a>
                  : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkippedTable({ skipped }: { skipped: BuildRequestResult['skipped'] }) {
  const entries = skipped.filter((s) => s.source === 'entry');
  const messages = skipped.filter((s) => s.source === 'message');
  if (skipped.length === 0) return <p className="hint">没有被跳过的内容。</p>;
  return (
    <>
      {entries.length > 0 ? (
        <table className="data-table">
          <caption>世界书条目级：为什么没被发送</caption>
          <thead>
            <tr>
              <th>条目</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((s) => (
              <tr key={`${s.entryId}-${s.reason}`}>
                <td>{s.entryName}</td>
                <td>{SKIP_REASON_LABEL[s.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {messages.length > 0 ? (
        <table className="data-table">
          <caption>消息级：为什么这条消息没进上下文</caption>
          <thead>
            <tr>
              <th>消息</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((s) => (
              <tr key={`${s.entryId}-${s.reason}`}>
                <td>{s.entryName}</td>
                <td>{SKIP_REASON_LABEL[s.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

export function RequestPreview({ pendingText }: { pendingText: string }) {
  const data = useAssembly(pendingText);
  if (!data) return <p className="hint">先选中一个会话。</p>;
  const { session, built } = data;
  const pct = Math.round((built.totalTokens * 100) / Math.max(1, session.settings.contextLimit));

  return (
    <div className="panel-body">
      <p className="hint">
        <strong>这是预览，不是快照。</strong>点「发送」的那一刻才会把这份装配<strong>冻结</strong>成请求快照；
        冻结之后改消息、改设置都只影响下一次。
      </p>
      <div className="stat-row">
        <span>共 {built.parts.length} 个部分</span>
        <span>估算 {built.totalTokens} tok / {session.settings.contextLimit}（{pct}%）</span>
        <span>扫描深度 N = {session.settings.scanDepth}</span>
      </div>

      <h4>实际会发送的内容（按顺序）</h4>
      <PartList parts={built.parts} />

      <h4>世界书激活证据</h4>
      <ActivationTable activations={built.activations} />

      <h4>未发送的内容与原因</h4>
      <SkippedTable skipped={built.skipped} />
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
