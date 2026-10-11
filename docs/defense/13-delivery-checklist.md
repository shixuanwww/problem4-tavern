# 交付前验收 checklist（照着走一遍）

> 用途：把"我这边能跑"变成"**有可复跑证据**"。交付 / 演示 / 答辩**之前**按顺序过一遍。
> 用法：每条都是三步 —— **怎么做 → 应该看到什么 → 证据**。
> 证据图例：`✅ 已有` 指 `docs/screenshots/` 里已经拍好的图；`TODO(截图)` 表示**还需要补一张**，
> 括号里是建议文件名，拍完放进 `docs/screenshots/`。

预计用时 **25–35 分钟**（其中“真实模型对话”占 5 分钟，“四条硬要求”占 10 分钟）。
命令一律在 `problem4-tavern/` 下执行。

---

## 0. 环境与冷启动（3 分钟 · 评测机可能没有缓存，必须验）

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 0.1 | `node -v` | **≥ 20.19 或 ≥ 22.12**（Vite 7 的硬要求；本机 22.14 已过） | TODO(截图 `13-node-version.png`) |
| 0.2 | `npm ci` | 无 error；装了 8 个包（react / react-dom / vite / plugin-react / ts / @types×3） | TODO(截图 `14-npm-ci.png`) |
| 0.3 | `npx tsc --noEmit` | **0 error**（strict + noUnusedLocals） | TODO(截图 `15-typecheck.png`) |
| 0.4 | `npm test` | **83 / 83 pass**（`node --experimental-strip-types --test "tests/*.test.ts"`） | TODO(截图 `16-tests.png`) |

> 0.2 失败（无网 / 私源不可达）就走兜底：直接用仓库里已提交的 `dist/` 打开，见 §1.3。

## 1. 三条启动路径（5 分钟）

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 1.1 **主路径** | `npm run dev` → 开 `http://localhost:5173` | 应用外壳出现；`新建会话` 后**立刻看到角色开场白**（内置卡 Caster） | ✅ `01-initial.png`、`02-opening.png` |
| 1.2 | 同页请求 `/llm/defaults` | 返回 `{"baseUrl":"…","model":"…"}` —— **绝不返回 key** | TODO(截图 `17-llm-defaults.png`) |
| 1.3 **兜底路径** | `npm run build` 后 `node scripts/static-proxy.mjs` → 开 `http://localhost:4173` | 同 1.1；日志打印“已读取 .env 里的 key” | TODO(截图 `18-static-proxy.png`) |

> 🔴 **纯静态打开 `dist/`（不起任何服务）的能力边界**：本地功能全可用，**模型请求必然失败**
> （前端只打同源 `/llm`，静态服务器没有这个代理，项目也没有“直连模式”）。演示时必须走 1.1 或 1.3。

## 2. 🔴 真实模型对话（最高优先级 · 5 分钟）

> 这是**唯一无法用单测证明**的一条：模型真能聊、而且回复是**逐块流式**到达。
> §3 的四条硬要求全都建立在“真的在流”之上，所以先验这条。

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 2.1 | 「设置 → 模型设置」填 `baseUrl` / `model` / `apiKey`（或 `.env.local` 里配好，面板留空） | 面板可改、**无需重启**（代理按请求头动态选 target） | ✅ `12-settings.png` |
| 2.2 | 输入一句话发送 | 聊天气泡**一段段变长**（不是等整段返回后一次出现） | ✅ `04-streaming.png`、`05-reply.png` |
| 2.3 **取证** | DevTools → Network → 过滤 `/llm/chat/completions` → 看该请求的 Response | 先是 `pending`，然后**多条 `data: {...}` 依次出现**，最后 `data: [DONE]`；响应头含 `x-accel-buffering: no` | **TODO(截图 `19-live-sse-network.png`：要拍到 Network 列表 + EventStream 分块)** |
| 2.4 **脚本化复现** | 见下方命令 | 终端里 `data:` 一行行**陆续**打印（不是一次性刷出） | TODO(截图 `20-live-sse-curl.png`) |
| 2.5 **反面** | 把 `baseUrl` 故意改成 `https://example.invalid/v1` → 再发一条 | 顶部出现 `role="alert"` 的**错误横幅** + 「打开模型设置」按钮；**不白屏**、聊天记录不丢 | TODO(截图 `21-error-banner.png`) |

2.4 的可复跑命令（**key 由 Node 侧代理从 `.env.local` 注入，命令行里不出现 key**）：

