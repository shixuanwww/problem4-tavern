# 实现期与 PLAN 的偏离记录（notes on plan conflicts）

> 记录时间：2026-10-11
> 用途：`PLAN.md` 是执行规格。实现过程中发现规格有**技术假设不成立**或**自身缺项**的地方，
> 逐条记在这里。**每一条都说明：PLAN 怎么写 / 实际怎么做 / 为什么必须这样**。

---

## 1. `SkipReason` 增加 `duplicate_id`（PLAN 自身缺项）

- **PLAN 怎么写**：§4.10 要求"引擎去重时被丢弃的条目**必须记入 `skipped`**，不得静默丢条目"；
  §11 也写"V2 转换后多条映射到同一 ID ⇒ 按 `entry.id` 去重，被丢弃者记入 `skipped`"。
  但 §3 的 `SkipReason` 枚举里**没有**能表达"重复被丢弃"的取值。
- **实际怎么做**：`SkipReason` 增补 `'duplicate_id'`（`src/core/types.ts`），
  `activateWorldBook()` 在遇到重复 `entry.id` 时写入 `{ reason: 'duplicate_id', source: 'entry' }`。
- **为什么**：不补这个值，就只有两条路 —— 要么违反 PLAN 静默丢条目，要么硬塞进语义不符的既有枚举。
  补一个取值是最小改动，且 UI 侧的"未发送原因"表能直接显示它。

---

## 2. `SnapshotPart` 增加可选字段 `role?`（PLAN 自身缺项）

- **PLAN 怎么写**：§3 的 `SnapshotPart` 只有 `index / kind / sourceId / label / content / tokens`。
- **实际怎么做**：增补**可选**字段 `role?: Role`；`buildRequest()` 写入它，
  `partsToChat()` 用它把冻结的 `parts` 还原成真正发给模型的消息数组。
- **为什么**：题面要求"保存发送后的请求快照"并支持查看/回放。若 `parts` 不带角色，
  快照就只是"一堆文本"，无法还原成一次真实请求，回放与"看当时到底发了什么"都会失真。
  因为是可选字段，旧数据（没有 role）仍能读，`partsToChat()` 对缺失值回落 `system`。

---

## 3. `Session` 增加可选字段 `variables?`（PLAN 自身缺项，等级 4 用）

- **PLAN 怎么写**：§4.12 说模板变量来源 = "当前角色卡字段（`char`）+ **会话级别的自定义变量表**
  （`{{location}}`、`{{hp}}` 等）"，但 §3 的 `Session` 里没有承载这个变量表的字段。
- **实际怎么做**：`Session.variables?: Record<string, string>`；`buildRequest()` 组装
  `{ char: 角色卡名, ...session.variables }` 交给 `expandTemplate()`。
- **为什么**：没有这个字段，"会话级自定义变量"无处安放，只能落到会话设置里做成隐式约定 —— 更糟。

---

## 4. 🔴 `/llm` 代理：不用 `server.proxy`，改为自写转发中间件（**PLAN 的技术假设不成立**）

- **PLAN 怎么写**：§2.1 / §5 L1 / §11 都要求"在 `vite.config.ts` 配 `server.proxy` /
  `preview.proxy`，用 http-proxy 的 **`router(req)`** 按请求头 `x-llm-base-url` 动态选 target、
  用 `configure(proxy)` 的 `proxyReq` 注入 `Authorization`"。
- **实际情况**：**Vite 7 不再依赖 `http-proxy`**（`node_modules/vite/package.json` 的 dependencies
  里没有它，代理是自带实现），并且：
  - `router` 是 **http-proxy-middleware** 的选项，**不在** Vite 的 `ProxyOptions` 里
    （`tsc` 直接报 `'router' does not exist in type 'ProxyOptions'`）；
  - `target` 的类型是 `ProxyTarget = string`，**不接受函数**（`tsc` 报
    `Type '(req) => string' is not assignable to type 'ProxyTarget'`）。
  ⇒ 用 `server.proxy` **无法**做到"每个请求按请求头动态选 target"。
