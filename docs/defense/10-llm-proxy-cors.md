# 模块 10 · `/llm` 代理与 CORS

> 源码：`vite.config.ts`（dev / preview 中间件）+ `scripts/static-proxy.mjs`（零依赖兜底）+ `src/core/llm.ts`（客户端）
> 题面位置：§2 范围与技术要求"**可以接入自己选择的模型 API，能够配置服务地址、模型名称、API Key 等必要参数，并实际完成聊天**"

## ① 这段在干什么

**浏览器永远不直连第三方 LLM API**。前端只往**同源**的 `/llm/*` 发请求：

| 前端请求 | 代理做什么 |
|---|---|
| `POST /llm/chat/completions` | 按请求头 `x-llm-base-url` 选目标 → 拼成 `<baseUrl>/chat/completions` → 注入 `Authorization: Bearer <key>` → **逐块透传**响应 |
| `GET /llm/defaults` | 返回 `{ baseUrl, model }`（取自 `.env`）—— **绝不返回 key** |

## ② 关键设计决策 + 为什么

### 2.1 🔴 为什么必须有代理（而不是让浏览器直连）

第三方 LLM API 的响应通常**不带** `Access-Control-Allow-Origin`（或者不允许你的 localhost 源）。
浏览器发起跨域 `fetch` 时会被 **CORS 预检 / 响应校验**拦下 —— 表现是
"控制台报 CORS 错误、`fetch` reject、界面上什么都收不到"。
这是评审机现场最容易翻车的一类问题：**代码全对、一联调就死**。

代理把请求变成**同源**（`http://localhost:5173/llm/...`），CORS 从源头不出现。
Node 侧发起的出站请求没有同源策略限制，所以能正常拿到响应。

### 2.2 目标地址**动态**：面板里改 baseUrl 立刻生效

题面要求"**能够配置服务地址**"。如果 target 写死在配置里，用户改完得重启 dev server —— 体验很差。

所以代理支持**逐请求**决定目标：

```
请求头 x-llm-base-url 是合法 http(s):// → 用它
否则                                    → 回落 .env 的 LLM_BASE_URL
Authorization                           → x-llm-api-key（若有）否则 .env 的 LLM_API_KEY
```

前端侧（`core/llm.ts`）：

```ts
if (settings.baseUrl.trim()) headers['x-llm-base-url'] = settings.baseUrl.trim();
if (settings.apiKey.trim())  headers['x-llm-api-key']  = settings.apiKey.trim();
```

### 2.3 🔴 为什么不用 `server.proxy`（**PLAN 的技术假设不成立**）

PLAN §2.1 / §5 / §11 要求"配 `server.proxy`，用 http-proxy 的 **`router(req)`** 按请求头动态选 target"。
实际核查（`node_modules/vite/dist/node/index.d.ts`）：

- Vite 7 的 `ProxyOptions` **没有** `router` 字段（`router` 是 http-proxy-middleware 的选项）；
- `target` 的类型是 `ProxyTarget`（字符串），**不接受函数**。

⇒ 用 `server.proxy` **做不到**"按请求头动态选 target"。因此本项目在同一个 `vite.config.ts` 里
写了一个 **~70 行的 `/llm` 转发中间件**挂在 `configureServer` / `configurePreviewServer` 上，
**语义与 PLAN 完全一致**，只是载体从 `server.proxy` 换成中间件。
（完整记录见 `docs/notes-plan-conflicts.md` §4；PLAN §2.1/§11 也已就地标注这条修订。）

中间件只做四件事，**别的一概不做**：

1. `/llm/defaults` → 返回 `{baseUrl, model}`，**不含 key**；
2. 其余 `/llm/*` → 动态选 target；
3. Node 侧注入 `Authorization`；
4. **不改写请求体**、**不缓冲响应**（`for await (chunk of upstream.body) res.write(chunk)`）。

### 2.4 🔴 不改写请求体（这条要主动解释）

第一版设计曾考虑"代理侧注入默认 model"。放弃了，原因是**改 body 需要缓冲整个请求体**：
读全部 → 改 JSON → 重算 `Content-Length` → 转发。这会引入两个真实风险：
① 流式请求体（大 prompt）被截断；② 上游连接被卡住。
而**收益是零**：让前端**始终显式发送 `model`** 就够了 —— 启动时从 `/llm/defaults`
把 `.env` 里的 model 取回来预填到设置面板，前端每次请求都带上它。
代理只负责"路由 + 鉴权"，职责边界反而更清楚。

### 2.5 `.env` 用 `LLM_` 前缀，**刻意不用 `VITE_`**

`VITE_*` 会被 Vite **编译期内联进客户端 bundle**：只要有人写一句
`import.meta.env.VITE_LLM_API_KEY`，key 就永久躺在 `dist/assets/*.js` 里。
本项目用 `loadEnv(mode, process.cwd(), 'LLM_')` **只在 Node 侧**读取，
`.env` / `.env.local` 里的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 都是**服务端默认值**，
浏览器侧的代码里**根本没有这些变量名**。

