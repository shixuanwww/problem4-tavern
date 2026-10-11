import { useState } from 'react';
import { AppProvider, useApp } from './state/store.tsx';
import { SessionList } from './ui/SessionList.tsx';
import { ChatView, type PanelKey } from './ui/ChatView.tsx';
import { RequestPreview } from './ui/RequestPreview.tsx';
import { SnapshotInspector } from './ui/SnapshotInspector.tsx';
import { WorldBookEditor } from './ui/WorldBookEditor.tsx';
import { PresetManager } from './ui/PresetManager.tsx';
import { CharacterCardImport } from './ui/CharacterCardImport.tsx';
import { SettingsPanel } from './ui/SettingsPanel.tsx';

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'preview', label: '发送前预览' },
  { key: 'inspector', label: '检查视图' },
  { key: 'worldbook', label: '世界书' },
  { key: 'preset', label: '预设' },
  { key: 'character', label: '角色卡' },
  { key: 'settings', label: '设置' },
];

function Shell() {
  const { state, actions } = useApp();
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const sessionId = state.activeSessionId;
  const session = state.sessions.find((s) => s.id === sessionId) ?? null;
  const draft = sessionId ? (drafts[sessionId] ?? '') : '';

  if (!state.ready) {
    return (
      <div className="boot">
        <p>{state.loadError ? `加载失败：${state.loadError}` : '正在从浏览器本地读取数据…'}</p>
      </div>
    );
  }

  const setDraft = (text: string) => {
    if (!sessionId) return;
    setDrafts((prev) => ({ ...prev, [sessionId]: text }));
  };

  /**
   * 点击 <tavern-panel> 的选项 → 把对应文字填进【这条消息所属会话】的输入框，
   * 由用户决定是否发送（不自动发送）。若已切到别的会话，先切回去。
   */
  const handleChoose = (targetSessionId: string, text: string) => {
    if (targetSessionId !== sessionId) actions.activateSession(targetSessionId);
    setDrafts((prev) => ({ ...prev, [targetSessionId]: text }));
    requestAnimationFrame(() => {
      const el = document.getElementById('composer');
      if (el instanceof HTMLTextAreaElement) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  return (
    <div className="app">
      <SessionList />

      <main className="main">
        <header className="topbar">
          <h2 className="topbar-title">{session?.title ?? '未选择会话'}</h2>
          <nav className="panel-tabs" aria-label="侧栏面板">
            {PANELS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`tab ${panel === item.key ? 'is-on' : ''}`}
                aria-pressed={panel === item.key}
                onClick={() => setPanel((current) => (current === item.key ? null : item.key))}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <ChatView draft={draft} onDraftChange={setDraft} onChoose={handleChoose} onOpenPanel={setPanel} />
      </main>

      {panel ? (
        <aside className="right-panel" aria-label={`面板内容：${PANELS.find((p) => p.key === panel)?.label ?? '侧栏面板'}`}>
          <header className="right-head">
            <h3>{PANELS.find((p) => p.key === panel)?.label}</h3>
            <button type="button" className="mini" onClick={() => setPanel(null)}>
              关闭
            </button>
          </header>
          <div className="right-body">
            {panel === 'preview' ? <RequestPreview pendingText={draft} /> : null}
            {panel === 'inspector' ? <SnapshotInspector /> : null}
            {panel === 'worldbook' ? <WorldBookEditor /> : null}
            {panel === 'preset' ? <PresetManager /> : null}
            {panel === 'character' ? <CharacterCardImport /> : null}
            {panel === 'settings' ? <SettingsPanel /> : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