- **实际怎么做**：在同一个 `vite.config.ts` 里写一个 ~70 行的 `/llm` 转发中间件，
  挂在 `configureServer` / `configurePreviewServer` 上（`src` 侧零改动，前端仍然只认 `/llm`）：
  1. `GET /llm/defaults` → 返回 `.env` 的 `{ baseUrl, model }`（**绝不返回 key**）；
  2. 其余 `/llm/*` → 按请求头 `x-llm-base-url` 动态选目标，否则回落 `.env` 的 `LLM_BASE_URL`；
  3. 在 Node 侧注入 `Authorization: Bearer <x-llm-api-key || .env 的 LLM_API_KEY>`；
  4. **不改写请求体**；**逐块透传响应**（SSE 才能一段段到达）。
  `scripts/static-proxy.mjs`（装不了依赖时的兜底）用的是**同一套逻辑**。
- **为什么必须这样**：动态 target 是题面"能够配置服务地址"的直接要求（用户在面板里改 baseUrl
  必须立刻生效，而不是重启 dev server）。既然 Vite 的 proxy 做不到，就只能自己转发 ——
  语义与 PLAN §2.1 完全一致，只是实现载体从 `server.proxy` 换成中间件。
- **等价性自检（已实测）**：`curl` 打 `POST /llm/chat/completions` 拿到真实回复；
  `stream: true` 时返回多个 `data:` 分块 + `data: [DONE]`。
- **同步**：PLAN §2.1 与 §11 已就地标注这条修订，避免下次读规格时按旧写法实现一遍。

---

## 5. 测试的覆盖口径

`tests/` 用 Node 内置 test runner（`node --experimental-strip-types --test tests/*.test.ts`），
**不引入 `vitest`**（与 handoff §2.3 的依赖上限一致）。
当前 **77 个用例全绿**：前 50 条覆盖 PLAN §8 的 18 条验收项（世界书五条规则、装配顺序、
`uiHidden` / `excluded` / 删除的分离、快照冻结、V2 映射与错误处理、预设校验与模板展开等）。

## 6. 等级 1 的四条硬要求：判定抽成 `core/messaging.ts`（**覆盖口径的补强**）

- **原状**：题面【等级 1】点名的四条"必须正确处理"里，有三条只写在 `state/store.tsx`（依赖 React hooks）
  与 `storage/repo.ts`（依赖 `indexedDB` 全局）的函数体中 —— `node --test` **一条也覆盖不到**，
  只剩"人工演示 + 截图"这一种证据。项目又刻意不引 `fake-indexeddb`，所以原地没法补测。
- **实际怎么做**：把其中**纯判定**的部分抽到新模块 `src/core/messaging.ts`
  （`planRetry` / `finalStreamStatus` / `repairStreamingMessages` / `orderedSessionMessages`），
  `store` / `repo` 改为调用它们（行为逐行等价，只是 if/else 变成函数调用）；
  另把 SSE 的增量解码抽成 `core/llm.ts#createSseDecoder`、把导入的 ID 重映射抽成
  `storage/repo.ts#planImport`。新增 `tests/l1-behaviors.test.ts`（27 条）后总数 **50 → 77**。
- **顺带修掉一个真问题**：`persistImport` 一直把随包的世界书写进库，却没有放进 `ImportResult` 的
  返回值类型里（调用方拿不到"这次导了哪几本"）。抽 `planImport` 时被 `tsc` 抓出来，已补上
  `worldBooks?: WorldBook[]`（**纯增量字段**，不改既有调用方行为）。
- **为什么值得改**：这四条是题面里唯一被点名"必须正确处理"的行为，也是最可能被追问
  "你怎么保证"的地方。现在每条都有可复跑的断言（`docs/defense/12-l1-message-rules.md` 给了答辩口径）。
