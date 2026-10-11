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

**唯一不可外包的一件事**：答辩（题面明说答不出细节会被判过度使用 AI）—— 所以 `docs/defense/` 是逐模块的问答稿，共 12 份。

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

## 3. 复核阶段做了什么（可复跑）

命令一律在 `problem4-tavern/` 下执行：

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 error**（`strict` + `noUnusedLocals`） |
| 单元测试 | `npm test`（= `node --experimental-strip-types --test "tests/*.test.ts"`） | **77 / 77 pass** |
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
- **答辩口径**：`docs/defense/`（12 份，逐模块"这段在干什么 / 关键决策与为什么 / 会被追问什么"）。