```powershell
# 需先起 dev server（npm run dev，端口 5173）
curl.exe -N -s -D - -X POST http://localhost:5173/llm/chat/completions `
  -H "content-type: application/json" `
  --data-raw '{"model":"gemini-3.8-flash","stream":true,"messages":[{"role":"user","content":"从1数到5，每个数字之间停一下"}]}'
```

> ⚠️ **诚实边界（一定要主动说）**：上游公益站**偶尔**会把整段回复合并成一个 HTTP 分块（复现过一次）。
> 那种情况下“逐块到达”受限于**上游**，不是前端能决定的。前端已经做到的是：不改写请求体、不缓冲响应、
> 逐块透传（`vite.config.ts` 的 `forwardToModel` 用 `for await` 逐块 `res.write`）。
> 判断方法：用 2.4 的 `curl` 直接打同一路径，能复现同样现象 ⇒ 说明分块粒度是上游给的。

## 3. L1 四条硬要求（10 分钟 · 题面点名“必须正确处理”）

> 判定逻辑在 `src/core/messaging.ts`（纯函数，已被单测钉住）；这里验的是**接到真实 UI 链路上仍然成立**。

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 3.1 重试不重复插入 | 连发 3 条消息 → 点「重试上一条」 | user 消息**仍然是 3 条**（不是 4 条）；被重试的那条重新生成，`seq` 不跳号 | ✅ `05-reply.png` + TODO(截图 `22-retry.png`) |
| 3.2 未完成回复不进上下文 | 点发送 → 生成到一半按 F5 → 打开「发送前预览」 | 被中断的气泡标 **`已中断`**；预览的 `history` 里**没有它**；「未发送原因」写着 `消息未完成（生成中 / 已中断）` | ✅ `07-inspector.png` + TODO(截图 `23-interrupted.png`) |
| 3.3 生成中切会话不串 | 在会话 A 发送 → 立刻切到会话 B（甚至新建一条）→ 回到 A | 回复**完整长在 A 的那条 assistant 上**；B 不受影响；你停在 B 就还在 B（不被“拽回”A） | TODO(截图 `24-switch-during-stream.png`) |
| 3.4 不卡“生成中” | 同 3.2，刷新后再等 10 秒 | 状态是 `已中断`（`interrupted`），**永远不会**停在“生成中…” | 同 3.2 |

> 3.1 / 3.2 / 3.4 有自动化断言（`tests/l1-behaviors.test.ts` + `tests/fixes.test.ts`）；
> **3.3 与“生成中删会话”“生成中改设置”目前只有代码防护**（`removedSessions` / 写库用内存里最新那条做基底），
> 没有自动化覆盖 ⇒ 这几条**必须现场手验，别只背结论**。

## 4. L2 消息三分离 / 世界书 / 检查视图 / 提醒（7 分钟）

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 4.1 三分离 | 对同一条消息分三次做：隐藏 → 不进上下文 → 删除 | ①隐藏：折叠 + 标 `已隐藏`，**预览里它还在**；②不进上下文：标 `未发送给 AI`，**预览里消失**、正文仍在、可「加回上下文」；③删除：真没了 | ✅ `07-inspector.png`、`08-preview.png` + TODO(截图 `25-three-way.png`) |
| 4.2 批量 + 筛选 | 工具条「只选 AI 消息」→「批量不进上下文」 | 被选中的一起进入 `excluded`，预览里同时消失 | TODO(截图 `26-batch.png`) |
| 4.3 `uiHidden` 不影响装配 | 隐藏一条 → 看「发送前预览」的 `history` | 这条**仍然在**（题面原话：“隐藏显示不改变发给 AI 的内容”） | 同 4.1 |
| 4.4 世界书 | 世界书面板建条目：一条关键词命中、一条常驻、一条禁用 | 检查视图四问都能答：发了哪些 / 每部分来自哪 / **哪个关键词、哪条消息触发** / **为什么没发**（禁用、未命中、超扫描深度、超预算、未完成、关闭上下文） | ✅ `09-worldbook.png`、`07-inspector.png` |
| 4.5 扫描深度语义 | 把 `scanDepth` 设 2，让关键词只出现在更早的消息里 | 该条目**不激活**；「未发送原因」里那些更早的消息标 `超出世界书扫描深度` | TODO(截图 `27-scan-depth.png`) |
| 4.6 上下文提醒 | 把 `contextLimit` 调到 1000 | 用量条变警示样式 + 出现「选中较早的消息」；点它会**整批选中**最近 2 条之外的旧消息（并自动显示隐藏消息），再点「批量不进上下文」即降下来 | TODO(截图 `28-usage-warn.png`) |

