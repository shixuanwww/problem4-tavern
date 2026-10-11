import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Message } from '../core/types.ts';
import { buildRequest } from '../core/assembly.ts';
import { useApp, nextSeq } from '../state/store.tsx';
import { MessageBubble } from './MessageBubble.tsx';
import { MessageToolbar } from './MessageToolbar.tsx';
import { UsageBar } from './UsageBar.tsx';

export type PanelKey = 'preview' | 'inspector' | 'worldbook' | 'preset' | 'character' | 'settings';

export interface ChatViewProps {
  draft: string;
  onDraftChange: (text: string) => void;
  onChoose: (sessionId: string, text: string) => void;
  onOpenPanel: (panel: PanelKey) => void;
}

export function ChatView({ draft, onDraftChange, onChoose, onOpenPanel }: ChatViewProps) {
  const { state, actions } = useApp();
  const sessionId = state.activeSessionId;
  const session = state.sessions.find((s) => s.id === sessionId) ?? null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const messages = useMemo(
    () => state.messages.filter((m) => m.sessionId === sessionId).sort((a, b) => a.seq - b.seq),
    [state.messages, sessionId],
  );

  const visible = useMemo(
    () => (showHidden ? messages : messages.filter((m) => !m.uiHidden)),
    [messages, showHidden],
  );

  const generatingId = sessionId ? state.generating[sessionId] : undefined;
  const isGenerating = Boolean(generatingId);
  const errorText = sessionId ? state.errors[sessionId] : undefined;

  /** 发送前预览 / 用量提醒共用同一份装配结果（预览 ≠ 快照：快照在发送瞬间才冻结） */
  const preview = useMemo(() => {
    if (!session) return null;
    const worldBooks = state.worldBooks.filter((wb) => session.worldBookIds.includes(wb.id));
    const preset = state.presets.find((p) => p.id === session.presetId);
    const character = state.characters.find((c) => c.id === session.characterCardId);
    const pendingSeq = nextSeq(state.messages, session.id);
    return buildRequest({
      session,
      messages,
      worldBooks,
      preset,
      character,
      pendingUserText: draft,
      pendingSeq,
    });
  }, [session, messages, state.worldBooks, state.presets, state.characters, state.messages, draft]);

  const lastLength = messages.length > 0 ? (messages[messages.length - 1]?.content.length ?? 0) : 0;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickRef.current || isGenerating) el.scrollTop = el.scrollHeight;
  }, [visible.length, lastLength, isGenerating]);

  if (!session) {
    return (
      <section className="chat chat-empty">
        <p>左侧还没有会话。点「新建会话」开始吧。</p>
      </section>
    );
  }

  const handleSend = async () => {
    if (!sessionId || draft.trim() === '' || isGenerating) return;
    const text = draft;
    onDraftChange('');
    setSelected(new Set());
    setEditingId(null);
    await actions.sendMessage(sessionId, text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectByRole = (role: Message['role']) => {
    setSelected(new Set(visible.filter((m) => m.role === role).map((m) => m.id)));
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `确定要【删除】选中的 ${selected.size} 条消息吗？\n\n删除与"隐藏 / 不进上下文"不同：它会真的把内容从本地库里抹掉，无法恢复。`,
    );
    if (!ok) return;
    await actions.removeMessages(Array.from(selected));
    setSelected(new Set());
  };

  const singleDelete = async (message: Message) => {
    const ok = window.confirm(
      `确定要【删除】第 ${message.seq} 条消息吗？\n\n删除与"隐藏 / 不进上下文"不同：它会真的把内容从本地库里抹掉，无法恢复。\n如果只是不想让 AI 看到，请用「不进上下文」。`,
    );
    if (!ok) return;
    await actions.removeMessages([message.id]);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(message.id);
      return next;
    });
  };

  const handleChoose = (message: Message, text: string) => {
    onChoose(message.sessionId, text);
  };

  /**
   * 上下文快满时的"可处理的消息入口"（题面要求提醒条必须带入口）。
   * 直接替用户把**较早的消息**选中（最近 2 条，通常是一问一答，保持选中之外），
   * 并把隐藏消息一起显示出来，用户接着点工具栏的「批量不进上下文」就能一步排除。
   */
  const handleProcessOldMessages = () => {
    const lastSeq = visible[visible.length - 1]?.seq ?? 0;
    const targets = messages.filter((m) => lastSeq - m.seq >= 2);
    setShowHidden(true);
    setSelected(new Set(targets.map((m) => m.id)));
    document.querySelector('.chat-list')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="chat">
      <div className="chat-top">
        <MessageToolbar
          messages={visible}
          selected={selected}
          showHidden={showHidden}
          onToggleShowHidden={() => setShowHidden((v) => !v)}
          onSelectAll={() => setSelected(new Set(visible.map((m) => m.id)))}
          onSelectNone={() => setSelected(new Set())}
          onSelectByRole={selectByRole}
          onBatchHidden={(hidden) => void actions.setMessageFlags(Array.from(selected), { uiHidden: hidden })}
          onBatchExcluded={(excluded) => void actions.setMessageFlags(Array.from(selected), { excluded })}
          onBatchDelete={() => void batchDelete()}
        />
      </div>

      {errorText ? (
        <div className="error-banner" role="alert">
          <strong>模型请求失败：</strong>
          <span>{errorText}</span>
          <button type="button" className="mini" onClick={() => onOpenPanel('settings')}>
            打开模型设置
          </button>
        </div>
      ) : null}

      <div className="chat-list" ref={listRef} onScroll={() => {
        const el = listRef.current;
        if (!el) return;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}>
        {visible.length === 0 ? <p className="chat-hint">还没有消息。写点什么开始吧。</p> : null}
        {visible.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            selected={selected.has(message.id)}
            editing={editingId === message.id}
            onToggleSelect={toggleSelect}
            onStartEdit={setEditingId}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(id, content) => {
              void actions.editMessage(id, content);
              setEditingId(null);
            }}
            onToggleHidden={(id) => {
              const m = state.messages.find((x) => x.id === id);
              if (m) void actions.setMessageFlags([id], { uiHidden: !m.uiHidden });
            }}
            onToggleExcluded={(id) => {
              const m = state.messages.find((x) => x.id === id);
              if (m) void actions.setMessageFlags([id], { excluded: !m.excluded });
            }}
            onDelete={(id) => {
              const m = state.messages.find((x) => x.id === id);
              if (m) void singleDelete(m);
            }}
            onChoose={handleChoose}
          />
        ))}
      </div>

      <div className="chat-bottom">
        {isGenerating ? (
          <div className="frozen-note">
            本次请求已冻结成快照 —— 现在改设置或裁剪消息只影响<strong>下一次</strong>请求。
            <button type="button" className="mini" onClick={() => onOpenPanel('inspector')}>
              查看本次请求快照
            </button>
          </div>
        ) : null}

        {preview ? (
          <UsageBar
            used={preview.totalTokens}
            limit={session.settings.contextLimit}
            warnPct={session.settings.contextWarnPct}
            onOpenMessages={handleProcessOldMessages}
          />
        ) : null}

        <div className="composer">
          <label className="sr-only" htmlFor="composer">
            输入消息内容
          </label>
          <textarea
            id="composer"
            className="composer-input"
            rows={3}
            value={draft}
            placeholder="输入你的行动或对白……（Enter 发送，Shift+Enter 换行）"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="composer-actions">
            {isGenerating ? (
              <button type="button" className="btn btn-stop" onClick={() => actions.stopGeneration(session.id)}>
                停止生成
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void handleSend()} disabled={draft.trim() === ''}>
                发送
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void actions.retryLast(session.id)}
              disabled={isGenerating || !messages.some((m) => m.role === 'user')}
              title="只重新生成最后一条 AI 回复，不会重复插入你的消息"
            >
              重试上一条
            </button>
            <button type="button" className="btn" onClick={() => onOpenPanel('preview')}>
              发送前预览
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
