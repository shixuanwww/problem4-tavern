# 工作过程记录（session 摘要）

> 题面全局要求：「**如果方便的话可以留下你的 session**」；以及「我们会针对项目细节深入提问，**如果答不出细节可能会被认为过度使用 AI**」。
> 本文件是**可核对的摘要**，不是逐轮对话副本 —— 完整 transcript 在各工具的会话里（见 §5「原始记录在哪」），需要时可导出。
> 所有"完成了什么"的说法，都以**仓库里可复跑的命令或 git 提交**为准，不以口头结论为准。

---

## 1. 人机分工（谁决定了什么）

| 角色 | 负责 |
|---|---|
| **人**（出题交付方） | 范围定案（四题全做、先保底再深挖）、口径仲裁（PLAN 与题面冲突时**以题面原文为准**）、验收（只看可复跑的用例输出 + 演示输出 + commit hash） |
| **AI · 实现** | 按 `PLAN.md` 写 `src/`、`tests/`、README、答辩问答、样例数据与构建产物；每个阶段自行跑用例后再提交 |
| **AI · 复核与加固** | 独立复跑类型检查 / 单测 / 构建 / 真实模型联通；审查"声称的保证"与代码是否一致；把等级 1 的四条硬要求从"只有实现"补成"有可复跑断言"（见 §4） |

**唯一不可外包的一件事**：答辩（题面明说答不出细节会被判过度使用 AI）—— 所以 `docs/defense/` 是逐模块的问答稿，共 13 份（12 份模块问答 + 1 份交付前验收 checklist）。

## 2. 时间线（2026-10-11，时间取自文件 mtime 与 git 提交）

| 时间 | 事件 |
|---|---|
| 14:05–14:45 | 题面摘录（`docs/problem-statement.md`）、参考项目清单、交接说明；四题 PLAN 落定 |
| 15:25 起 | 口径由"只出规格"改为"由 AI 写实现"；15:30 起四题并行 |
| 15:33–15:45 | T4 骨架与工具链（`0207b4d`）：React 18 + TS + Vite，运行时依赖只有 `react`/`react-dom` |
| 15:36–15:52 | 纯函数内核 `src/core/`（`932e038`）→ 存储与状态（`66a4197`）→ 界面层 12 组件（`847b705`） |
| 15:37–15:57 | 五个模块的单测 50 条（`78f94b7`） |
| 15:45–16:02 | README（题面 5 问式说明）、`docs/defense/` 11 份、`samples/` 4 件、`scripts/static-proxy.mjs`（`04c3876`） |
| 16:07 | 浏览器端人工走查 + 12 张界面截图（`docs/screenshots/01–12`） |
| 16:15 | 提交构建产物 `dist/`（`48654c8`），供安装期无网时直接看界面 |
| **16:30 之后** | **复核与加固**（本文件 §3/§4 记录的就是这一段）：类型检查 / 77 条单测 / 构建 / 真实模型流式实测 / L1 硬要求可测化 / 截图去重 |
| 17:00 之后 | **代码审计与修复轮**（§6）：结合题面逐条审 30 个源文件，发现 12 处问题（6 处功能缺陷 + 6 处"文档与实现不一致"），修完补 6 条回归用例（77 → 83），并用真实浏览器冒烟验证；新增交付前验收 checklist |

## 3. 复核阶段做了什么（可复跑）

命令一律在 `problem4-tavern/` 下执行：

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 error**（`strict` + `noUnusedLocals`） |
| 单元测试 | `npm test`（= `node --experimental-strip-types --test "tests/*.test.ts"`） | **77 / 77 pass**（当轮；审计轮后为 **83 / 83**，见 §6） |
| 生产构建 | `npm run build` | 成功；产物哈希与入库的 `dist/` **一致** ⇒ 入库产物就是这份源码的产物 |
| 兜底交付路径 | `npm run serve:dist` → `GET /`、`GET /llm/defaults` | 200；defaults **不返回 key** |
| 真实模型（非流式） | 经 `/llm` 代理打公益站 | HTTP 200，正常回复 |
| **真实流式** | 同一路径 `stream:true` | `reader.read()` 3–4 次 / `onDelta` 3 次，正文拼回正确，响应头 `x-accel-buffering: no` |
| 密钥净室 | 全仓扫 key 前缀 | 入库文件**零真实 key**（`docs/problem-statement.md` 里是掩码 `gg-gcli--****`）；`.env.local` 未被 git 跟踪 |

