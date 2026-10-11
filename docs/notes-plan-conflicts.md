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
当前 **83 个用例全绿**：前 50 条覆盖 PLAN §8 的 18 条验收项（世界书五条规则、装配顺序、
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

---

## 7. 代码审计修复轮（2026-10-11 晚）：把 6 处"实现与文档/题面不一致"修掉

> 这一轮不是新增功能，是**审计发现的缺陷修复**。每条都写了"错在哪 / 怎么修 / 谁保证"。
> 新增回归用例在 `tests/fixes.test.ts`（6 条），总数 77 → **83**。

- **① 待发送消息挤掉世界书扫描窗口（最严重）**
  - **错在哪**：用户消息"入库即 complete"（PLAN §11 的选择），`runGeneration` 又会把同一条消息
    通过 `extraMessages` 再传一次。于是它既出现在"最近 N 条合格历史"里、又作为 pending 出现 ——
    **同一份内容占掉两格扫描窗口**，还会把 `state.messages` 与 `extraMessages` 两份都算进去。
    后果：`scanDepth=3` 时"最近 3 条"实际只扫到 2 条旧消息，**预览里激活的世界书条目，真正发送时不激活**，
    而题面的"发送前预览 / 检查视图"正是靠这一致性立住的。
  - **怎么修**：`buildRequest()` 入口做两件归一化 —— 按 `message.id` 去重；
    把 `seq === pendingSeq` 的那条从扫描集与 `history` 里剔除（它只在 `pending` 部分出现一次）。
    预览与真实发送因此共用同一份消息集合。
  - **谁保证**：`tests/fixes.test.ts` 前两条（预览 vs 发送的激活结果与 parts 序列必须逐项相同）。
- **② 覆盖导入 ≠ 替换**：`repo.persistImport` 只 `put` 不删旧记录，覆盖一个 8 条消息的会话会变成
  "2 条新的 + 6 条旧的"。现在 overwrite 会先按 `sessionId` 清掉本地 messages / snapshots；
  内存层新增 `session/replace` 动作（原先只有 upsert，没有"整体替换"的表达能力）。
- **③ 随包导入的世界书没进内存**：`persistImport` 早已把它们写库并返回，但 `applyImport` 忘了 dispatch
  `worldbook/upsert` ⇒ 会话引用了它们却暂时不生效、刷新后才出现。已补。
- **④ 导入冲突只看会话 ID**：题面原话是"与已有资源同 ID"。`checkBundle` 现在把
  会话 / 消息 / 快照 / 世界书 / 角色卡五类都算出来（新增可选第三参 `existing`，旧签名行为不变），
  UI 的冲突弹窗逐项列出命中的资源。
- **⑤ 首次启动缺角色卡**：`ensureDefaultCharacter()` 只写库、返回值被丢弃，`newSession` 也不补
  `character/upsert` ⇒ 全新浏览器第一次演示时装配**找不到角色卡**（预览里没有角色卡部分）。
  现在 `createSession` 返回实际绑定的 `character`，启动时也把它并进 `db.characters`。
- **⑥ 生成期间的写入会覆盖用户操作**：流式节流写与收尾写都用闭包里那份旧 `assistant` 对象，
  会把用户在生成期间改的 `uiHidden` / `excluded` 打回原值；删会话后的收尾写还会把刚级联删掉的
  消息重新写回库里（孤儿记录）。现在写库前用"内存里最新的那条"做基底、只覆盖 `content` / `status`，
  并用 `removedSessions` 标记跳过已删会话的收尾写。
- **顺带修掉的不一致（小项）**：
  - 检查视图"命中消息"链接原先指向 `#msg-<id>`，但气泡上只有 `data-message-id` —— 点了没反应。已给气泡加 `id`。
  - README 曾宣称 80% 提醒"以冻结快照为准"，实际 UI 用的是实时装配值；`isOverWarnThreshold()` 一直是死代码。
    现在统一为：**提醒条按实时装配值精确比较**，快照负责"发之后复核"，README 已改写为事实。
  - 提醒条的"入口"原先只是把列表滚到顶部；现在会**把最近 2 条之外的消息整批选中**并显示隐藏消息，
    点一下工具栏的「批量不进上下文」就能一步排除。
  - `AppSettings.lastActiveSessionId`：`hydrate` 的 `preferredActiveId` 一直是死分支（store 从不传），
    刷新后并不恢复"上次打开的会话"。现在切换会话时落库，启动时用它做偏好。
  - 角色卡"被忽略的运行规则"原先只扫 `entry.extensions`，而 V2 的 `position` / `selective` /
    `secondary_keys` / `case_sensitive` 按规范是**条目顶层字段**（ST 导出才镜像进 extensions）⇒
    现在两处都看，手写卡也能如实列出。
