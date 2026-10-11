import { useState } from 'react';
import { useApp } from '../state/store.tsx';

export function SettingsPanel() {
  const { state, actions } = useApp();
  const [showKey, setShowKey] = useState(false);

  const app = state.settings;
  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  const patchApp = (patch: Partial<typeof app>) => {
    void actions.saveAppSettings({ ...app, ...patch });
  };

  const patchSession = (patch: Partial<NonNullable<typeof session>['settings']>) => {
    if (!session) return;
    void actions.saveSessionSettings(session.id, patch);
  };

  return (
    <div className="panel-body">
      <section className="form-section">
        <h3>模型设置</h3>
        <p className="hint">
          三项都在这里可配（题面要求）。请求始终走同源 <code>/llm</code> 代理 —— 浏览器不直连第三方 API，
          所以不会被 CORS 拦。留空则使用服务端 <code>.env</code> 里的默认值。
        </p>

        <label className="field">
          <span>服务地址 baseUrl</span>
          <input
            value={app.baseUrl}
            placeholder="https://gcli.ggchan.dev/v1"
            onChange={(event) => patchApp({ baseUrl: event.target.value })}
          />
        </label>

        <label className="field">
          <span>模型名称 model</span>
          <input
            value={app.model}
            placeholder="gemini-3.8-flash"
            onChange={(event) => patchApp({ model: event.target.value })}
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <span className="field-inline">
            <input
              type={showKey ? 'text' : 'password'}
              value={app.apiKey}
              placeholder="留空则用 .env 里的 LLM_API_KEY"
              onChange={(event) => patchApp({ apiKey: event.target.value })}
            />
            <button type="button" className="mini" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={app.stream}
            onChange={(event) => patchApp({ stream: event.target.checked })}
          />
          流式输出（逐段显示 AI 回复）
        </label>

        <p className="hint hint-warn">
          ▲ 你在这里填的 Key 会保存在<strong>浏览器本地（IndexedDB）</strong>。共用电脑上不要填私人 Key；
          清掉浏览器数据就会失效。留空则 Key 只存在于服务端 <code>.env</code>，浏览器侧完全不持有。
        </p>
      </section>

      <section className="form-section">
        <h3>当前会话的上下文参数</h3>
        {session ? (
          <>
            <label className="field">
              <span>世界书扫描深度 N（1–100）</span>
              <input
                type="number"
                min={1}
                max={100}
                value={session.settings.scanDepth}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  patchSession({ scanDepth: Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 1 });
                }}
              />
            </label>
            <label className="field">
              <span>上下文上限（估算 token）</span>
              <input
                type="number"
                min={256}
                value={session.settings.contextLimit}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  patchSession({ contextLimit: Number.isFinite(n) && n > 0 ? Math.floor(n) : 32768 });
                }}
              />
            </label>
            <label className="field">
              <span>世界书预算占比（%）</span>
              <input
                type="number"
                min={0}
                max={100}
                value={session.settings.worldBookBudgetPct}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  patchSession({ worldBookBudgetPct: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : 25 });
                }}
              />
            </label>
            <label className="field">
              <span>上下文提醒阈值（%）</span>
              <input
                type="number"
                min={1}
                max={100}
                value={session.settings.contextWarnPct}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  patchSession({ contextWarnPct: Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 80 });
                }}
              />
            </label>
            <p className="hint">
              扫描深度 N 的语义：检查最近 N 条合格历史，<strong>外加</strong>本次待发送消息（共 N+1 条参与关键词匹配）。
              世界书预算是本应用为配合"上下文提醒"自引入的机制，调到 100 即等于关闭。
            </p>
          </>
        ) : (
          <p className="hint">先选中一个会话。</p>
        )}
      </section>
    </div>
  );
}
