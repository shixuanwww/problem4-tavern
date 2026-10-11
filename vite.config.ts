import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import reactPlugin from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

/**
 * 模型请求一律走同源 `/llm`（浏览器【不直连】第三方 API，避开 CORS）。
 *
 * 为什么不用 server.proxy：
 *   Vite 7 的 `ProxyOptions.target` 只接受字符串（不接受函数），也没有 http-proxy-middleware 的
 *   `router` 选项 —— 也就是说**它没法按请求头动态选 target**。而本项目要求"用户在面板里填的
 *   baseUrl 立刻生效"，所以这里自己写一个极小的转发中间件（与 scripts/static-proxy.mjs 同一套逻辑）。
 *
 * 中间件做三件事，别的一概不做：
 *   1) GET /llm/defaults            → 返回 .env 里的 { baseUrl, model }（绝不返回 key）
 *   2) 其余 /llm/*                  → 按请求头 x-llm-base-url 动态选目标；没有就回落 LLM_BASE_URL
 *   3) 在 Node 侧注入 Authorization: Bearer <x-llm-api-key || .env 的 LLM_API_KEY>
 *
 * 🔴 【不改写请求体】：model 等参数由前端始终显式发送。
 * 🔴 【不缓冲响应】：逐块透传，否则流式（SSE）会变成"等整段返回后一次性出现"。
 */
const LLM_PREFIX = '/llm';

function header(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return (raw[0] ?? '').trim();
  return typeof raw === 'string' ? raw.trim() : '';
}

export default defineConfig(({ mode }) => {
  // 🔴 用 LLM_ 前缀（不是 VITE_）：VITE_* 会被编译期内联进客户端 bundle，key 会泄露到前端产物。
  //    loadEnv 会依次加载 .env / .env.local / .env.[mode] / .env.[mode].local。
  const env = loadEnv(mode, process.cwd(), 'LLM_');
  const envBaseUrl = (env.LLM_BASE_URL ?? '').trim();
  const envModel = (env.LLM_MODEL ?? '').trim();
  const envApiKey = (env.LLM_API_KEY ?? '').trim();

  async function forwardToModel(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    const fromHeader = header(req, 'x-llm-base-url');
    const baseUrl = /^https?:\/\//i.test(fromHeader) ? fromHeader : envBaseUrl;

    if (!baseUrl) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: 'no_base_url',
          message:
            '没有可用的模型服务地址：请在「模型设置」里填 baseUrl，或在 .env / .env.local 里配置 LLM_BASE_URL。',
        }),
      );
      return;
    }

    const target = baseUrl.replace(/\/+$/, '') + url.replace(/^\/llm/, '');

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (['host', 'content-length', 'connection', 'x-llm-base-url', 'x-llm-api-key'].includes(key)) continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    const apiKey = header(req, 'x-llm-api-key') || envApiKey;
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

    let upstream: Response;
    try {
      // Node 的 fetch 需要 duplex: 'half' 才能接受流式请求体；TS 的 DOM 类型里还没这个字段
      const init = {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'follow',
      } as RequestInit & { duplex?: 'half' };
      upstream = await fetch(target, init);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: 'upstream_unreachable',
          message: `连不上模型服务 ${baseUrl}：${(error as Error).message}`,
        }),
      );
      return;
    }

    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-store');
    // 明确告诉任何可能的中间层：不要缓冲（SSE 必需）
    res.setHeader('x-accel-buffering', 'no');

    if (!upstream.body) {
      res.end();
      return;
    }
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
  }

  const llmMiddleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith(`${LLM_PREFIX}/`)) return next();

    if (url === `${LLM_PREFIX}/defaults` || url.startsWith(`${LLM_PREFIX}/defaults?`)) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ baseUrl: envBaseUrl, model: envModel }));
      return;
    }

    void forwardToModel(req, res, url);
  };

  // configureServer / configurePreviewServer 里直接 use 的中间件排在 Vite 内部中间件之前，
  // 所以 /llm 不会被静态文件服务抢走。
  const llmPlugin: Plugin = {
    name: 'tavern-llm-proxy',
    configureServer(server) {
      server.middlewares.use(llmMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(llmMiddleware);
    },
  };

  return {
    plugins: [reactPlugin(), llmPlugin],
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
