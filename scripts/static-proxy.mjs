#!/usr/bin/env node
/**
 * 零依赖静态服务 + 模型代理 —— 给「装不了依赖」的场景兜底。
 *
 * 为什么需要它：
 *   dist/ 里的前端一律把模型请求打到 /llm（浏览器不直连第三方 API，避开 CORS）。
 *   如果用任意静态服务器打开 dist/，没有 /llm 代理也不会有 /llm/defaults，
 *   结果是「界面能看、聊天必失败」。这个脚本把这两件事一起补上，于是
 *   没有 node_modules 也能真正跑起完整功能。
 *
 * 用法：
 *   npm run build          # 生成 dist/
 *   node scripts/static-proxy.mjs
 *   浏览器打开 http://localhost:4173
 *
 * 环境变量：PORT（默认 4173）、以及 .env / .env.local 里的 LLM_BASE_URL / LLM_MODEL / LLM_API_KEY
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);
const LLM_PREFIX = '/llm';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** 手写 ~15 行 .env 解析，避免为了 dotenv 破坏「零依赖」 */
function loadLlmEnv() {
  const out = {};
  for (const file of ['.env', '.env.local']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return out;
}

const env = loadLlmEnv();
const envBaseUrl = (env.LLM_BASE_URL || '').trim();
const envModel = (env.LLM_MODEL || '').trim();
const envApiKey = (env.LLM_API_KEY || '').trim();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function forwardToModel(req, res, url) {
  const fromHeader = String(req.headers['x-llm-base-url'] || '').trim();
  const baseUrl = /^https?:\/\//i.test(fromHeader) ? fromHeader : envBaseUrl;
  if (!baseUrl) {
    sendJson(res, 500, {
      error: 'no_base_url',
      message:
        '没有可用的模型服务地址：请在前端「模型设置」里填 baseUrl，或在 .env / .env.local 里配置 LLM_BASE_URL。',
    });
    return;
  }

  const target = baseUrl.replace(/\/+$/, '') + url.pathname.replace(/^\/llm/, '') + url.search;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (['host', 'content-length', 'connection', 'x-llm-base-url', 'x-llm-api-key'].includes(key)) {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  const apiKey = String(req.headers['x-llm-api-key'] || '').trim() || envApiKey;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'follow',
    });
  } catch (error) {
    sendJson(res, 502, {
      error: 'upstream_unreachable',
      message: `连不上模型服务 ${baseUrl}：${error && error.message ? error.message : String(error)}`,
    });
    return;
  }

  const outHeaders = {};
  for (const name of ['content-type']) {
    const value = upstream.headers.get(name);
    if (value) outHeaders[name] = value;
  }
  res.writeHead(upstream.status, {
    ...outHeaders,
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });

  if (!upstream.body) {
    res.end();
    return;
  }
  // 逐块透传，SSE 才能一段段到达（不能整流缓冲）
  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

async function serveStatic(res, url) {
  const requested = decodeURIComponent(url.pathname);
  let filePath = normalize(join(DIST, requested));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dist/ 里没有找到构建产物，请先运行 npm run build。');
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === `${LLM_PREFIX}/defaults`) {
    sendJson(res, 200, { baseUrl: envBaseUrl, model: envModel });
    return;
  }
  if (url.pathname.startsWith(`${LLM_PREFIX}/`)) {
    void forwardToModel(req, res, url);
    return;
  }
  void serveStatic(res, url);
});

server.listen(PORT, () => {
  const hasKey = envApiKey ? '已读取 .env 里的 key' : '未在 .env 里读到 key（可在前端面板填）';
  console.log(`[static-proxy] 静态目录: ${DIST}`);
  console.log(`[static-proxy] 模型默认: ${envBaseUrl || '(未配置)'} / ${envModel || '(未配置)'} —— ${hasKey}`);
  console.log(`[static-proxy] 打开 http://localhost:${PORT}`);
});
