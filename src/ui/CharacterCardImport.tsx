import { useState } from 'react';
import {
  FIELD_MAPPING,
  IGNORED_RULES,
  SUPPORTED_SPEC,
  exportCharacterCard,
  importCharacterCard,
  looksLikeV2,
  parseJsonText,
  type CardImportResult,
} from '../core/characterCard.ts';
import { useApp } from '../state/store.tsx';

interface Preview {
  fileName: string;
  result: CardImportResult;
  rawText: string;
}

export function CharacterCardImport() {
  const { state, actions } = useApp();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  const loadFile = async (file: File) => {
    setNotice(null);
    const isPng = /\.png$/i.test(file.name) || file.type === 'image/png';

    if (isPng) {
      const embedded = await extractFromPng(file);
      if (!embedded) {
        setPreview({
          fileName: file.name,
          rawText: '',
          result: { ok: false, errors: ['这张 PNG 里没有找到 tEXt 的 chara / ccv3 数据块'], duplicates: [] },
        });
        return;
      }
      setPreview({ fileName: file.name, rawText: '', result: importCharacterCard(embedded.raw) });
      return;
    }

    const text = await file.text();
    const parsed = parseJsonText(text);
    if (!parsed.ok) {
      setPreview({ fileName: file.name, rawText: text, result: { ok: false, errors: [parsed.error], duplicates: [] } });
      return;
    }
    setPreview({ fileName: file.name, rawText: text, result: importCharacterCard(parsed.value, text) });
  };

  const doImport = async () => {
    if (!preview || !preview.result.ok) return;
    const { card, worldBook } = preview.result;
    await actions.importCharacter(card);
    if (worldBook) {
      await actions.saveWorldBook(worldBook);
      if (session) {
        await actions.setSessionWorldBooks(session.id, [...session.worldBookIds, worldBook.id]);
      }
    }
    if (session) await actions.attachCharacter(session.id, card);
    setNotice(
      `已导入角色卡「${card.name}」${worldBook ? `，并把内嵌世界书「${worldBook.name}」挂到当前会话` : ''}。`,
    );
    if (session) {
      // 导入后立刻替换会话开场白（若当前会话还没有任何消息）
      const existing = state.messages.filter((m) => m.sessionId === session.id);
      if (existing.length === 0 && card.firstMes.trim()) {
        setNotice((prev) => `${prev ?? ''}（该会话还没有消息，可以新建一个会话来看到它的开场白）`);
      }
    }
  };

  return (
    <div className="panel-body">
      <section className="form-section">
        <h3>导入角色卡（Character Card V2 JSON）</h3>
        <p className="hint">
          支持的子集：<strong>名称 / 描述 / 开场白 / 内嵌世界书</strong>。不支持的字段与未知 extensions
          会在导出时<strong>原样保留</strong>。
        </p>
        <label className="field">
          <span>选择 .json 或 .png（PNG 中内嵌 V2 数据为扩展功能）</span>
          <input
            type="file"
            accept="application/json,.json,image/png,.png"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = '';
            }}
          />
        </label>

        {preview ? (
          <div className="import-preview">
            <p className="hint">文件：{preview.fileName}</p>
            {preview.result.ok ? (
              <>
                <p>
                  解析成功：<strong>{preview.result.card.name}</strong>
                  {preview.result.worldBook
                    ? `　内嵌世界书「${preview.result.worldBook.name}」共 ${preview.result.worldBook.entries.length} 条`
                    : '　（无内嵌世界书）'}
                </p>
                {preview.result.warnings.length > 0 ? (
                  <ul className="warn-list">
                    {preview.result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {preview.result.ignoredPresent.length > 0 ? (
                  <details>
                    <summary>被忽略的运行规则（{preview.result.ignoredPresent.length} 条）</summary>
                    <p className="hint">
                      这些字段出现在你的卡里，但本题的世界书规则不使用它们，导入时忽略、导出时保留：
                    </p>
                    <p>{preview.result.ignoredPresent.join('、')}</p>
                  </details>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={() => void doImport()}>
                  导入{preview.result.worldBook ? '（含内嵌世界书）' : ''}
                </button>
              </>
            ) : (
              <div className="error-box">
                <strong>导入失败</strong>
                <ul>
                  {preview.result.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                {preview.result.duplicates.length > 0 ? (
                  <table className="data-table">
                    <caption>重复 ID 明细</caption>
                    <thead>
                      <tr>
                        <th>重复的 ID</th>
                        <th>条目序号</th>
                        <th>原文行号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.result.duplicates.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <code>{d.id}</code>
                          </td>
                          <td>{d.indices.map((i) => `#${i}`).join('、')}</td>
                          <td>{d.lines.length > 0 ? d.lines.join('、') : '（未能定位）'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {notice ? <p className="notice">{notice}</p> : null}
      </section>

      <section className="form-section">
        <h3>当前会话的角色卡</h3>
        {session ? (
          <>
            <p className="hint">
              当前绑定：
              {state.characters.find((c) => c.id === session.characterCardId)?.name ?? '（无）'}
            </p>
            <label className="field">
              <span>换成库里已有的角色卡</span>
              <select
                value={session.characterCardId ?? ''}
                onChange={(event) => {
                  const card = state.characters.find((c) => c.id === event.target.value);
                  if (card) void actions.attachCharacter(session.id, card);
                }}
              >
                <option value="">（不绑定）</option>
                {state.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              提示：角色卡只影响<strong>之后的请求</strong>；已有的开场白消息不会被替换。
            </p>
          </>
        ) : (
          <p className="hint">先选中一个会话。</p>
        )}
      </section>

      <section className="form-section">
        <h3>字段映射表（实际生效的规则）</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Character Card V2</th>
              <th>本应用字段</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_MAPPING.map((row) => (
              <tr key={row.from}>
                <td>
                  <code>{row.from}</code>
                </td>
                <td>
                  <code>{row.to}</code>
                </td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          spec 必须是 <code>{SUPPORTED_SPEC}</code> / 2.x，否则明确拒绝。以下运行规则<strong>不实现</strong>
          （导入时忽略、导出时保留）：
        </p>
        <p className="hint">{IGNORED_RULES.join('、')}</p>
      </section>

      <section className="form-section">
        <h3>导出角色卡</h3>
        <p className="hint">以导入时的原始 JSON 为基底，只把被编辑过的可映射字段写回；未支持字段原样保留。</p>
        <ul className="book-tabs">
          {state.characters.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="mini"
                onClick={() => {
                  const exported = exportCharacterCard(c);
                  downloadJson(exported, `${c.name}.json`);
                }}
              >
                导出「{c.name}」
              </button>
            </li>
          ))}
        </ul>
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

/** 从 PNG 的 tEXt chunk 里取出 V2 数据（keyword = chara，优先 ccv3） */
async function extractFromPng(file: File): Promise<{ raw: unknown } | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return null;
  }

  const texts = new Map<string, string>();
  let offset = 8;
  const view = new DataView(bytes.buffer);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (type === 'tEXt') {
      const chunk = bytes.slice(dataStart, dataStart + length);
      const zero = chunk.indexOf(0);
      if (zero > 0) {
        const keyword = String.fromCharCode(...chunk.slice(0, zero));
        const text = new TextDecoder('latin1').decode(chunk.slice(zero + 1));
        texts.set(keyword, text);
      }
    }
    if (type === 'IEND') break;
    offset = dataStart + length + 4; // 跳过 CRC
  }

  const payload = texts.get('ccv3') ?? texts.get('chara');
  if (!payload) return null;
  try {
    const json = decodeBase64ToText(payload);
    return { raw: JSON.parse(json) as unknown };
  } catch {
    return null;
  }
}

function decodeBase64ToText(base64: string): string {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function isV2Like(raw: unknown): boolean {
  return looksLikeV2(raw);
}
