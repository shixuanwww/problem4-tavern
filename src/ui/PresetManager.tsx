import { useState } from 'react';
import type { Preset, PresetModule } from '../core/types.ts';
import { PRESET_FORMAT, PRESET_VERSION, parsePreset, serializePreset } from '../core/preset.ts';
import { cryptoRandomId } from '../core/assembly.ts';
import { expandTemplate } from '../core/template.ts';
import { useApp } from '../state/store.tsx';

export function PresetManager() {
  const { state, actions } = useApp();
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(state.presets[0]?.id ?? null);

  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const preset: Preset | undefined = state.presets.find((p) => p.id === activeId) ?? state.presets[0];

  const loadFile = async (file: File) => {
    setErrors([]);
    setNotice(null);
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      setErrors([`JSON 语法错误：${(error as Error).message}`]);
      return;
    }
    const parsed = parsePreset(raw);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    await actions.savePreset(parsed.preset);
    setActiveId(parsed.preset.id);
    setNotice(`已导入预设「${parsed.preset.name}」（${parsed.preset.modules.length} 个模块）`);
  };

  const patchPreset = async (next: Preset) => {
    await actions.savePreset(next);
  };

  const patchModule = (moduleId: string, patch: Partial<PresetModule>) => {
    if (!preset) return;
    void patchPreset({
      ...preset,
      modules: preset.modules.map((m) => (m.id === moduleId ? { ...m, ...patch } : m)),
    });
  };

  const move = (moduleId: string, direction: -1 | 1) => {
    if (!preset) return;
    const ordered = [...preset.modules].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((m) => m.id === moduleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const a = ordered[index] as PresetModule;
    const b = ordered[target] as PresetModule;
    const next = preset.modules.map((m) => {
      if (m.id === a.id) return { ...m, order: b.order };
      if (m.id === b.id) return { ...m, order: a.order };
      return m;
    });
    void patchPreset({ ...preset, modules: next });
  };

  const vars: Record<string, string> = {
    char: state.characters.find((c) => c.id === session?.characterCardId)?.name ?? '',
    ...(session?.variables ?? {}),
  };

  return (
    <div className="panel-body">
      <section className="form-section">
        <h3>提示词预设</h3>
        <p className="hint">
          预设是<strong>纯数据</strong>：格式标识 <code>{PRESET_FORMAT}</code> · 版本 <code>{PRESET_VERSION}</code>。
          只要按这个格式写，新的预设<strong>不用改代码</strong>就能用（模块列表驱动渲染、启停与排序）。
        </p>

        <label className="field">
          <span>导入预设 JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = '';
            }}
          />
        </label>

        {errors.length > 0 ? (
          <div className="error-box">
            <strong>预设导入失败</strong>
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {notice ? <p className="notice">{notice}</p> : null}

        <ul className="book-tabs">
          {state.presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`mini ${p.id === preset?.id ? 'is-on' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                {p.name}
              </button>
            </li>
          ))}
          {state.presets.length === 0 ? <li className="hint">还没有导入过预设</li> : null}
        </ul>
      </section>

      {preset ? (
        <section className="form-section">
          <div className="row-between">
            <h3>模块（按 order 升序参与编排）</h3>
            <span>
              <button type="button" className="mini" onClick={() => void patchPreset(structuredClone(preset))}>
                保存
              </button>
              <button
                type="button"
                className="mini"
                onClick={() => downloadJson(serializePreset(preset), `${preset.name}.json`)}
              >
                导出
              </button>
              <button
                type="button"
                className="mini mini-danger"
                onClick={() => {
                  if (window.confirm(`删除预设「${preset.name}」？已绑定它的会话不受影响。`)) {
                    void actions.removePreset(preset.id);
                    setActiveId(null);
                  }
                }}
              >
                删除
              </button>
            </span>
          </div>

          <label className="field">
            <span>预设名称</span>
            <input value={preset.name} onChange={(event) => void patchPreset({ ...preset, name: event.target.value })} />
          </label>

          {[...preset.modules]
            .sort((a, b) => a.order - b.order)
            .map((module, index, list) => (
              <article className="entry-card" key={module.id}>
                <div className="entry-head">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={module.enabled}
                      onChange={(event) => patchModule(module.id, { enabled: event.target.checked })}
                    />
                    启用
                  </label>
                  <label className="field field-compact">
                    <span>order</span>
                    <input
                      type="number"
                      value={module.order}
                      onChange={(event) => patchModule(module.id, { order: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="field field-compact">
                    <span>位置</span>
                    <select
                      value={module.position}
                      onChange={(event) =>
                        patchModule(module.id, { position: event.target.value as PresetModule['position'] })
                      }
                    >
                      <option value="system">系统区</option>
                      <option value="postHistory">历史之后</option>
                    </select>
                  </label>
                  <label className="field field-compact">
                    <span>role</span>
                    <select
                      value={module.role}
                      onChange={(event) => patchModule(module.id, { role: event.target.value as PresetModule['role'] })}
                    >
                      <option value="system">system</option>
                      <option value="user">user</option>
                      <option value="assistant">assistant</option>
                    </select>
                  </label>
                  <span className="bubble-spacer" />
                  <button type="button" className="mini" disabled={index === 0} onClick={() => move(module.id, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="mini"
                    disabled={index === list.length - 1}
                    onClick={() => move(module.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="mini mini-danger"
                    onClick={() =>
                      void patchPreset({ ...preset, modules: preset.modules.filter((m) => m.id !== module.id) })
                    }
                  >
                    删除
                  </button>
                </div>

                <label className="field">
                  <span>模块名称</span>
                  <input value={module.name} onChange={(event) => patchModule(module.id, { name: event.target.value })} />
                </label>

                <label className="field">
                  <span>内容（可用 {'{{变量}}'}）</span>
                  <textarea
                    rows={3}
                    value={module.content}
                    onChange={(event) => patchModule(module.id, { content: event.target.value })}
                  />
                </label>

                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={module.template === true}
                    onChange={(event) => patchModule(module.id, { template: event.target.checked })}
                  />
                  参与 {'{{变量}}'} 替换
                </label>

                {module.template ? (
                  <details>
                    <summary>展开结果（发送前才会真正替换；缺失的变量保留原样）</summary>
                    <pre className="part-content">{expandTemplate(module.content, vars).text}</pre>
                  </details>
                ) : null}
              </article>
            ))}

          <button
            type="button"
            className="mini"
            onClick={() =>
              void patchPreset({
                ...preset,
                modules: [
                  ...preset.modules,
                  {
                    id: cryptoRandomId(),
                    name: '新模块',
                    role: 'system',
                    content: '',
                    enabled: true,
                    order: (preset.modules.at(-1)?.order ?? 0) + 10,
                    position: 'system',
                    template: false,
                  },
                ],
              })
            }
          >
            添加模块
          </button>
        </section>
      ) : null}

      <section className="form-section">
        <h3>绑定到当前会话</h3>
        {session ? (
          <>
            <p className="hint">
              当前预设：{state.presets.find((p) => p.id === session.presetId)?.name ?? '（未绑定）'}
            </p>
            <label className="field">
              <span>选择预设</span>
              <select
                value={session.presetId ?? ''}
                onChange={(event) => void actions.attachPreset(session.id, event.target.value || undefined)}
              >
                <option value="">（不绑定）</option>
                {state.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              ▲ 预设里的 contextConfig 只作为<strong>初值</strong>写入会话设置；之后以你在「设置」里改的为准
              （会话设置优先）。
            </p>
          </>
        ) : (
          <p className="hint">先选中一个会话。</p>
        )}
      </section>
    </div>
  );
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