## 5. L3 预设 / 角色卡 / panel（5 分钟）

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 5.1 预设 | 「预设 → 导入预设 JSON」选 `samples/sample-preset.json` | 导入成功，可编辑 / 启停 / 排序；`{{char}}` 展开、缺失变量**保留原样**；绑定后立即参与编排 | ✅ `10-preset.png` |
| 5.2 预设报错 | 故意导入一个 `formatVersion: "9.9"` 的 JSON | 明确报“不支持的 formatVersion”，**不是**静默忽略 | TODO(截图 `29-preset-error.png`) |
| 5.3 角色卡 | 「角色卡」导入 `samples/sample-character-v2.json` | 名称 / 描述 / 开场白 / 内嵌世界书全部映射；「被忽略的运行规则」逐条列出（含写在条目**顶层**的 `position` / `selective` 等） | ✅ `11-character.png` |
| 5.4 `spec_version: "1.0"` | 同上改版本号再导入 | **明确拒绝**并说明支持范围（2.x） | TODO(截图 `30-card-v1-rejected.png`) |
| 5.5 panel 正常 | 发一条含示例标签的消息（可从 `samples/sample-message-with-panels.md` 复制） | 正文 + 状态卡（hp / 令咒 / location…字段名不写死）+ 选项按钮；**点按钮只填进输入框，不自动发** | ✅ `06-choice-filled.png` |
| 5.6 panel 兜底 | 把 JSON 改坏（`{"hp":10,}`）/ 标签不闭合 / `type="foo"` | **保留原文** + 折叠说明具体问题，**不丢内容、不白屏** | TODO(截图 `31-panel-error.png`) |

## 6. 导入导出（5 分钟 · 本轮刚修过的重灾区）

| # | 怎么做 | 应该看到什么 | 证据 |
|---|---|---|---|
| 6.1 导出 | 任一「导出」 | 下载 `标题-202610111530.json`；打开能看到 `format` / `formatVersion` / `session` / `messages` / `snapshots` / `characterCard` / `worldBooks` | TODO(截图 `32-export.png`) |
| 6.2 导入（无冲突） | 「导入会话」选 `samples/sample-session.json` | 直接导入成功；**不刷新**就能在预览里看到随包的世界书被激活 | TODO(截图 `33-import-clean.png`) |
| 6.3 导入（有冲突） | 再导入同一个文件 | 弹「本地已有同 ID 的资源」，**逐项列出**会话 / 消息 / 快照 / 世界书 / 角色卡命中的 ID，三选一：覆盖 / 创建副本 / 取消 | TODO(截图 `34-import-conflict.png`) |
| 6.4 创建副本 | 选「创建副本」 | 新会话标题带 `（副本 2）`；所有 ID 重映射且**引用一致**（检查视图里“命中消息”链接指向新 ID） | TODO(截图 `35-import-copy.png`) |
| 6.5 覆盖 = 整体替换 | 先在本地把该会话的消息删掉一条，再选「覆盖」 | 会话消息数**回到导入包的条数**（本地多出来的那条消失），不是新旧混在一起 | TODO(截图 `36-import-overwrite.png`) |
| 6.6 坏文件 | 导入一个语法错误的 JSON | 报“JSON 语法错误：…”，**不**产生半个会话 | 同 5.2 风格 |

## 7. 收尾自检（3 分钟 · 交付前的最后一道门）

| # | 怎么做 | 应该看到什么 |
|---|---|---|
| 7.1 密钥净室 | `git grep -n -I -E "gg-gcli\|LLM_API_KEY" -- .` 与 `rg -c "gg-gcli" dist` | 入库文件**零真实 key**；命中只出现在 `.env.example` 占位、文档文案、`docs/problem-statement.md` 的掩码 `gg-gcli--****` |
| 7.2 有没有把 key 提交进去 | `git log --all --stat -- .env.local` 与 `git status --porcelain` | 无输出（`.env.local` 与 `*.local` 均被 `.gitignore` 排除） |
| 7.3 dist 与源码一致 | `npm run build` 后 `git status --short` | **空**（重建产物与入库产物逐字节一致 ⇒ 提交的 `dist/` 就是这份源码的产物） |
| 7.4 静态打开的能力边界 | 读 README §1 | 已写明“本地功能全可用、模型请求必失败”，并给出 `scripts/static-proxy.mjs` 这条**能真聊**的兜底路径 |
| 7.5 文档与实现一致 | 抽查 README §2.3 / §2.5 / §8 与 `docs/notes-plan-conflicts.md` §7 | 描述的就是当前实现（本轮已把旧口径全部改写） |