**实测证据**（交付前已跑）：`grep -c "gg-gcli" dist/assets/*.js` → **0**；
bundle 里唯一出现 `LLM_API_KEY` 字样的地方是设置面板的 placeholder 文案
（"留空则用 .env 里的 LLM_API_KEY"），**不是值**。

### 2.6 三种配置状态与"key 落在哪"

| 用户是否在面板填了 | 结果 | 浏览器是否持有 key |
|---|---|---|
| baseUrl / model 留空 | 用 `.env` 的默认值（面板已由 `/llm/defaults` 预填） | ❌ 不持有（key 只在服务端 `.env`） |
| 只填了 baseUrl | target 用用户的，key 仍用 `.env` 的 | ❌ 不持有 |
| 填了 apiKey | key 由用户提供，经 `x-llm-api-key` 交给代理 | ✅ **持有**（存 IndexedDB） |

**README 与设置面板都必须写明这一点**（本项目两处都写了）：
"你在这里填的 Key 会保存在浏览器本地（IndexedDB）。共用电脑上不要填私人 Key；清掉浏览器数据就会失效。"

### 2.7 兜底路径：`scripts/static-proxy.mjs`（零依赖）

`dist/` 里的前端只认 `/llm`。如果用一个**普通静态服务器**打开 `dist/`，
既没有 `/llm` 代理、也没有 `/llm/defaults`，结果就是"**界面能看、聊天必失败**"。

`scripts/static-proxy.mjs` 用 `node:http` + `node:fs` **零依赖**实现了
"静态服务 `dist/` + 转发 `/llm` 与 `/llm/defaults`"，逻辑与 dev 中间件**同一套**：
自写 ~15 行 `.env` 解析、动态选 target、注入 `Authorization`、逐块透传。
于是"装不了依赖"的机器上：

```bash
node scripts/static-proxy.mjs     # 打开 http://localhost:4173，能真正聊天
```

**实测证据**：`curl POST http://localhost:4180/llm/chat/completions` 拿到真实模型回复；
`/llm/defaults` 返回 `{"baseUrl":"https://gcli.ggchan.dev/v1","model":"gemini-3.8-flash"}`（无 key）。

### 2.8 SSE 必须逐块到达（等级 1 "逐步展示 ai 的回复"）

代理**不能**把响应整流缓冲 —— 否则"流式"会退化成"等整段返回后一次性出现"。
实现上：

- Node 侧用 `for await (const chunk of upstream.body) res.write(chunk)`，不做任何聚合；
- 显式设置 `x-accel-buffering: no`，告诉可能的中间层（nginx 等）不要缓冲。

**实测证据**：`curl -N` 打 `stream: true`，观察到 **4 个 `data:` 分块**（含增量 delta）并以
`data: [DONE]` 结束 —— 即真实的多段增量到达。

## ③ 可能被追问的问题

**Q1：`/llm/defaults` 会不会把 key 泄漏出去？**
不会。它 `res.end(JSON.stringify({ baseUrl, model }))`，**响应体里没有 key 字段**。
key 只用于出站请求头（`authorization`），从不回给浏览器。
这条在 `vite.config.ts` 与 `static-proxy.mjs` 两处实现里都一样。

**Q2：为什么不做一个"直连模式"当后备？**
因为那会把 CORS 问题重新引回来 —— 一个"有时能用有时不能用"的模式比"只有一个正确路径"更难排查。
本项目**只有 `/llm` 一条路径**，README 里也写明了"没有直连模式"。
真遇到代理不可用的场景（例如静态打开 dist），兜底手段是**启动 static-proxy**，而不是绕开代理。

**Q3：改了 `.env` 里的 `LLM_BASE_URL` 需要重启吗？面板里改呢？**
`.env` 是**启动时**由 `loadEnv` 读进来的（dev server 进程级），所以**改它必须重启**。
面板里改 `baseUrl` **不需要**重启 —— 它走 `x-llm-base-url` 请求头，逐请求动态路由。
这正是"动态 target"这个设计的价值所在。

**Q4：`npm run preview` 演示也能用吗？**
能。中间件同时挂在 `configureServer`（dev）与 `configurePreviewServer`（preview）上，
两处都注册，所以 `vite preview` 下 `/llm` 与 `/llm/defaults` 都可用。
（这点比 `server.proxy` 方案更省事：原方案要额外配一份 `preview.proxy`。）

**Q5：请求头里带 baseUrl，会不会被浏览器当成自定义头触发预检？**
会触发预检 —— 但那是**同源**的预检（打到 dev server），而 dev server 的中间件直接处理，
不涉及跨域策略。真正的跨域决策发生在 **Node 侧发起出站请求**时，那里没有同源策略。

**Q6：如果上游挂了呢？**
代理返回明确错误而不是静默：
- 没配 baseUrl → `500 {error:'no_base_url', message:'…请在「模型设置」里填 baseUrl…'}`
- 连不上上游 → `502 {error:'upstream_unreachable', message:'连不上模型服务 <baseUrl>：…'}`
前端把非 2xx 转成聊天区的错误卡（模块 09 §2.7），**不白屏**。