> ⚠️ 诚实边界：上游公益站**偶尔**会把整段回复合并成一个 HTTP 分块（实测出现过一次），
> 那种情况下"逐块到达"受限于上游，不是前端能决定的；用 `curl` 直接打同一路径可以复现同样的现象。

## 4. 复核阶段改了什么（本次加固）

1. 🔴 **把等级 1 四条"必须正确处理"里的三条补上可复跑断言**（原状：只有实现、没有测试，因为判定长在 React 与 IndexedDB 中间）。
   做法是把**纯判定**抽到新模块 `src/core/messaging.ts`（`planRetry` / `finalStreamStatus` / `repairStreamingMessages`），
   `store` / `repo` 行为逐行等价；另把 SSE 增量解码抽成 `core/llm.ts#createSseDecoder`、导入的 ID 重映射抽成 `storage/repo.ts#planImport`。
   新增 `tests/l1-behaviors.test.ts`（27 条）⇒ 用例总数 **50 → 77**。
2. **顺带修掉一个真问题**：`persistImport` 会把随包的世界书写进库，却没放进 `ImportResult` 的返回类型
   （调用方拿不到"这次导了哪几本"）—— 抽纯函数时被 `tsc` 抓出，已补 `worldBooks?: WorldBook[]`（纯增量字段）。
3. **删掉 6 张过期的界面截图**（15:47 的旧命名一套），避免目录里两套编号并存误导评审。
4. 🔴 **修掉一个会让"无网兜底"静默失效的坑**：`.gitignore` 里的 `dist/` 会让**新增**的哈希产物
   （每次构建文件名都变）被静默跳过 —— 重建后 `git add` 提交了新 `index.html`，却**没提交它引用的那个 js**，
   静态打开就是白屏。历史上靠 `git add -f dist/` 绕过（README §1 也这么写），但**靠人不靠机制**。
   已改为显式放行 `!dist/**`，并用 `git archive HEAD dist` 导出已提交内容逐个核对
   `index.html` 的引用（`assets/index-*.js`、`assets/index-*.css` 均在库里）。
5. 同步文档口径：README、`docs/notes-plan-conflicts.md`、`docs/defense/README.md` 的用例数与模块数；
   新增答辩稿 `docs/defense/12-l1-message-rules.md`。

## 5. 原始记录在哪

- **git 提交**：`git log --oneline` 共 9 条，阶段划分即开发顺序（骨架 → core → storage/state → ui → 测试 → 文档 → dist → 本轮加固）。
- **实现阶段的完整对话**：工具侧会话日志（本机 `~/.workbuddy/logs/`），需要时可按小时段导出附上。
- **复核与加固阶段的记录**：本文件 + 各次提交的 message；关键结论都有对应的可复跑命令（§3）。
- **答辩口径**：`docs/defense/`（13 份：12 份模块问答 + `13-delivery-checklist.md` 交付前验收清单）。

## 6. 代码审计与修复轮（2026-10-11 晚 · 4 个提交）

**触发**：把题面（等级 1–4 的每一条 + §0 的三条"最容易被忽略的原话"）与 `src/` 30 个文件逐条对照，
并真实跑一遍构建 / 单测 / 浏览器冒烟，审"声称的保证"与代码是否一致。

**查出 12 处问题**，其中 6 处是功能缺陷（会真的影响演示与正确性）：

