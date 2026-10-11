import type { Message, Role } from '../core/types.ts';

export function MessageToolbar({
  messages,
  selected,
  showHidden,
  onToggleShowHidden,
  onSelectAll,
  onSelectNone,
  onSelectByRole,
  onBatchHidden,
  onBatchExcluded,
  onBatchDelete,
}: {
  messages: Message[];
  selected: Set<string>;
  showHidden: boolean;
  onToggleShowHidden: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectByRole: (role: Role) => void;
  onBatchHidden: (hidden: boolean) => void;
  onBatchExcluded: (excluded: boolean) => void;
  onBatchDelete: () => void;
}) {
  const count = selected.size;
  const disabled = count === 0;

  return (
    <div className="toolbar" role="toolbar" aria-label="消息批量操作">
      <label className="toggle">
        <input type="checkbox" checked={showHidden} onChange={onToggleShowHidden} />
        显示已隐藏消息
      </label>

      <span className="toolbar-sep" aria-hidden="true" />

      <button type="button" className="mini" onClick={onSelectAll}>
        全选（{messages.length}）
      </button>
      <button type="button" className="mini" onClick={onSelectNone} disabled={disabled}>
        取消选择
      </button>
      <button type="button" className="mini" onClick={() => onSelectByRole('user')}>
        只选用户消息
      </button>
      <button type="button" className="mini" onClick={() => onSelectByRole('assistant')}>
        只选 AI 消息
      </button>

      <span className="toolbar-sep" aria-hidden="true" />

      <span className="toolbar-count">已选 {count}</span>
      <button type="button" className="mini" onClick={() => onBatchHidden(true)} disabled={disabled}>
        批量隐藏
      </button>
      <button type="button" className="mini" onClick={() => onBatchHidden(false)} disabled={disabled}>
        取消隐藏
      </button>
      <button type="button" className="mini" onClick={() => onBatchExcluded(true)} disabled={disabled}>
        批量不进上下文
      </button>
      <button type="button" className="mini" onClick={() => onBatchExcluded(false)} disabled={disabled}>
        批量加回上下文
      </button>
      <button type="button" className="mini mini-danger" onClick={onBatchDelete} disabled={disabled}>
        批量删除
      </button>
    </div>
  );
}
