import { useRef, useState } from 'react';
import type { Session } from '../core/types.ts';
import type { BundleCheck, SessionBundle } from '../storage/repo.ts';
import { useApp } from '../state/store.tsx';

export function SessionList() {
  const { state, actions } = useApp();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [conflict, setConflict] = useState<BundleCheck | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const sessions: Session[] = state.sessions;

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    const check = await actions.inspectBundleFile(file);
    if (!check.ok || !check.bundle) {
      setNotice(`导入失败：${check.error ?? '未知错误'}`);
      return;
    }
    if (check.idConflict) {
      // 题面要求：同 ID 时必须"明确区分覆盖与创建副本"
      setConflict(check);
      return;
    }
    await actions.applyImport(check.bundle, 'overwrite');
    setNotice(`已导入会话「${check.bundle.session.title}」`);
  };

  const resolveConflict = async (mode: 'overwrite' | 'copy' | 'cancel') => {
    if (mode === 'cancel' || !conflict?.bundle) {
      setConflict(null);
      return;
    }
    const bundle: SessionBundle = conflict.bundle;
    await actions.applyImport(bundle, mode);
    setNotice(mode === 'overwrite' ? '已覆盖同 ID 的会话' : '已作为副本导入');
    setConflict(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <h1 className="brand">Tavern Lite</h1>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void actions.newSession()}>
          新建会话
        </button>
        <div className="sidebar-row">
          <button type="button" className="mini" onClick={() => fileRef.current?.click()}>
            导入会话
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              void onPickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      {notice ? (
        <p className="notice" role="status">
          {notice}
          <button type="button" className="mini" onClick={() => setNotice(null)}>
            知道了
          </button>
        </p>
      ) : null}

      <ul className="session-list">
        {sessions.map((session) => {
          const active = session.id === state.activeSessionId;
          const count = state.messages.filter((m) => m.sessionId === session.id).length;
          const isRenaming = renamingId === session.id;
          return (
            <li key={session.id} className={`session-item ${active ? 'is-active' : ''}`}>
              {isRenaming ? (
                <form
                  className="rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void actions.renameSession(session.id, renameText);
                    setRenamingId(null);
                  }}
                >
                  <label className="sr-only" htmlFor={`rename-${session.id}`}>
                    会话名称
                  </label>
                  <input
                    id={`rename-${session.id}`}
                    value={renameText}
                    autoFocus
                    onChange={(event) => setRenameText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                  <button type="submit" className="mini">
                    保存
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="session-open"
                    onClick={() => actions.activateSession(session.id)}
                  >
                    <span className="session-title">{session.title}</span>
                    <span className="session-meta">{count} 条消息</span>
                  </button>
                  <div className="session-actions">
                    <button
                      type="button"
                      className="mini"
                      title="重命名"
                      onClick={() => {
                        setRenamingId(session.id);
                        setRenameText(session.title);
                        actions.activateSession(session.id);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className="mini"
                      title="导出为 JSON"
                      onClick={() => void actions.exportSession(session.id)}
                    >
                      导出
                    </button>
                    <button
                      type="button"
                      className="mini mini-danger"
                      title="删除会话（连同它的消息与快照）"
                      onClick={() => {
                        if (
                          window.confirm(
                            `确定删除会话「${session.title}」？\n\n它会连同该会话的 ${count} 条消息与全部请求快照一起删除，无法恢复。`,
                          )
                        ) {
                          void actions.removeSession(session.id);
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
        {sessions.length === 0 ? <li className="session-empty">还没有会话</li> : null}
      </ul>

      {conflict?.bundle ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入冲突">
          <div className="modal">
            <h2>已有同 ID 的会话</h2>
            <p>
              本地已存在 ID 为 <code>{conflict.bundle.session.id}</code> 的会话。请选择处理方式：
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => void resolveConflict('overwrite')}>
                覆盖
              </button>
              <button type="button" className="btn" onClick={() => void resolveConflict('copy')}>
                创建副本
              </button>
              <button type="button" className="btn" onClick={() => void resolveConflict('cancel')}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