1. 🔴 **待发送消息挤掉世界书扫描窗口**：用户消息"入库即 complete"，`runGeneration` 又通过
   `extraMessages` 传同一份 ⇒ 它既进"最近 N 条合格历史"又当 pending，占掉两格窗口。
   后果是**预览里激活的世界书条目、真正发送时不激活**，而题面的"发送前预览 / 检查视图"正靠这条一致性立住。
   修法：`buildRequest()` 入口按 `message.id` 去重 + 把 `seq === pendingSeq` 那条从扫描集与 `history` 一起剔除。
2. **覆盖导入 ≠ 替换**：`persistImport` 只 `put` 不删旧记录 ⇒ "用 2 条消息的包覆盖 8 条消息的会话"变 10 条。
   修法：覆盖前按 `sessionId` 清旧 messages/snapshots，内存层新增 `session/replace`。
3. **随包导入的世界书没进内存**：`applyImport` 忘了 `worldbook/upsert` ⇒ 会话引用了却不生效、刷新后才出现。
4. **导入冲突只看会话 ID**：题面原话是"与**已有资源**同 ID"。修法：五类资源都算（旧签名行为不变）。
5. **全新浏览器首次启动缺角色卡**：`ensureDefaultCharacter()` 返回值被丢弃、`newSession` 也不补 dispatch
   ⇒ 装配找不到角色卡（预览里没有角色卡部分）。修法：`createSession` 返回实际绑定的卡 + 启动并入 `db.characters`。
6. **生成期写入会覆盖用户操作**：节流写与收尾写都用闭包里的旧 `assistant` 对象，会把用户中途改的
   `uiHidden` / `excluded` 打回原值；删会话后收尾还会把刚级联删掉的消息写回库（孤儿记录）。
   修法：写库前用内存里最新那条做基底、只覆盖 `content`/`status`；`removedSessions` 拦住已删会话的收尾写。

另 6 处是"文档说了、实现没做（或反之）"，一并改成事实：检查视图"命中消息"锚点缺 `id`、
80% 阈值口径与 README 不符（`isOverWarnThreshold` 曾是死代码）、提醒条的"入口"只是滚到顶部、
`hydrate` 的 `preferredActiveId` 是死分支（刷新并不恢复上次会话）、角色卡"被忽略的运行规则"漏掉
写条目**顶层**的字段、导入冲突弹窗缺明细。

**证据与提交**（`git log --oneline`）：

| 提交 | 内容 |
|---|---|
| `7aab090` | `fix(core,state,storage,ui)`：6 处功能缺陷 + 附带小项（12 文件） |
| `c81b57b` | `test:`：新增 `tests/fixes.test.ts`（**6 条**，77 → 83） |
| `b9fc99a` | `docs:`：README / PLAN / 答辩稿 / `notes-plan-conflicts.md` §7 口径同步 |
| `36323b8` | `build:`：重建 `dist/`（与源码逐字节一致） |

**复核结论（可复跑）**：`npx tsc --noEmit` 0 error；`npm test` **83/83**；`npm run build` 后
`git status` 仍为空（入库产物 = 这份源码的产物）；`rg -c "gg-gcli" dist` 为 0。
另用真实浏览器（起 `static-proxy` 后打开 `localhost:4173`）冒烟：控制台 **0 error/0 warning**，
新建会话**预览里就有角色卡**、刷新**回到上次停留的会话**、导入样例后**不刷新世界书即生效**、
重复导入弹出**五类同 ID 冲突明细**、创建副本**引用一次性重映射**、覆盖**无报错且消息数回到包内条数**。

> ⚠️ **诚实边界**：这一轮**没有**由复核方重跑"真实模型对话"（那要往第三方公益站发数据）。
> 交付前请按新增的 [`docs/defense/13-delivery-checklist.md`](defense/13-delivery-checklist.md) §2 走一遍，
> 并把 EventStream 分块那张截图补进 `docs/screenshots/`。
