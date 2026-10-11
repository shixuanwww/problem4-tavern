import type { AppSettings, ChatMessage } from './types.ts';

/**
 * 模型客户端 —— 一律走同源 `/llm` 代理，浏览器【不直连】第三方 API（避开 CORS）。
 *
 * 代理侧（vite.config.ts / scripts/static-proxy.mjs）只做两件事：
 *   1) 按请求头 `x-llm-base-url` 动态选 target（缺省回落 .env 的 LLM_BASE_URL）
 *   2) 在 Node 侧注入 `Authorization: Bearer <x-llm-api-key || .env 的 LLM_API_KEY>`
 * 代理【不改写请求体】：model 等参数由前端始终显式发送。
 *
 * 🔴 这里不做任何"读最新设置"的动作：调用方必须把本次请求实际用到的配置
 *    【深拷贝】进闭包再传进来，保证"生成期间改设置只影响下一次"。
 */

export const LLM_ENDPOINT = '/llm/chat/completions';
export const LLM_DEFAULTS_ENDPOINT = '/llm/defaults';

export interface StreamHandlers {
  onDelta: (chunk: string) => void;
  onDone: (full: string) => void;
  onError: (message: string) => void;
}

export interface StreamOptions {
  settings: AppSettings;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/** 启动时取回 .env 里的默认 baseUrl / model（绝不返回 key），用于预填设置面板。 */
export async function fetchDefaults(): Promise<{ baseUrl: string; model: string } | null> {
  try {
    const res = await fetch(LLM_DEFAULTS_ENDPOINT, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { baseUrl?: unknown; model?: unknown };
    return {
      baseUrl: typeof json.baseUrl === 'string' ? json.baseUrl : '',
      model: typeof json.model === 'string' ? json.model : '',
    };
  } catch {
    return null;
  }
}

/** 从一条 OpenAI 风格的响应里取出增量文本（流式的 `delta` / 非流式的 `message` / `text` 都认） */
export function pickDelta(json: unknown): string {
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as Record<string, unknown>;
  const delta = first.delta as { content?: unknown } | undefined;
  if (delta && typeof delta.content === 'string') return delta.content;
  const message = first.message as { content?: unknown } | undefined;
  if (message && typeof message.content === 'string') return message.content;
  const text = first.text;
  return typeof text === 'string' ? text : '';
}

/**
 * 从**一行** SSE 里取出增量文本。返回 `''` 表示这一行没有可用增量：
 * 非 `data:` 行、心跳/注释行、空行、`[DONE]`、坏 JSON 一律安静跳过（绝不抛）。
 */
export function deltaFromSseLine(rawLine: string): string {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return '';
  const payload = line.slice(5).trim();
  if (payload === '' || payload === '[DONE]') return '';
  try {
    return pickDelta(JSON.parse(payload) as unknown);
  } catch {
    return '';
  }
}

export interface SseDecoder {
  /** 喂一个**任意切分**的网络分块（半个 `data:` 行也安全） */
  push(chunk: string): void;
  /** 流结束：处理最后一行没有换行结尾的残留 */
  flush(): void;
}

/**
 * 增量式 SSE 解码器。
 *
 * 为什么要有它：流式的正确性有一半在**分块边界**上 —— 一个 `data: {...}` 行完全可能被
 * 切在两个网络分块里；如果按块直接 `JSON.parse`，就会偶发丢字（而且是"看起来能跑"的那种）。
 * 这里保持 `buffer`，只处理**已经完整**的行，流结束时再 `flush()` 残留。
 *
 * 抽成纯函数（只依赖传入的字符串）是为了让 Node 单测能喂**任意切分**的输入做回归。
 */
export function createSseDecoder(onDelta: (delta: string) => void): SseDecoder {
  let buffer = '';
  const handle = (rawLine: string): void => {
    const delta = deltaFromSseLine(rawLine);
    if (delta) onDelta(delta);
  };
  return {
    push(chunk: string): void {
      buffer += chunk;
      // SSE：以空行分隔事件；这里逐行处理 `data:` 行即可
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) handle(rawLine);
    },
    flush(): void {
      const rest = buffer;
      buffer = '';
      if (rest.trim() !== '') handle(rest);
    },
  };
}

export async function streamChat(opts: StreamOptions, handlers: StreamHandlers): Promise<void> {
  const { settings, model, messages, signal } = opts;
  const stream = settings.stream !== false;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.baseUrl.trim()) headers['x-llm-base-url'] = settings.baseUrl.trim();
  if (settings.apiKey.trim()) headers['x-llm-api-key'] = settings.apiKey.trim();

  let res: Response;
  try {
    res = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    handlers.onError(
      `网络请求失败：${(e as Error).message}。请确认 dev server 正在运行（模型请求走同源 /llm 代理），` +
        '并检查「模型设置」里的服务地址是否正确。',
    );
    return;
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      detail = '(无法读取响应体)';
    }
    handlers.onError(`模型接口返回 ${res.status} ${res.statusText}：${detail.slice(0, 500)}`);
    return;
  }

  if (!stream) {
    try {
      const json = (await res.json()) as unknown;
      const text = pickDelta(json);
      handlers.onDelta(text);
      handlers.onDone(text);
    } catch (e) {
      handlers.onError(`解析响应失败：${(e as Error).message}`);
    }
    return;
  }

  const body = res.body;
  if (!body) {
    handlers.onError('响应没有可读流（浏览器不支持 ReadableStream？）');
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let full = '';
  const sse = createSseDecoder((delta) => {
    full += delta;
    handlers.onDelta(delta);
  });

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      sse.push(decoder.decode(value, { stream: true }));
    }
    sse.flush();
    handlers.onDone(full);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    handlers.onError(`读取流式响应失败：${(e as Error).message}`);
  }
}
