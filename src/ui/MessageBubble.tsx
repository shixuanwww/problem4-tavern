import { useEffect, useRef, useState } from 'react';
import type { Message } from '../core/types.ts';
import { parsePanels } from '../core/panel.ts';
import { PanelRenderer } from './PanelRenderer.tsx';

export interface MessageBubbleProps {
  message: Message;
  selected: boolean;
  editing: boolean;
  onToggleSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, content: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleExcluded: (id: string) => void;
  onDelete: (id: string) => void;
  onChoose: (message: Message, text: string) => void;
}

export function MessageBubble({
  message,
  selected,
  editing,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleHidden,
  onToggleExcluded,
  onDelete,
  onChoose,
}: MessageBubbleProps) {
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(message.content);
      textareaRef.current?.focus();
    }
  }, [editing, message.content]);

  const parsed = parsePanels(message.content);
  const classes = [
    'bubble',
    `bubble-${message.role}`,
    message.uiHidden ? 'is-ui-hidden' : '',
    message.excluded ? 'is-excluded' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // 🔴 `id` 供"检查视图 → 命中消息"的锚点跳转（`#msg-<id>`）；`data-message-id` 供脚本/测试定位
    <article className={classes} id={`msg-${message.id}`} data-message-id={message.id}>
      <header className="bubble-head">
        <label className="bubble-select" title="选中以批量操作">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(message.id)}
            aria-label={`选中第 ${message.seq} 条消息`}
          />
        </label>
        <span className={`role-tag role-${message.role}`}>{roleLabel(message.role)}</span>
        <span className="bubble-seq">#{message.seq}</span>

        {message.excluded ? <span className="chip chip-excluded">未发送给 AI</span> : null}
        {message.uiHidden ? <span className="chip chip-hidden">已隐藏</span> : null}
        {message.status === 'streaming' ? <span className="chip chip-streaming">生成中…</span> : null}
        {message.status === 'interrupted' ? <span className="chip chip-interrupted">已中断</span> : null}

        <span className="bubble-spacer" />

        <div className="bubble-actions">
          {editing ? (
            <>
              <button type="button" className="mini" onClick={() => onSaveEdit(message.id, draft)}>
                保存
              </button>
              <button type="button" className="mini" onClick={onCancelEdit}>
                取消
              </button>
            </>
          ) : (
            <>
              <button type="button" className="mini" onClick={() => onStartEdit(message.id)}>
                编辑
              </button>
              <button type="button" className="mini" onClick={() => onToggleHidden(message.id)}>
                {message.uiHidden ? '取消隐藏' : '隐藏'}
              </button>
              <button type="button" className="mini" onClick={() => onToggleExcluded(message.id)}>
                {message.excluded ? '加回上下文' : '不进上下文'}
              </button>
              <button type="button" className="mini mini-danger" onClick={() => onDelete(message.id)}>
                删除
              </button>
            </>
          )}
        </div>
      </header>

      {editing ? (
        <div className="bubble-edit">
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            编辑消息原文
          </label>
          <textarea
            id={`edit-${message.id}`}
            ref={textareaRef}
            value={draft}
            rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="hint">
            这里编辑的是**原始正文（含 &lt;tavern-panel&gt; 标签）**；改完只影响之后的请求，已发出的快照不会变。
          </p>
        </div>
      ) : (
        <div className="bubble-body">
          {parsed.segments.map((segment, index) =>
            segment.kind === 'text' ? (
              <p className="seg-text" key={`t-${index}`}>
                {segment.text}
              </p>
            ) : (
              <PanelRenderer
                key={`p-${index}`}
                block={segment}
                onChoose={(text) => onChoose(message, text)}
              />
            ),
          )}
        </div>
      )}
    </article>
  );
}

function roleLabel(role: Message['role']): string {
  if (role === 'user') return '我';
  if (role === 'assistant') return 'AI';
  return 'system';
}
