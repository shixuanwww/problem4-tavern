import type { PanelBlock } from '../core/types.ts';

/**
 * <tavern-panel> 渲染。
 *
 * 两条铁律：
 *  1) 解析失败时【保留原文】并把问题说清楚（不用 React 之外的手段渲染，避免 LLM 输出被当代码执行）。
 *  2) 状态栏字段名不写死 —— 遍历 data 的键值对渲染，只对常见键（hp 等）做样式增强。
 */

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function numericHp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function PanelRenderer({
  block,
  onChoose,
}: {
  block: PanelBlock;
  onChoose: (text: string) => void;
}) {
  if (block.kind === 'status') {
    const entries = Object.entries(block.data);
    return (
      <div className="panel panel-status">
        <div className="panel-caption">状态</div>
        <dl className="status-grid">
          {entries.map(([key, value]) => {
            const hp = key.toLowerCase() === 'hp' ? numericHp(value) : null;
            return (
              <div className="status-row" key={key}>
                <dt>{key}</dt>
                <dd>
                  {hp !== null ? (
                    <div className="hp-bar" title={`${hp} / 100`}>
                      <div className="hp-fill" style={{ width: `${Math.max(0, Math.min(100, hp))}%` }} />
                      <span className="hp-text">{hp}</span>
                    </div>
                  ) : (
                    formatValue(value)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }

  if (block.kind === 'choices') {
    return (
      <div className="panel panel-choices">
        <div className="panel-caption">可选行动</div>
        <div className="choice-list">
          {block.options.map((option, index) => (
            <button
              type="button"
              className="choice-btn"
              key={`${option.label}-${index}`}
              onClick={() => onChoose(option.text)}
              title="点击后填入输入框，由你决定要不要发送"
            >
              <span className="choice-label">{option.label}</span>
              <span className="choice-text">{option.text}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <details className="panel panel-error">
      <summary>
        无法解析这段面板：{block.problem}
        {block.panelType ? `（type="${block.panelType}"）` : ''}
      </summary>
      <pre className="panel-raw">{block.raw}</pre>
    </details>
  );
}