## 8. 还需要补的截图（拍完把这里的 `TODO` 改成 ✅ 并写上文件名）

| 建议文件名 | 要拍到什么 | 为什么需要 |
|---|---|---|
| `13-node-version.png` | `node -v` 输出 | 证明 Vite 7 的环境要求满足 |
| `14-npm-ci.png` | `npm ci` 完成 | 证明冷启动可复现 |
| `15-typecheck.png` | `npx tsc --noEmit` 无输出 | 类型检查 |
| `16-tests.png` | `npm test` 的 `# pass 83` | 自动化证据 |
| `17-llm-defaults.png` | `/llm/defaults` 的返回体 | 证明不泄露 key |
| `18-static-proxy.png` | 兜底服务启动日志 + 页面 | 无网交付路径 |
| **`19-live-sse-network.png`** | **Network 面板：`/llm/chat/completions` 的 EventStream 里多条 `data:` 逐个出现** | **“真的在流”的硬证据（最重要的一张）** |
| `20-live-sse-curl.png` | §2.4 命令的输出 | 脚本化复现同一条结论 |
| `21-error-banner.png` | 错误横幅（`role="alert"`） | 失败不白屏 |
| `22-retry.png` | 重试前后的 user 消息条数 | L1 硬要求 ① |
| `23-interrupted.png` | 中断消息 + 预览里的未发送原因 | L1 硬要求 ② / ④ |
| `24-switch-during-stream.png` | 生成中切到别会话再回来 | L1 硬要求 ③ |
| `25-three-way.png` | 同一条消息的 已隐藏 / 未发送给 AI / 已删除 | 题面“三种操作必须区分” |
| `26-batch.png` | 按角色筛选 + 批量不进上下文 | 等级 2 批量 |
| `27-scan-depth.png` | “超出世界书扫描深度”出现在未发送原因里 | 世界书规则 1 |
| `28-usage-warn.png` | 警示用量条 + 「选中较早的消息」 | 上下文过长提醒 + 可处理入口 |
| `29-preset-error.png` | 预设版本不支持的报错 | L3 错误处理 |
| `30-card-v1-rejected.png` | `spec_version=1.0` 被拒 | L3 兼容范围声明 |
| `31-panel-error.png` | 坏 JSON 标签保留原文 | L3 panel 兜底 |
| `32-export.png` | 导出文件名与 JSON 结构 | 交付物 |
| `33-import-clean.png` | 无冲突导入 + 世界书立即生效 | 本轮修的 ③ |
| `34-import-conflict.png` | 五类同 ID 冲突明细 + 三选一 | 本轮修的 ④ |
| `35-import-copy.png` | 副本标题 + 重映射后的引用 | 副本语义 |
| `36-import-overwrite.png` | 覆盖后消息数回到包内条数 | 本轮修的 ② |

## 9. 交付前必须能脱口而出（对应模块）

| 会问 | 答在哪儿 |
|---|---|
| 世界书扫描深度 N 是几条？为什么不是 N−1？ | `01-worldbook-engine.md` §2.3 + `02-assembly.md` §2.3 |
| 世界书预算是谁要求的？ | 主动交代：我自己加的，调 100 即关闭（README §2.4） |
| 你和真实 SillyTavern 哪三处不一样？ | 单条消息内匹配 / 不递归 / 同优先级按 ASCII 升序（README §2.1） |
| 生成期间改设置、改消息会怎样？ | `02-assembly.md` §2.3 + `11-tokens-usage.md` §2.3（提醒条按实时值，本次请求不变） |
| 刷新后会不会停在“生成中”？ | `09-state-streaming.md` + `12-l1-message-rules.md` |
| token 为什么不用真 tokenizer？ | `11-tokens-usage.md` Q1 |
| 覆盖导入时本地多出来的消息去哪了？ | `08-storage-idb.md`（覆盖 = 整体替换，弹窗已写明） |
| `/llm` 为什么必须存在？ | `10-llm-proxy-cors.md`（浏览器直连会被 CORS 拦） |
