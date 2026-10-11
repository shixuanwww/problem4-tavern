import { useState } from 'react';
import type { WorldBook, WorldBookEntry } from '../core/types.ts';
import { cryptoRandomId } from '../core/assembly.ts';
import { useApp } from '../state/store.tsx';

function newEntry(): WorldBookEntry {
  return {
    id: cryptoRandomId(),
    name: '新条目',
    keys: [],
    content: '',
    enabled: true,
    constant: false,
    priority: 10,
  };
}

export function WorldBookEditor() {
  const { state, actions } = useApp();
  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const [activeBookId, setActiveBookId] = useState<string | null>(state.worldBooks[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const book: WorldBook | undefined =
    state.worldBooks.find((w) => w.id === activeBookId) ?? state.worldBooks[0];

  const createBook = async () => {
    const next: WorldBook = {
      id: cryptoRandomId(),
      name: `世界书 ${state.worldBooks.length + 1}`,
      entries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await actions.saveWorldBook(next);
    setActiveBookId(next.id);
  };

  const commit = async (next: WorldBook) => {
    // 保存前强制条目 ID 唯一（题面要求：重复即报错，不静默改写）
    const seen = new Set<string>();
    for (const entry of next.entries) {
      if (seen.has(entry.id)) {
        setError(`条目 ID 重复：${entry.id}（请改名后重试）`);
        return;
      }
      seen.add(entry.id);
    }
    setError(null);
    await actions.saveWorldBook(next);
  };

  const patchEntry = (entryId: string, patch: Partial<WorldBookEntry>) => {
    if (!book) return;
    void commit({
      ...book,
      entries: book.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
    });
  };

  return (
    <div className="panel-body">
      <section className="form-section">
        <div className="row-between">
          <h3>世界书</h3>
          <button type="button" className="mini" onClick={() => void createBook()}>
            新建世界书
          </button>
        </div>

        <ul className="book-tabs">
          {state.worldBooks.map((wb) => (
            <li key={wb.id}>
              <button
                type="button"
                className={`mini ${wb.id === book?.id ? 'is-on' : ''}`}
                onClick={() => setActiveBookId(wb.id)}
              >
                {wb.name}
              </button>
            </li>
          ))}
          {state.worldBooks.length === 0 ? <li className="hint">还没有世界书</li> : null}
        </ul>

        {book ? (
          <>
            <label className="field">
              <span>世界书名称</span>
              <input
                value={book.name}
                onChange={(event) => void commit({ ...book, name: event.target.value })}
              />
            </label>

            <div className="row-between">
              <span className="hint">
                共 {book.entries.length} 条 · 启用 {book.entries.filter((e) => e.enabled).length} 条
              </span>
              <span>
                <button
                  type="button"
                  className="mini"
                  onClick={() => void commit({ ...book, entries: [...book.entries, newEntry()] })}
                >
                  添加条目
                </button>
                <button
                  type="button"
                  className="mini mini-danger"
                  onClick={() => {
                    if (window.confirm(`删除整本世界书「${book.name}」？引用它的会话会同步摘掉这条引用。`)) {
                      void actions.removeWorldBook(book.id);
                      setActiveBookId(null);
                    }
                  }}
                >
                  删除世界书
                </button>
              </span>
            </div>

            {error ? <p className="notice notice-error">{error}</p> : null}

            <div className="entry-list">
              {book.entries.map((entry) => (
                <article className="entry-card" key={entry.id}>
                  <div className="entry-head">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={(event) => patchEntry(entry.id, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={entry.constant}
                        onChange={(event) => patchEntry(entry.id, { constant: event.target.checked })}
                      />
                      常驻
                    </label>
                    <label className="field field-compact">
                      <span>优先级</span>
                      <input
                        type="number"
                        value={entry.priority}
                        onChange={(event) => patchEntry(entry.id, { priority: Number(event.target.value) || 0 })}
                      />
                    </label>
                    <span className="entry-id" title="稳定 ID（创建后不变）">
                      {entry.id.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      className="mini mini-danger"
                      onClick={() =>
                        void commit({ ...book, entries: book.entries.filter((e) => e.id !== entry.id) })
                      }
                    >
                      删除
                    </button>
                  </div>

                  <label className="field">
                    <span>名称</span>
                    <input
                      value={entry.name}
                      onChange={(event) => patchEntry(entry.id, { name: event.target.value })}
                    />
                  </label>

                  <label className="field">
                    <span>关键词（用逗号分隔，命中任意一个即候选）</span>
                    <input
                      value={entry.keys.join(', ')}
                      placeholder="圣杯, 令咒, 柳洞寺"
                      onChange={(event) =>
                        patchEntry(entry.id, {
                          keys: event.target.value
                            .split(',')
                            .map((k) => k.trim())
                            .filter((k) => k !== ''),
                        })
                      }
                    />
                  </label>

                  <label className="field">
                    <span>正文</span>
                    <textarea
                      rows={3}
                      value={entry.content}
                      onChange={(event) => patchEntry(entry.id, { content: event.target.value })}
                    />
                  </label>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="form-section">
        <h3>本会话启用的世界书</h3>
        {session ? (
          <>
            {state.worldBooks.map((wb) => (
              <label className="toggle" key={wb.id}>
                <input
                  type="checkbox"
                  checked={session.worldBookIds.includes(wb.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...session.worldBookIds, wb.id]
                      : session.worldBookIds.filter((id) => id !== wb.id);
                    void actions.setSessionWorldBooks(session.id, next);
                  }}
                />
                {wb.name}（{wb.entries.length} 条）
              </label>
            ))}
            {state.worldBooks.length === 0 ? <p className="hint">还没有世界书，先在上面新建一本。</p> : null}
          </>
        ) : (
          <p className="hint">先选中一个会话。</p>
        )}
      </section>
    </div>
  );
}
