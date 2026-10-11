import type { PanelBlock, ParsedMessage } from './types.ts';

/**
 * <tavern-panel> 解析 —— 纯函数，输入消息正文，输出 segments。
 *
 * 铁律：**任何错误都保留 raw 原文**，绝不丢弃这段内容（题面硬要求）。
 * 存储层永远保存原始正文（含标签），解析只发生在渲染时 ——
 * 这样"编辑消息"看到的是原文，不会因为渲染而丢数据。
 */

const BLOCK_RE = /<tavern-panel\b([^>]*?)>([\s\S]*?)<\/tavern-panel\s*>/g;
const UNCLOSED_RE = /<tavern-panel\b/;

function readAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4];
}

function errorBlock(raw: string, problem: string, panelType?: string): PanelBlock {
  return { kind: 'error', raw, problem, panelType };
}

function parseBlock(full: string, attrs: string, inner: string): PanelBlock {
  const type = readAttr(attrs, 'type')?.trim();
  if (!type) return errorBlock(full, '标签缺少 type 属性');

  if (type === 'status') {
    let data: unknown;
    try {
      data = JSON.parse(inner);
    } catch (e) {
      return errorBlock(full, `JSON 无法解析：${(e as Error).message}`, type);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return errorBlock(full, 'JSON 顶层必须是对象（形如 {"hp":10,"location":"柳洞寺"}）', type);
    }
    return { kind: 'status', raw: full, data: data as Record<string, unknown> };
  }

  if (type === 'choices') {
    let data: unknown;
    try {
      data = JSON.parse(inner);
    } catch (e) {
      return errorBlock(full, `JSON 无法解析：${(e as Error).message}`, type);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return errorBlock(full, 'JSON 顶层必须是对象（形如 {"options":[{"label":"…","text":"…"}]}）', type);
    }
    const options = (data as { options?: unknown }).options;
    if (!Array.isArray(options)) {
      return errorBlock(full, '缺少 options 数组', type);
    }
    const out: { label: string; text: string }[] = [];
    for (let i = 0; i < options.length; i += 1) {
      const opt = options[i] as { label?: unknown; text?: unknown } | null;
      if (typeof opt !== 'object' || opt === null) {
        return errorBlock(full, `options[${i}] 必须是对象`, type);
      }
      if (typeof opt.label !== 'string' || typeof opt.text !== 'string') {
        return errorBlock(full, `options[${i}] 的 label / text 必须是字符串`, type);
      }
      out.push({ label: opt.label, text: opt.text });
    }
    return { kind: 'choices', raw: full, options: out };
  }

  return errorBlock(full, `不支持的 type：「${type}」（本项目仅支持 status / choices）`, type);
}

export function parsePanels(content: string): ParsedMessage {
  const segments: ParsedMessage['segments'] = [];
  let last = 0;

  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null = BLOCK_RE.exec(content);
  while (m !== null) {
    if (m.index > last) {
      segments.push({ kind: 'text', text: content.slice(last, m.index) });
    }
    segments.push(parseBlock(m[0], m[1] ?? '', m[2] ?? ''));
    last = m.index + m[0].length;
    m = BLOCK_RE.exec(content);
  }

  const tail = content.slice(last);
  if (tail) {
    if (UNCLOSED_RE.test(tail)) {
      // 有开无闭：该段整体作为 error（保留原文，后续文本也不丢）
      segments.push(errorBlock(tail, '标签未闭合（有 <tavern-panel> 但没有对应的 </tavern-panel>）'));
    } else {
      segments.push({ kind: 'text', text: tail });
    }
  }

  if (segments.length === 0) segments.push({ kind: 'text', text: '' });
  return { segments };
}

/** 一条消息里是否含任何渲染失败的面板（供"回复结束后按约定格式检查"提示用）。 */
export function hasPanelProblem(parsed: ParsedMessage): boolean {
  return parsed.segments.some((s) => 'kind' in s && s.kind === 'error');
}
