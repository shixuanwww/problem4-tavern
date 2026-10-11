# 题 4《做一个自己的 SillyTavern》· 实施计划书

> 面向执行者（DSH）的自包含规格。你看不到规格作者与用户的对话，所有需要的上下文都在本文件里。
> 版本：v1 · 2026-10-11
>
> 📄 **题面原文已落盘：`docs/problem-statement.md`**（来源 PDF 第 1 页 + 第 20–27 页，逐字摘录，未改一字）。**凡本计划书与原文冲突，一律以原文为准**；演示、交付与评分相关的原话都在那份文件里，动手前先读它。

---

## 0. 执行约定（先读）

1. **语义以题面原文为准；本文件已把题面要点逐条内联**（§1 摘录、其余各节的硬点）。**不要凭对 SillyTavern 的印象自由发挥** —— 题面给的规则与真实的 SillyTavern 有 3 处**刻意简化**（见 §4.4 末表），必须按题面实现。
2. **有疑问按 §11 默认值走**，并把该决定写进 README 的"设计决策"一节。不要停下来问。
3. 🔴 **净室口径（法律 + 答辩双重约束）**：仓库同级目录 `_ref/` 下的 `SillyTavern/` 与 `dsh-tavern/` 是 **AGPL-3.0 源码，仅供阅读**。禁止复制任何代码片段、函数名、注释、变量名，禁止逐行翻译。**允许**：理解行为语义、借鉴数据结构设计、参考 V2 字段映射表（Character Card V2 是公开规范，不属于某家版权）。详见 §6.3。
4. **交付形态**：可运行源码 + 启动说明。**必须本地能跑**，不要求部署到公网。
5. **每个等级完成后单独 git commit**（题面用 commit 观察过程，这是评分依据之一）。
6. 本文件用 `TS` 伪代码描述逻辑；实现时按 §2.2 的选型落地。

---

## 1. 题目原文要点（逐条摘录，不可漏）

> 📄 原文见 **`docs/problem-statement.md`**；本节是便于定位的**导航转述**，冲突时以原文为准。

### 1.1 场景（题面 Intro）

> 人们在使⽤ ai 进⾏⽣产活动之余，也会⽤ ai 来找点乐⼦，⽐如和 ai 聊天，进⾏ RP（⻆⾊扮演），本题⽬就是希望你能做⼀个⾃⼰的 RP ⼯具。

### 1.2 核心概念（题面定义，全部要落地）

> 世界书决定本次请求补充哪些背景信息。**它不保证模型⼀定记住，也不保证模型⼀定遵守。**
>
> **从界⾯折叠，不进⼊上下⽂，删除消息，是三种操作。请在数据和交互中区分它们。**

👉 这两句是全题最重要的两句话。第一句界定了世界书的**语义边界**（它是"补充材料"，不是"强约束"）；第二句界定了**三个必须分开的操作**。

### 1.3 范围与技术要求（原文）

- 可以使⽤ **React、Vue，或原⽣ HTML/CSS/JavaScript**，允许使⽤ **TypeScript、UI 组件库和状态管理库**。
- **会话与资源必须保存在浏览器本地，刷新后能够恢复。** 采⽤ **IndexedDB** 或其他⽅案均可。
- 可以接⼊⾃⼰选择的模型 API，能够配置**服务地址、模型名称、API Key** 等必要参数，并**实际完成聊天**。
- 也可使用学长提供的公益站：`baseurl: https://gcli.ggchan.dev/`，`model: gemini-3.8-flash`，**key 见本地 `.env.local`**（`docs/problem-statement.md` §2.3 那一行的 key 已掩码为 `gg-gcli--****`）。🔴 **仓库内任何文件都不得写真实 key；真实 key 仅存在于 `.env.local`（已 gitignore）**；`docs/problem-statement.md` 里的 key 已掩码，该文件**仍按 handoff 保留在交付中**（它是题面依据）。⚠️ `vite.config.ts`（Node 侧）用 Vite 的 `loadEnv(mode, root, 'LLM_')` 读 `.env` / `.env.local` 里的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 作为**默认值**（**`loadEnv` 会依次加载 `.env` / `.env.local` / `.env.[mode]` / `.env.[mode].local`，本仓库真实 key 放 `.env.local`，两种文件名都生效**），并在代理侧注入 `Authorization`（见 §2.1）；题面要求的**服务地址 / 模型名称 / API Key 三项都在 UI「模型设置」面板里可配**，用户填的值存 `settings` store（IndexedDB），随请求头交给 `/llm` 代理动态路由（见 §2.1、§4.8）；🔴 **`.env` 变量刻意不加 `VITE_` 前缀**（`VITE_*` 会被 Vite 在编译期内联进客户端 bundle，key 会随前端产物泄露），**浏览器侧代码不得直接读环境变量**；仓库提供 `.env.example`（占位值）。
- 推荐完成三个主等级；时间较短时可以先完成等级 1、2。

### 1.4 四个等级的要求（摘要 + 原文硬点）

#### 等级 1：开门营业

- 桌面尺寸下，聊天、切换会话与发送消息均应可用。**主要操作能用键盘完成，焦点可见，输入框有可识别的标签。**（手机适配可选，做了加分）
- 聊天功能至少包括：
  - 新建、重命名、切换和删除**会话**。
  - 展示**角色开场白**，发送用户消息，**逐步展示** ai 的回复（即流式）。
  - 刷新后恢复已保存的会话、消息和状态。
  - 导出、导入**单个会话**，**明确区分覆盖与创建副本**。
- **需要正确处理以下情况（这是等级 1 真正考的东西）：**
  - **重试不重复插入同一条用户消息。**
  - **未完成的助手回复默认不进入后续上下文。**
  - **生成中切换会话，后续结果仍属于发起请求的会话。**
  - **刷新打断的生成应标为中断，不能永远停在"生成中"。**

#### 等级 2：调配记忆 —— **本题核心**

**（A）消息控制**

> 聊天记录里既有用户发的消息，也有 AI 回复的消息。**两种消息都要能编辑**，并分别控制以下两件事：
>
> - **界面隐藏**：不想看这条消息时，可以把它折叠或从聊天列表中隐藏。提供"**显示已隐藏消息**"或类似入口。**隐藏显示不改变发给 AI 的内容。**
> - **不进入上下文**：不想让 AI 再读这条消息时，可以把它排除出后续请求。**正文仍然保存，随时可以重新加入上下文。**
>
> 支持单条操作，也支持**批量处理**。例如，选中一段旧消息后一起排除，或按"**用户消息 / AI 消息**"筛选，再批量隐藏或恢复。**让用户能看出哪些消息只是没显示，哪些消息没有发给 AI。**
>
> **删除是另一个操作，不要用删除代替隐藏或排除。**
>
> **修改历史消息会影响后续请求，但不能改写已经发出的请求快照。生成期间修改设置，也只能影响下一次请求。**

**（B）世界书**

- 实现一个**世界书编辑器**，支持创建、编辑、删除、启停条目。每条至少包括：**稳定 ID、名称、关键词数组、正文、启用状态、常驻状态和优先级。**
- **本题采用以下规则（共 5 条，逐条实现）：**
  1. 可以做到**扫描最近 N 条消息，包含本次待发送的用户消息**中的与收录进来的世界书匹配的关键词。
  2. **在单条消息正文内进行关键词包含匹配**；任意关键词命中即可成为候选，**不跨消息拼接匹配**。
  3. **已启用的常驻条目直接成为候选；禁用条目始终排除。**
  4. **核心版本不递归扫描世界书正文，也不扫描角色设定和提示词模块。**
  5. 候选**按优先级从高到低处理**。优先级相同时，**按 ASCII ID 升序**处理；**同一条目最多插入一次。**
- 题面举例：**扫描深度是 3，就检查最近 3 条符合条件的消息**；关键词如果只在更早的消息里出现时，不触发该条目。
- 提供**发送前预览**，并保存**发送后的请求快照**。检查视图至少能回答：
  - 实际发送了哪些内容，**顺序是什么**？
  - 每部分**来自哪条消息、哪个模块或哪个世界书条目**？
  - **哪个关键词、哪条消息**触发了世界书？
  - 某条内容**为什么没有发送**：禁用、未命中、未完成、关闭上下文，还是什么别的原因？

**（C）上下文过长提醒**

> 对话越来越长时，给用户一个清楚的提醒。例如：**待发送内容达到设置的 80% 时**，提示"上下文快满了，可以排除较早的消息"。
> 提醒至少显示**当前用量、上限和可处理的消息入口**。

#### 等级 3：接待新客

**（A）导入预设和角色卡**

- 实现**可导入的提示词预设**。预设至少包括：**格式标识、格式版本、稳定 ID、名称、提示词模块列表与上下文配置**。导入后可**编辑、启停和调整排序**，并立即参与请求编排。
- **新预设符合已有格式时，不修改业务代码即可使用。**（⇒ 预设必须是**数据驱动**的，不能把模块写死在代码里）
- 支持 **Character Card V2 JSON 的明确子集**：**名称、描述、开场白和内嵌世界书**。其他字段可以自行定义映射，但**须说明支持范围**。
- **暂时不支持的字段及未知 extensions，在导出时应保留。**
- 世界书转换到本题规则时，应**展示字段映射和被忽略的运行规则**。仅实现子集时，应**如实说明兼容范围**。
- 导入导出还须处理：
  - **JSON 语法错误、字段类型错误、重复 ID 和不支持的格式版本。**
  - 与已有资源**同 ID** 时的**覆盖、创建副本或取消**。
- 角色卡数据也可以存放在 **PNG 图片**中并导入 —— **可作为扩展功能**（非必须）。

**（B）把消息里的简单标签显示成小界面**

示例格式（题面原文）：

```
saber 正在破坏圣杯

<tavern-panel type="status">
{"hp":10," 令咒 ":3,"location":" 柳洞寺 "}
</tavern-panel>

<tavern-panel type="choices">
{"options":[{"label":" 发动令咒 ","text":"saber ⾃裁吧 "}]}
</tavern-panel>
```

> 这段消息应该显示为：一段普通正文、一张显示生命值、令咒数量和地点的状态栏，以及一个"发动令咒"按钮。**点击按钮后，输入框中填入"saber自裁吧"，由用户决定是否发送。**

需要做到：

- 状态栏能读取**你自己约定的数据字段**，并清楚地展示对应信息。**字段名称和内容可以自行设计**。**显示结果应与消息中的数据一致。**
- 点击选项时，把该选项对应的文字**填入这条消息所属会话的输入框**，由用户决定是否发送。
- **回复结束后，按照你约定的格式检查内容。如果 JSON 不合法、标签没有闭合，或使用了应用不支持的类型，应保留原文，并提示具体问题，不能直接丢掉这段内容。**

#### 等级 4：扩建（任选）

- **变量与动态模板**：例如 `你是 {{char}}，当前地点是 {{location}}，生命值是 {{hp}}。` **发送前，程序把它替换成实际文字，再计算预算。保留原始模板，并让用户能看到展开结果。**
- 可加入简单条件，例如"生命值低于 20 时，追加一段受伤说明"。**请说明支持哪些语法、变量缺失时怎么办。无需完整实现 EJS。**
- 跨标签页通信与协调可参考 BroadcastChannel 和 Web Locks；组件布局与切换可参考 CSS 容器查询和 View Transition。**选用技术时须说明它解决的实际问题。**

### 1.5 交付与评分（原文）

> 请交付：
> 1. **可运行源码与启动说明**
> 2. 若选择插件扩展，附插件开发说明和示例插件；若选择总结扩展，演示摘要的生成、使用和撤销。
> 3. 可以交付任何你认为可以方便他人使用你作品的说明，观看效果的演示。

题面通用要求（另见第 1 页）：可用 AI 辅助但**会被深挖细节**；建议留 session；最好写 README；**推荐 git 分阶段 commit**。

---

## 2. 已定设计决策（执行者直接采用，不要重新选型）

### 2.1 🔴 运行环境硬约束（写错就"跑不起来"）

| 项 | 要求 |
|---|---|
| Node | **≥ 20.19 或 ≥ 22.12**（Vite 7 的硬性要求）。README 必须写明，并给一条 `node -v` 自检 |
| 包管理 | `npm`（评审机自带概率最高） |
| 启动 | **两条命令**：`npm ci`（已提交 `package-lock.json`；无锁文件时才退回 `npm install`）→ `npm run dev`，浏览器打开 `http://localhost:5173` |
| 离线可跑 | `npm run dev` 之外**不依赖任何远端服务**；模型 API 不可用时，聊天界面必须给出**明确错误**而不是白屏。🔴 **安装期也要有兜底**：提交 `package-lock.json`、README 用 `npm ci`，并保留一份 `dist/` 构建产物（见 §10 / §5 L1）。⚠️ **`dist/` 的能力边界必须说清**：静态打开 `dist/` 时**本地功能全部可用（会话/消息/世界书/预览/快照/导入导出），但模型请求必然失败** —— `dist/` 里的前端只打 `/llm`，而"任意静态服务器"既不提供 `/llm` 代理、也不提供 `/llm/defaults`，且本项目**没有直连模式**。⇒ 🔴 **推荐做法**：L1 一并产出 **`scripts/static-proxy.mjs`**（零依赖、~40 行：`node:http` + `node:fs` 静态服务 `dist/`，并复用本节同一套 `router(req)` / `proxyReq` 逻辑转发 `/llm` 与 `/llm/defaults`），README 给一条 `node scripts/static-proxy.mjs` 即可打开 `dist/` 并**实际完成聊天**；**若不做该脚本，README 必须显式写明"`dist/` 兜底只能展示界面、无法完成聊天"**，不得让读者以为它能替代 `npm run dev` |
| 🔴 CORS | 浏览器直连第三方 LLM API 大概率被 CORS 拦。**必须在 `vite.config.ts` 配 `server.proxy` 转发模型请求**：前端**一律**把模型请求打到 `/llm`（**不直连**）。🔴 **代理 target 是动态的**：`loadEnv(mode, root, 'LLM_')` 读到的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 只是**默认值**；前端把用户在设置面板里填的 `baseUrl` / `apiKey` 放进请求头 `x-llm-base-url` / `x-llm-api-key`，`vite.config.ts` 用 http-proxy 的 **`router(req)`** 选 target（请求头里有合法 `http(s)://` 的 `x-llm-base-url` → 用它；否则回落到 `.env` 的 `LLM_BASE_URL`），并**用 `configure(proxy)` 在 `proxyReq` 上把 `Authorization: Bearer <x-llm-api-key>` 注入到出站请求**。🔴 **`.env` 变量名是 `LLM_*` 而非 `VITE_*`**：`VITE_*` 会被 Vite **编译期内联进客户端 bundle**，只要有人写一句 `import.meta.env.VITE_*` 形式的读取，key 就进了前端产物；`LLM_*` 只在 Node 侧的 `vite.config.ts` 里以 `loadEnv(mode, root, 'LLM_')` 读取。**用户什么都不填 → 用 `.env` 默认值，此时浏览器不持有 key；用户填了 → key 由用户提供、存在 IndexedDB（符合题面"配置 API Key"），README 必须写明"key 会落在浏览器本地"这一事实与风险。** 🔴 **改 `.env` 里的默认 target 必须重启 dev server**（`loadEnv(mode, root, 'LLM_')` 启动时读取、静态固定）；面板里改 `baseUrl` **不需要**重启（走请求头逐请求动态路由）。🔴 **不再需要"直连模式"**：面板配置经 `/llm` 代理动态路由即可，既满足题面"能够配置服务地址、模型名称、API Key"又避开 CORS。**`server.proxy` 不覆盖 `vite preview`**：若用 `npm run preview` 演示，**必须同时配 `preview.proxy`**（复用同一套 `router(req)` + `proxyReq` 配置）。README 要解释这一点。🔴 **默认值通路用 `GET /llm/defaults`，不靠代理改写请求体**：在 `vite.config.ts` 的 `configureServer` 里挂一个极小中间件 `GET /llm/defaults`，返回 `{ baseUrl, model }`（取自 `.env` 的 `LLM_BASE_URL` / `LLM_MODEL`），**绝不返回 key**；前端**启动时取回并预填设置面板**（面板三项仍可被用户改），**`model` 由前端始终显式发送** ⇒ 代理只需做两件事：`router(req)` 按请求头 `x-llm-base-url` 动态选 target（否则回落 `LLM_BASE_URL`），以及 `configure(proxy)` 的 `proxyReq` 注入 `Authorization: Bearer <x-llm-api-key>`。**代理不改写请求体**（`router` / `proxyReq` 只能改路由与请求头；要改 body 必须缓冲整个请求体、改 JSON 再修正 `Content-Length` 转发，容易出现上游收到被截断的 body 或流式请求被卡住，属于另一套机制，本项目不采用） |

> 🔴 **2026-10-11 实现修订（重要）**：本节表格里"用 `server.proxy` 的 **`router(req)`** 动态选 target"这一条
> **技术上做不到** —— Vite 7 不再依赖 http-proxy（自带代理实现），`ProxyOptions` **没有** `router` 选项，
> `target` 也**不接受函数**（`tsc` 会直接报 `'router' does not exist in type 'ProxyOptions'`）。
> 实际实现改为在 `vite.config.ts` 里写一个**语义等价**的 `/llm` 转发中间件：按 `x-llm-base-url` 动态选 target、
> 在 Node 侧注入 `Authorization`、**不改写请求体**、**逐块透传**（SSE）。详见 `docs/notes-plan-conflicts.md` §4。
> **其余设计全部不变**：`.env` 用 `LLM_` 前缀、`GET /llm/defaults`、前端只打 `/llm`、面板三项可配、
> `scripts/static-proxy.mjs` 用同一套逻辑。

### 2.2 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 框架 | **React 18 + TypeScript + Vite** | 题面明确允许；UI 复杂度高（多面板 / 批量操作 / 编辑器 / 快照视图），组件化收益最大 |
| 依赖 | **只用 `react` + `react-dom`**；devDeps 只用 `vite` + `@vitejs/plugin-react` + `typescript` + `@types/*`（**不含 `vitest`**，与 handoff §2.3 一致；§8 用 Node 内置 test runner） | 依赖越少，演示越不容易崩 |
| UI 组件库 | **不用** | 题面允许但非必需；自己写 CSS 可控，也少一个答辩要解释的东西 |
| 状态管理 | **React 内置**（`useReducer` + `Context`） | 同上；状态树不复杂到需要引入库 |
| 持久化 | **IndexedDB（原生 API）+ 自写约 80 行薄封装** | 题面要求"必须保存在浏览器本地"；自写封装便于答辩讲清楚 |
| 样式 | 纯 CSS（一个 `styles.css` + CSS 变量） | 无构建链 |
| 路由 | **不用 router**，用一个 `activeSessionId` + 视图枚举 | 页面少，省依赖 |
| 测试 | **纯内核单测用 `node --experimental-strip-types --test tests/*.test.ts`**（`src/core/` 无 DOM 依赖，跑得起来）；若要引入 `vitest` 做组件测试，**必须先改 handoff §2.3** | 见 §8 |

**不要引入**：Tailwind（需构建配置）、Antd/MUI（体积大）、Redux/Zustand、axios（用原生 `fetch`）、dayjs（用 `Date`）、uuid（用 `crypto.randomUUID()`）。

### 2.3 架构原则（三条，贯穿实现）

1. **纯函数内核，UI 只是壳。** 世界书激活、上下文装配、面板解析、V2 转换 —— 这四个是**纯函数**，放 `src/core/`，不依赖 DOM 和 React。UI 只负责调用 + 渲染。这条直接决定"能不能被答辩追问"。
2. **存储与状态分离。** 所有写操作走一个 `repo` 层（`src/storage/`），React 只读内存镜像。
3. **一切"发送了什么"必须可回放。** 每次发送落一条 `RequestSnapshot`，含每部分的来源与激活证据。

---

## 3. 数据模型（完整 TypeScript 定义，直接落地）

```ts
// src/core/types.ts

export type Role = 'system' | 'user' | 'assistant';

/** 消息发送/生成状态。interrupted = 被刷新打断，不能停在 streaming */
export type MessageStatus = 'complete' | 'streaming' | 'interrupted';

export interface Message {
  id: string;              // crypto.randomUUID()
  sessionId: string;
  role: Role;
  content: string;         // 原始正文，含 <tavern-panel> 标签，不做任何清理
  createdAt: number;
  status: MessageStatus;

  // 🔴 两个独立开关（对应题面的"界面隐藏"与"不进入上下文"）
  uiHidden: boolean;       // 只影响渲染；发给 AI 的内容完全不变
  excluded: boolean;       // 只影响装配；正文仍在，可随时加回

  // 会话内单调递增序号：用于"重试不重复插入同一条用户消息"与稳定排序
  seq: number;

  /** 生成该条回复所用的请求快照 id（assistant 消息才有） */
  requestId?: string;
}
// 注意：删除 = 从 store 里真删，不是第三个标志位。

export interface CharacterCardLite {
  id: string;
  name: string;            // ← V2 data.name
  description: string;     // ← V2 data.description
  firstMes: string;        // ← V2 data.first_mes（开场白）
  avatarDataUrl?: string;  // PNG 导入时的原图（可选）
  /** 🔴 原始 JSON 全量保留：未支持字段 / 未知 extensions 导出时原样写回 */
  raw: unknown;
  specVersion?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  characterCardId?: string;
  worldBookIds: string[];      // 本会话启用的世界书
  presetId?: string;
  settings: SessionSettings;
}

export interface SessionSettings {
  scanDepth: number;           // 世界书扫描深度 N（默认 4，见 §11）
  contextLimit: number;        // 上下文上限（默认 32768，见 §11）
  worldBookBudgetPct: number;  // 世界书占上下文的比例上限（默认 25，见 §11）
  contextWarnPct: number;      // 提醒阈值（默认 80，见 §11；题面示例亦为 80）
  stream: boolean;
}

export interface WorldBookEntry {
  id: string;         // 🔴 稳定 ID：创建即分配，编辑内容不变更
  name: string;
  keys: string[];     // 关键词数组
  content: string;    // 正文
  enabled: boolean;   // 启用状态
  constant: boolean;  // 常驻状态
  priority: number;   // 优先级（越大越优先）
}

export interface WorldBook {
  id: string;
  name: string;
  entries: WorldBookEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetModule {
  id: string;          // 稳定 ID
  name: string;
  role: Role;
  content: string;     // 可含 {{变量}}
  enabled: boolean;
  order: number;       // 排序
  /** 模块插入位置：系统提示区 / 历史之后（post-history） */
  position: 'system' | 'postHistory';
  /** 是否参与变量替换 */
  template?: boolean;
}

export interface Preset {
  id: string;
  format: string;        // 格式标识，如 "st-lite"
  formatVersion: string; // 格式版本，如 "1.0"
  name: string;
  modules: PresetModule[];
  contextConfig: {
    contextLimit: number;
    scanDepth: number;
    worldBookBudgetPct: number;
    contextWarnPct: number;
  };
  raw?: unknown;
}

/** 世界书激活证据（题面要求检查视图能回答"哪个关键词、哪条消息"） */
export interface Activation {
  entryId: string;
  entryName: string;
  reason: 'constant' | 'keyword';
  matchedKey?: string;
  matchedMessageId?: string;   // 命中的那条消息（constant 时为空）
}

/** 未发送原因（题面要求检查视图能回答"为什么没发送"） */
export type SkipReason =
  | 'disabled'          // 条目被禁用
  | 'no_keyword_match'  // 关键词未命中
  | 'empty_content'     // 正文为空
  | 'budget_exceeded'   // 超出世界书预算
  | 'out_of_scan_depth' // 该消息因超出世界书扫描深度而未参与关键词匹配
  | 'message_excluded'  // 消息被排除出上下文（excluded === true；对应消息级原因）
  | 'message_incomplete';// 消息未完成（streaming/interrupted）

export interface SkippedEntry {
  entryId: string;
  entryName: string;
  reason: SkipReason;
  /** 🔴 判别字段：本行来自世界书条目，还是来自某条被排除在外的消息。
   *  对应关系（判据只看 reason，不再靠"entryId 是不是某个消息 id"隐式区分）：
   *  out_of_scan_depth / message_excluded / message_incomplete ⇒ source: 'message'，
   *  其余（disabled / no_keyword_match / empty_content / budget_exceeded）⇒ source: 'entry' */
  source: 'entry' | 'message';
}

/** 请求快照：发送后即冻结，后续编辑不得改写 */
export interface RequestSnapshot {
  id: string;
  sessionId: string;
  createdAt: number;
  model: string;
  parts: SnapshotPart[];
  totalTokens: number;       // 估算
  contextLimit: number;
  activations: Activation[];
  skipped: SkippedEntry[];
  scanDepth: number;
}

export interface SnapshotPart {
  index: number;
  kind: 'persona' | 'character' | 'preset-system' | 'worldbook'
      | 'history' | 'pending' | 'post-history';
  /** 来源：消息 id / 世界书条目 id / 预设模块 id */
  sourceId?: string;
  /** 人类可读来源标签，如 "世界书「Fate」/ 条目「圣杯」" */
  label: string;
  content: string;
  tokens: number;
}

/** tavern-panel 解析结果 */
export type PanelBlock =
  | { kind: 'status'; raw: string; data: Record<string, unknown> }
  | { kind: 'choices'; raw: string; options: { label: string; text: string }[] }
  | { kind: 'error'; raw: string; problem: string; panelType?: string };

export interface ParsedMessage {
  /** 正文被标签切分后的片段：文本 + 面板交替 */
  segments: ({ kind: 'text'; text: string } | PanelBlock)[];
}
```

---

## 4. 模块与接口规格（**语义 + 边界，不可改**）

### 4.1 存储层 `src/storage/`

- 自写 IndexedDB 薄封装，暴露：`openDb()`、`get(store, key)`、`getAll(store)`、`put(store, value)`、`del(store, key)`、`bulkPut(store, values)`。
- Object stores：`sessions`、`messages`（索引：`bySession`）、`worldbooks`、`presets`、`characters`、`snapshots`（索引：`bySession`）、`settings`。
- **所有写入必须 `await` 事务完成后再更新内存状态**（避免"刷新后数据丢了"）。
- 每次写操作后更新 session 的 `updatedAt`。
- 🔴 **删除的级联规则**（题面只要求 CRUD，这里补齐，不留悬空引用）：删除世界书条目 / 整本世界书 → 从所有 `session.worldBookIds`（及条目引用）中移除；删除会话 → **级联删除其 `messages` 与 `snapshots`**；删除预设 → **已导入的会话保留其快照出的模块副本**（不回溯失效）。

### 4.2 消息三分离（题面核心）

| 操作 | 数据改动 | 影响渲染 | 影响发给 AI | UI 表现 |
|---|---|---|---|---|
| **界面隐藏** | `uiHidden = true` | ✅ 折叠/隐藏 | ❌ **完全不影响** | 消息变半透明/折叠；顶部有"显示已隐藏消息"开关 |
| **不进入上下文** | `excluded = true` | ❌ 仍正常显示 | ✅ 不参与装配 | 消息**保留在列表中**，加一个明显标记（如左侧色条 + 标签"未发送给 AI"） |
| **删除** | 从 store 真删 | ✅ 消失 | ✅ 不再存在 | 二次确认；**绝不**用 `uiHidden` 或 `excluded` 模拟 |

**硬要求：**

- 列表里**同时**能看到"隐藏"与"排除"两种状态，且**两种标记视觉上不一样**（题面原话"让用户能看出哪些消息只是没显示，哪些消息没有发给 AI"）。
- 支持**批量**：多选 → 批量隐藏/恢复、批量排除/恢复；另有按 `role` 一键筛选（"全部用户消息"/"全部 AI 消息"）后批量操作。
- **编辑**：user 与 assistant 消息都可编辑（点击进入编辑态）。编辑只改 `content`，不改 `id`、`seq`。
- **快照不可改写**：编辑历史消息 / 切换 `excluded` / 改设置 → 只影响**下一次**装配。已存在的 `RequestSnapshot` 一律只读。
- **生成期间改设置**同样只影响下一次。
- 🔴 **待发送用户消息只装配一次**：**用户消息入库即 `status='complete'`，并在入库时分配 `seq`**；装配时按 `seq` **排除**与 `pendingUserText` 同 `seq` 的那一条。**默认采用"入库即 complete + 按 `pendingSeq` 排除"**（§4.3 签名已含 `pendingSeq`）；若要改成"发送前不落库"，必须同步修改 §4.3 签名与 §8 用例 16，**不得两套并存**。

### 4.3 上下文装配 `buildRequest()`（纯函数）

签名：

```ts
buildRequest(input: {
  session: Session;
  messages: Message[];          // 该会话全部消息（含隐藏/排除）
  worldBooks: WorldBook[];
  preset?: Preset;
  character?: CharacterCardLite;
  pendingUserText: string;      // 本次待发送的用户输入
  pendingSeq: number;           // 本次待发送用户消息在 messages 里的 seq；装配时按它排除同一条，避免重复装配
}): {
  parts: SnapshotPart[];
  activations: Activation[];
  skipped: SkippedEntry[];
  totalTokens: number;
}
```

**装配顺序（我方定义；题面未规定，需在 README 声明）：**

```
1. character     —— 角色卡：名称 + 描述（若绑定了角色卡）
2. preset-system —— 预设中 position='system' 且 enabled 的模块，按 order 升序拼接
3. worldbook     —— 世界书激活内容（见 §4.4），按"处理顺序"拼接为一个部分（每条一行）
4. history       —— 历史消息：status === 'complete' 且 excluded === false，按 seq 升序；🔴 **再排除 `seq === pendingSeq` 的那一条**（即本次待发送的那条 user 消息），避免同一条 user 消息出现两次
5. pending       —— 本次待发送的用户输入（单独成一条 user 消息，**全文只在此处出现一次**）
6. post-history  —— 预设中 position='postHistory' 且 enabled 的模块
```

**参与装配的消息必须同时满足**：`excluded === false` **且** `status === 'complete'`。
👉 这直接实现题面「**未完成的助手回复默认不进入后续上下文**」和「**不进⼊上下文**」两条。

⚠️ `uiHidden` **不参与**任何过滤 —— 这是题面明确要求（"隐藏显示不改变发给 AI 的内容"）。

### 4.4 🔴 世界书引擎 `activateWorldBook()`（**本题最关键**，纯函数）

签名：

```ts
activateWorldBook(input: {
  entries: WorldBookEntry[];      // 汇总本会话启用的所有世界书条目
  messages: Message[];            // 该会话全部消息（升序）
  pendingUserText: string;        // 本次待发送
  scanDepth: number;              // N
  budgetTokens: number;           // 世界书预算（见 §4.5）
  estimate: (text: string) => number;
}): {
  activated: { entry: WorldBookEntry; activation: Activation }[];
  skipped: SkippedEntry[];
  usedTokens: number;
};
```

**算法（严格按题面 5 条规则）：**

```
步骤 1 —— 构造扫描集
  eligible = messages.filter(m => m.excluded === false && m.status === 'complete')
  recent   = eligible 的最后 scanDepth 条（按 seq 升序取尾部）
  scanSet  = [...recent, { id: '__pending__', content: pendingUserText }]
  // 规则 1：包含本次待发送的用户消息
  // 🔴 scanDepth **范围 1–100（超出视为非法）**，取值见 §11（默认 4）；
  //    非法值（0 / 负数 / >100）→ 拒绝或钳制到边界值，绝不静默按 0 条扫描
  // 🔴 读法（已写进 README）：`scanDepth = N` 指最近 N 条合格历史，**另加**本次待发送消息
  //    ⇒ 共 N+1 条参与关键词匹配。不采用"pending 计入 N 之内"的读法：那会让"最近 N 条"
  //    实际只扫 N-1 条历史，与题面"扫描最近 N 条消息"的例子不符。
  // 规则 4：不扫描世界书正文、不扫描角色设定/提示词模块 ⇒ scanSet 里不放这些
  // 🔴 scanDepth 把更早的合格历史截断在外时，为这些消息各产出一条
  //    skipped{ entryId: <该消息 id>, entryName: "消息 <seq>", reason: 'out_of_scan_depth', source: 'message' }，
  //    作为"消息级未发送原因"的产出通路（检查视图据此回答"为什么这条没发送"）。
  //    消息级与条目级共用同一张表，靠判别字段 `source`（'message' / 'entry'）区分两类来源
  //    —— 判据是 reason 与 source 的固定对应关系（见 §3 SkippedEntry），
  //    不再靠"entryId 是否等于某条消息 id"隐式区分。

步骤 2 —— 逐条判定候选
  for entry of entries:
    if (!entry.enabled)                     -> skip('disabled')          // 规则 3
    if (entry.constant)                     -> 候选, reason='constant'    // 规则 3
    if (entry.keys.length === 0)            -> skip('no_keyword_match')   // 无关键词的非常驻条目不参与
    hit = null
    for msg of scanSet:                                                   // 规则 2
      for key of entry.keys:
        k = key.trim()
        if (k === '') continue
        if (msg.content.toLowerCase().includes(k.toLowerCase())):          // 单条消息内包含匹配
          hit = { msgId: msg.id, key: k }; break
      if (hit) break
    if (hit) -> 候选, reason='keyword', matchedKey/matchedMessageId=hit
    else     -> skip('no_keyword_match')

步骤 3 —— 去重
  同一条目最多一次（按 entry.id 去重）                                  // 规则 5

步骤 4 —— 排序（"处理顺序"）
  候选按 priority 降序；priority 相同时按 id 的 ASCII 升序               // 规则 5

步骤 5 —— 按优先级降序逐个尝试 + 预算
  used = 0
  for cand of sortedCandidates:
    t = estimate(cand.entry.content)
    if (used + t > budgetTokens) { skip('budget_exceeded'); budgetSkipped++; continue; }  // 见下方说明
    used += t; activated.push(cand)

步骤 6 —— 空正文
  entry.content.trim() === '' -> skip('empty_content')（在步骤 2 之后、步骤 5 之前的任意位置）
```

**关于步骤 5 的说明**：题面只说"按优先级从高到低**处理**"，没定义处理的结果。我方默认：**处理 = 按优先级降序逐个尝试选中并计入世界书预算；装不下的（`used + t > budgetTokens`，`budgetTokens = floor(contextLimit * worldBookBudgetPct / 100)`）跳过并 `continue`，继续尝试后面的小条目**（这正是"处理顺序"有意义的原因 —— 先处理的先占预算）。**采用 `continue` 而不是 `break`**：按优先级降序逐个尝试，装不下的跳过、继续尝试后面的小条目，因此不是"到此为止"。这个默认值必须写进 README。

🔴 **超预算不得静默截断**：若 `budgetSkipped > 0`，必须在检查视图与预览中给出**可观测标记**，例如在 `worldbook` 部分末尾追加一行"（世界书预算已满，共 N 条未插入）"，并在检查视图的"未发送原因"里逐条列出这些条目、`reason = 'budget_exceeded'`（可点击跳到该条目）。

**🔴 题面与真实 SillyTavern 的 3 处差异 —— 必须按题面，不要"参考实现"：**

| 维度 | 真实 SillyTavern | 本题面要求 |
|---|---|---|
| 匹配范围 | 把最近 N 条消息**拼成一个大字符串**再 `includes` | **单条消息内**匹配，**不跨消息拼接** |
| 扫描范围 | 会**递归**扫世界书正文，也会扫角色描述/persona/scenario 等 | **不递归**，**不扫**角色设定与提示词模块 |
| 排序 | 只按 `order` 降序 | 优先级降序 **+ 同级按 ASCII ID 升序**（题面额外加的确定性 tie-break） |

题面**也没有**要求这些 SillyTavern 机制，不要实现：二级关键词（secondary keys）及其四种逻辑、概率触发、sticky/cooldown/delay 定时效果、分组互斥（inclusion group）、正则关键词、整词匹配、向量检索。

> 关键词匹配语义：默认**大小写不敏感 + 子串包含**。空字符串 key 视为无效。不做正则、不做分词。

### 4.5 上下文用量与 80% 提醒

- **token 估算**（不引入 tokenizer 依赖）：`estimate(text) = ceil(cjkChars * 1 + otherChars / 4)`，即中日韩字符按 1 token、其他字符按 4 字符 1 token 粗估。函数集中在 `src/core/tokens.ts`，README 声明这是**估算**。
- **世界书预算** `budgetTokens = floor(contextLimit * worldBookBudgetPct / 100)`。
- **提醒**：装配后若 `totalTokens / contextLimit >= contextWarnPct/100`，在输入框上方显示提示条（`contextWarnPct` 默认值 **80**，见 §11）：
  - 🔴 **2026-10-11 审计修订**：判据改为**精确比较**（`core/tokens.ts#isOverWarnThreshold`），
    不再先用 `Math.round` —— 否则 `79.5%` 会被显示成 `80%` 而提前告警。
    显示用的整数百分比与判据是两个数（见 `docs/notes-plan-conflicts.md` §7）。
  - 文案参考："上下文快满了（已用 X / Y，Z%）"
  - **必须包含"可处理的消息入口"**：点击后**把最近 2 条之外的较早消息整批选中**（并显示隐藏消息），
    用户接着点工具栏的「批量不进上下文」即可（🔴 2026-10-11 审计修订：原写法只说"打开批量面板"，
    实现里实际只是滚到顶部，够不上"入口"）。
- 提醒条在**发送前预览**区域也出现。
- 🔴 **以哪一次计算为准**：预览时的 80% 只是**预估值**；**发送瞬间冻结的那份快照为准**（`RequestSnapshot.totalTokens`）。发送后若用量变化，提醒条按最新一次快照重算。这句话必须写进 README。

### 4.6 发送前预览 + 请求快照 + 检查视图

- **发送前预览**：输入框旁"预览"按钮 → 调 `buildRequest()` → 展示 `parts` 列表（顺序、来源标签、内容、token），并**高亮**被排除的消息与未命中的条目。
- **发送快照**：用户真正点"发送"时，**同一份** `buildRequest()` 结果会被冻结成 `RequestSnapshot` 存入 `snapshots`，并把 `id` 写到生成的 assistant 消息上（`requestId`）。
- 🔴 **快照 = 发送瞬间 `buildRequest()` 的 parts 副本**：流式生成期间**不得**用当前输入框内容重算 preview/snapshot —— 用户此时改输入框只影响**下一次**请求；输入框中已被计入本次请求的部分应**置灰/标为"已发送的原文"**（内容可改，但改了不回溯本次请求）。
- **检查视图**（对应题面四问，逐条给出口）：
  1. 实际发送了哪些内容、顺序 → `parts` 按 `index` 列表；
  2. 每部分来自哪 → `part.label`（如 `世界书「Fate」/ 条目「圣杯」`）+ `part.sourceId`；
  3. 哪个关键词、哪条消息触发 → `activations` 表（条目 / 命中关键词 / 命中消息，可点击跳到该消息）；
  4. 为什么没有发送 → `skipped` 表，按 `SkipReason` 分类展示（禁用 / 未命中 / 未完成 / 关闭上下文 / 超预算 / 空正文 / **超出扫描深度 `out_of_scan_depth`**），并**按判别字段 `source` 再分成两组**：`source === 'entry'`（世界书条目级）与 `source === 'message'`（消息级）；其中 `budget_exceeded` 与消息级原因（`out_of_scan_depth` / `message_excluded` / `message_incomplete`）都必须有产出通路，见 §4.4 步骤 1 与步骤 5 的说明）。
- **历史快照列表 + 回放**：检查视图提供按会话倒序列出的历史 `RequestSnapshot`（时间 / model / totalTokens），点任一条**只读回放**当时的 `parts` / `activations` / `skipped` —— 这是"旧快照不变"的可视化验收点（快照只写不读不算完成）。

### 4.7 会话导出 / 导入（覆盖 vs 副本）

- **导出**：单会话 → `.json` 文件，含 `{ format, formatVersion, session, messages, snapshots, characterCard?, worldBooks? }`。下载文件名带会话标题与时间。
- **导入**：读文件 → **校验**（格式标识 / 版本 / 必需字段）→ **ID 冲突检测**：
  - 冲突时**必须弹三选一**：「覆盖」/「创建副本」/「取消」—— 题面原话"明确区分覆盖与创建副本"。
  - 副本模式：新 `id`，标题加后缀（如 `（副本 2）`），消息与快照一并改 `sessionId`。
  - 🔴 **同 ID 冲突的固定处理顺序**（会话、世界书条目、角色卡一律适用）：**先创建副本资源（分配新 ID）→ 再用一张 `idMap` 一次性重写所有引用**（`session.worldBookIds` / `session.characterCardId` / 消息里的 `characterCardId`）→ **最后替换原资源**。禁止先改被引用资源再补引用，否则会留**悬空 ID**。

### 4.8 模型客户端 `src/core/llm.ts`

- 配置项（**题面要求的三项都要在 UI 可配**）：「模型设置」面板提供 **`baseUrl` / `model` / `apiKey` 三个输入框**（外加 `stream`），全部持久化到 `settings` store（IndexedDB）。🔴 **请求仍走 `/llm`，不做直连**（避免 CORS）：前端把用户填的 `baseUrl` 放进请求头 `x-llm-base-url`、`apiKey` 放进 `x-llm-api-key`，由 `vite.config.ts` 的 `router(req)` 动态选 target、`proxyReq` 在 Node 侧注入出站 `Authorization: Bearer <apiKey>`（见 §2.1）。🔴 **`model` 由前端始终显式发送**（值来自面板，启动时已由 `GET /llm/defaults` 预填，见 §2.1）—— 代理**不改写请求体**，只做两件事：`router(req)` 选 target、`proxyReq` 注入 `Authorization`。🔴 **三项留空 → 用 `.env` 的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 默认值**（此时浏览器不持有 key；`baseUrl` / `model` 已由前端在启动时从 `/llm/defaults` 取回并预填进面板，因此仍是前端显式发送）；**用户填了 → 以用户填的为准**（key 存在浏览器 IndexedDB，README 必须写明"key 会落在浏览器本地"这一事实与风险）。
- 走 `fetch` + `ReadableStream` 解析 SSE（OpenAI 兼容的 `data: {...}` 行）。
- **错误处理**：非 2xx / 网络失败 / CORS → 在聊天区显示明确错误卡片，**不得白屏**。
- 🔴 **生成中切换会话**：请求发出时**绑定 `sessionId`**（闭包内固定），流式回调只往该会话追加内容 —— 用户切走后，结果仍写入**发起它的**会话。
- 🔴 **中断标记**：应用启动时扫描 `status === 'streaming'` 的消息 → 一律改为 `interrupted`（并保留已收到的部分文本）。**不允许永远停在"生成中"。**
- 🔴 **流式写库时机（节流）**：流式期间**节流写库 —— ≥500ms 或累计 200 字符写一次** pending 内容（两个阈值见 §11，是可调参数）；刷新后据此**恢复或标记 `interrupted`**（否则启动时扫描不到未落库的部分文本）。
- 🔴 **配置快照**：发送时把本次请求实际用到的 `baseUrl` / `model` / `apiKey` 与参数**深拷贝**进本次请求闭包，流式回调**不得**读最新设置 —— 硬要求，保证"生成期间改设置只影响下一次"；⚠️ `apiKey` 只在该闭包内用于设置请求头，**不得写进 `RequestSnapshot` 落库**。
- 🔴 **重试**：只重新生成最后一条 assistant 消息 —— **不得**再次插入那条 user 消息（`seq` 与 `id` 都不变）。

### 4.9 预设导入 `src/core/preset.ts`

- 预设格式（我方定义，需在 README 给 schema）：
```json
{
  "format": "st-lite",
  "formatVersion": "1.0",
  "id": "preset-xxx",
  "name": "我的预设",
  "modules": [
    { "id": "m1", "name": "人设", "role": "system", "content": "你是 {{char}}。", "enabled": true, "order": 10, "position": "system", "template": true }
  ],
  "contextConfig": { "contextLimit": 32768, "scanDepth": 4, "worldBookBudgetPct": 25, "contextWarnPct": 80 }
}
```
- 🔴 **"新预设符合已有格式时，不修改业务代码即可使用"** ⇒ 模块必须**数据驱动**：不得在代码里硬编码任何模块名（如"人设""越狱"）。渲染、启停、排序、参与编排全部由 `modules` 数组驱动。
- 导入后：可编辑（内容/名称）、启停、**上下移动排序**（改 `order`），**立即生效于下一次装配**。
- 导出 / 导入校验：`format` 不匹配 / `formatVersion` 不支持 → 明确报错；字段类型错误 → 指出字段名与期望类型。
- 🔴 **同名配置优先级**（`contextConfig` vs `SessionSettings`）：**会话设置优先；导入预设只填初值** —— 预设的 `contextConfig` 仅在会话首次绑定该预设时写入 `SessionSettings`，之后以会话内改动为准。

### 4.10 角色卡 V2 导入 / 导出 `src/core/characterCard.ts`

**🔴 L1 内置默认角色卡（保证等级 1 就有"角色开场白"）**

题面等级 1 硬要求"展示**角色开场白**"，而角色卡的**导入**属 L3 —— 若等 L3 才有角色，L1 就达不成等级 1。因此：

- `src/core/defaultCharacter.ts` 导出**内置默认角色卡常量** `DEFAULT_CHARACTER: CharacterCardLite`（含 `name` / `description` / `firstMes`，例如一个通用助手人格）；
- **新建会话时若未指定角色卡，默认绑定 `DEFAULT_CHARACTER`**（其 `id` 一并写入 `characters` store，`Session.characterCardId` 指向它）；
- 开场白仍走**同一条机制**（§11"绑定角色卡后，会话创建时插入一条 `role='assistant'`、`status='complete'` 的消息"）：L1/L2 用内置卡，L3 导入角色卡后换成卡内 `first_mes`，**机制不变**；
- 于是 L1 的"展示角色开场白"可达成 —— 新建会话 → 立刻看到开场白（验收见 §8 端到端清单）。

**支持的子集（题面指定）**：名称、描述、开场白、内嵌世界书。

**字段映射表（必须原样实现，并在 UI 上展示这张表）：**

| Character Card V2 | 本题模型 | 备注 |
|---|---|---|
| `spec` / `spec_version` | 校验用 | 须为 `chara_card_v2` / `2.x`；否则报"不支持的格式版本" |
| `data.name` | `CharacterCardLite.name` | |
| `data.description` | `.description` | |
| `data.first_mes` | `.firstMes`（开场白） | 也接受 `data.first_message` 作为别名 |
| `data.character_book.name` | 新建/复用的 `WorldBook.name` | |
| `data.character_book.entries[].id` | `WorldBookEntry.id` | **缺失时用数组下标补齐，补齐值一律转字符串** |
| `data.character_book.entries[].keys` | `.keys` | |
| `data.character_book.entries[].content` | `.content` | |
| `data.character_book.entries[].name` 或 `.comment` | `.name` | 取 `name`，为空时退化到 `comment` |
| `data.character_book.entries[].enabled` | `.enabled` | ⚠️ **注意方向**：V2 是"启用"，本题也是"启用"，**不要取反** |
| `data.character_book.entries[].constant` | `.constant` | |
| `data.character_book.entries[].insertion_order` | `.priority` | |
| `data.character_book.entries[].extensions.*` | **忽略但保留** | 在映射说明中标为"被忽略的运行规则" |

**被忽略的运行规则（必须在导入预览里列出）**：`secondary_keys` / `selective` / `selectiveLogic` / `position`（before_char/after_char 等）/ `case_sensitive` / `match_whole_words` / `probability` / `sticky` / `cooldown` / `delay` / `group` / `group_weight` / `scan_depth` / `vectorized`。

**导出**：以导入时的 `raw` 为基底，**把已编辑的可映射字段写回**，其余字段与未知 `extensions` **原样保留**。UI 上要如实说明"兼容范围 = 上述子集"。

**错误处理（题面硬要求）**：
- JSON 语法错误 → 报错 + 出错位置；
- 字段类型错误（如 `keys` 不是数组、`entries` 不是数组）→ 指出路径与期望类型；
- **重复 ID**（条目之间）→ **必须报出重复的 ID 值与其条目序号**；**能给出原文行号更好**（需自己扫原文定位），**允许降级**、不作为硬指标；随后自动重新编号（或询问）；世界书编辑器**保存前强制 `entries[].id` 唯一**（重复即报错），引擎去重时被丢弃的条目必须记入 `skipped`，不得静默丢条目。⚠️ **工作量提示**：原生 `JSON.parse` **拿不到位置信息**，"原文行号"需要**自己扫原文定位**（例如先按行/字符离线记录各 `entries[].id` 的偏移，再做一次容错扫描；可行，但别低估这块的工作量）；
- 与已有资源同 ID → 覆盖 / 创建副本 / 取消；
- 不支持的 `spec_version` → **明确拒绝**并说明支持范围。

**PNG 导入（可选扩展）**：V2 卡片可嵌入 PNG 的 `tEXt` chunk，关键字 `chara`（V2）/ `ccv3`（V3），内容为 base64 编码的 JSON。读法：解析 PNG 的 tEXt chunks → 取 `chara`（或优先 `ccv3`）→ base64 解码 → JSON。**这是扩展项，时间不够可跳过。**

### 4.11 `tavern-panel` 解析与渲染 `src/core/panel.ts`

**解析规则（纯函数，输入消息正文，输出 segments）：**

1. 用**正则逐块**匹配 `<tavern-panel ...>...</tavern-panel>`（`g` + `s` 标志，允许跨行）。
2. 每个块：读 `type` 属性 →
   - `status`：`JSON.parse(正文)` 成功且是对象 → `{ kind: 'status', data }`；失败 → `{ kind: 'error', problem: '...' }`
   - `choices`：要求 `data.options` 是数组且每项有 `label`/`text` 字符串 → `{ kind: 'choices', options }`；否则 → error
   - 其他 `type` → `{ kind: 'error', problem: '不支持的 type', panelType }`
3. 标签外的文本 → `{ kind: 'text', text }`。
4. **未闭合标签**（有开无闭）→ 该段整体作为 `error`，`problem = '标签未闭合'`。
5. 🔴 **任何错误都保留 `raw` 原文**，渲染时在面板位置显示**原文 + 问题说明**，**绝不丢弃内容**（题面硬要求）。

**渲染规则：**

- `status` → 状态卡片：遍历 `data` 的键值对，键作为标签、值作为内容。**字段名不写死**（题面："字段名称和内容可以自行设计"）—— 但可对常见键（`hp` / `location` 等）做**样式增强**（如 hp 显示进度条），未知键走通用键值渲染。
- `choices` → 按钮列表。点击 → **把该选项的 `text` 填入"这条消息所属会话"的输入框**，**由用户决定是否发送**（不自动发送）。若用户已切到别的会话，**必要时先切回该会话**（或就地提示"已填入会话 X 的输入框"），不得默默填到一个看不见的输入框里。
- `error` → 灰色提示块，显示"无法解析：" + 具体问题 + 原始文本（可折叠）。
- ⚠️ **存储层永远保存原始文本**（含标签）；解析只发生在渲染时 —— 这样"编辑消息"看到的是原文，不会因为渲染而丢数据。
- ⚠️ 渲染时**不要用 `dangerouslySetInnerHTML`**，走 React 的数据渲染（避免 LLM 输出里的 HTML 被当代码执行）。

### 4.12 变量模板（等级 4，可选）`src/core/template.ts`

- 语法：`{{变量名}}`。支持变量来源 = 当前角色卡字段（`char`） + 会话级别的自定义变量表（`{{location}}`、`{{hp}}` 等）。
- **替换时机：发送前**。替换后**再**计算预算（题面原话"发送前，程序把它替换成实际文字，再计算预算"）。
- **保留原始模板**：存储里存的是含 `{{}}` 的原文；预览视图提供"展开结果"开关，让用户同时看到**原始模板**与**展开后文字**。
- 条件语法（可选）：至少支持 `{{#if hp < 20}}...{{/if}}` 形式的简单比较与布尔判断。**需在 README 说明：支持哪些语法、变量缺失时怎么处理**（默认：变量缺失 → 保留原样 `{{hp}}` 并在预览里告警）。

---

## 5. 分层实施计划与验收

> 每完成一层，**单独 commit**（`feat(L1): ...`）。

### L1（先做，最小可用 —— 「开门营业」）

0. 🔴 **先建 `.gitignore`**（含 `.env`、`.env.local`、`node_modules/`、`dist/`）；**首个 commit 之前**确认 `git status` 里没有密钥文件（🔴 真实 key 只在 `.env.local`；`docs/problem-statement.md` 里的 key 已掩码，该文件**保留在交付中**）。⚠️ `dist/` 虽被 `.gitignore` 排除，但**无网兜底需要提交一份构建产物** → 用 `git add -f dist/` 显式加入（或在 `.gitignore` 里放行 `dist/`），README 说明其用途（见 §10）。
1. 项目脚手架：Vite + React + TS，`npm run dev` 能起；同时提供 `.env.example`（占位值）；🔴 **提交 `package-lock.json`**（README 用 `npm ci` 复现依赖），并在本层结束前产出一份 **`dist/` 构建产物**作为**安装期无网**的兜底（README 写清 `dist/` 的**能力边界**：**本地功能全可用、模型请求必失败**；🔴 **建议一并产出 `scripts/static-proxy.mjs`**（零依赖：静态服务 `dist/` + 转发 `/llm` 与 `/llm/defaults`），使它**真能聊天** —— 见 §2.1 与 §10 第 2 条）。
2. IndexedDB 封装 + `repo` 层。
3. 会话 CRUD + 会话列表侧栏（新建/重命名/切换/删除）。
4. 消息区：开场白注入（**来源 = 内置默认角色卡 `DEFAULT_CHARACTER`，见 §4.10**）、发消息、**流式**渲染。
5. 🔴 **L1 交付物：模型设置面板（`baseUrl` / `model` / `apiKey` 三项 + `stream`，持久化到 `settings` store）+ `vite.config.ts` 的动态代理**：`loadEnv(mode, root, 'LLM_')` 读 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 默认值；`configureServer` 挂 `GET /llm/defaults` 返回 `{ baseUrl, model }`（**绝不返回 key**），前端启动时取回并**预填设置面板**（面板三项仍可改，`model` 始终由前端显式发送）；`server.proxy` / `preview.proxy` 用 http-proxy 的 `router(req)` 按请求头 `x-llm-base-url` 动态选 target、`configure(proxy)` 的 `proxyReq` 注入 `Authorization: Bearer <x-llm-api-key>`（**不改写请求体**）。**题面「能够配置服务地址、模型名称、API Key」就靠这条交付**（见 §2.1 / §4.8）。
6. 导出 / 导入单会话（含"覆盖 / 创建副本 / 取消"三选一）。
7. **四个边界**：重试不重复插入 user 消息、未完成回复不进上下文、生成中切会话结果归原会话、刷新后 streaming → interrupted。

**验收**：刷新后会话/消息/设置还在；上面 7 条全部可手动复现通过；**在面板里填 `baseUrl` / `model` / `apiKey` 能实际聊起来**（三项留空时用 `.env` 默认值也能聊）；干净目录 `npm ci` 能装出依赖，**断网时可用已提交的 `dist/` + 静态服务器打开**。

### L2（核心 —— 「调配记忆」）

8. 消息三分离：`uiHidden` / `excluded` / 删除，两种独立视觉标记 + "显示已隐藏消息"入口。
9. 批量操作：多选 + 按 role 筛选后再批量。
10. 世界书编辑器：条目 CRUD、启停、常驻、优先级、关键词数组编辑。
11. **`activateWorldBook()` 纯函数**（§4.4 五条规则）+ 单测。
12. `buildRequest()` 装配 + 发送前预览。
13. `RequestSnapshot` 冻结 + 检查视图（四问都能答）。
14. 上下文用量估算 + 80% 提醒条 + "可处理的消息入口"。

**验收**：题面四问在检查视图里都有答案；改历史消息后**旧快照不变**、新预览变化。

### L3（「接待新客」）

15. 预设：格式定义 + 导入 + 编辑 / 启停 / 排序 + 数据驱动参与编排。
16. 角色卡 V2 导入 / 导出：字段映射表、被忽略规则列表、四类错误处理、ID 冲突三选一。
17. `tavern-panel` 解析 + status 卡片 + choices 按钮（点击填入输入框）+ 错误保留原文。
18. （可选）PNG 角色卡导入。

**验收**：导入题面给的示例消息能正确渲染出正文 + 状态栏 + 按钮；故意给一个坏 JSON，验证**原文保留 + 具体提示**。

### L4（任选）

19. 变量模板 `{{}}` + 展开预览 +（可选）条件。
20. （可选）BroadcastChannel 跨标签页同步 / 沙盒插件示例。
21. （可选）**总结扩展**：若选此项，交付时**必须演示摘要的生成、使用与撤销**（题面交付项 2 原文）；不选则在 README 的"未实现"里明确写"未实现总结扩展"。

---

## 6. 可复用资源映射（**参考，不强制依赖**）

🔴 ⚠️ **诚实声明**：§6.2 的"能参考什么"**依据的是各项目 README 的转述与清单 `D:\aoce\参考资料-GitHub开源项目-4题.md`，未逐行核验其源码**（handoff §9：只有题 4 真拉过 `_ref/` 读核心模块，本节结论仍属**相关性判断、不是质量背书**）；**许可以各仓库当前 `LICENSE` 为准**，本表只是 2026-10-11 的快照。若执行者要采信某个具体实现细节，**必须自己拉下来看过再定**。表内出现的项目标识符（如 `SillyTavern` / `dsh-tavern` / `character-card-v2-maker`）**一律不得出现在交付代码里**（自检见 §6.3）。

### 6.1 本机可复用（用户既有资产，参考其设计）

| 资产 | 位置 | 可参考什么 |
|---|---|---|
| AIchess 前端 | `D:\AIchess\` | React + TS + Vite 项目的目录组织与配置 |
| kids 学习系统 | `D:\qihong\qihong-cloud\web\kids\` | JS 前端的分层与状态处理习惯 |

⚠️ **这些资产属于用户自己的项目，可以读；但不要把它们整段复制进来** —— 会引入无关依赖，答辩时也不好解释。

### 6.2 开源参考项目（2026-10-11 实查快照）

| 项目 | 星 / 语言 / 许可 | 能参考什么 |
|---|---|---|
| `SillyTavern/SillyTavern` | 34.3k / JS / **AGPL-3.0** | **世界书引擎的语义**（扫描深度、常驻/禁用、去重）、**V2 character_book 字段映射**、消息模型 |
| `flizzywine/dsh-tavern` | 881 / JS / **AGPL-3.0** | 状态栏/面板的**产品级设计**（常驻侧栏、可切换、可刷新）、长会话上下文管理思路 |
| `vanirvan/character-card-v2-maker` | 0 / TS / 无许可 | Character Card V2 的字段清单（浏览器端编辑器） |

### 6.3 🔴 净室口径与许可约束（**必读，关系到能不能抄**）

`_ref/SillyTavern/`、`_ref/dsh-tavern/` 均为 **AGPL-3.0**：一旦复制其代码进本项目，本项目整体会被套上 AGPL（必须开源、网络服务也需提供源码）。因此：

**禁止**：
- 复制任何代码片段、函数体、类结构；
- 沿用其函数名 / 变量名 / 常量名 / 注释；
- 逐行翻译（有意的结构同构也算衍生）。

**允许**：
- 阅读并理解**行为语义**（如"扫描深度 = 检查最近 N 条消息"）；
- 借鉴**数据结构设计**与**交互设计**；
- 使用 **Character Card V2 字段名**（这是公开规范，非某家版权）；
- 参考**算法思路**后用**自己的命名与结构**重写。

**自检**：提交前在项目里全局搜索 `world_info`、`scanState`、`keysecondary`、`worldInfoBefore`、`WITimedEffects` 等 SillyTavern 专有标识符，应当**零命中**。

> 这不只是法律问题 —— 评审会深挖项目细节。抄来的代码，答辩时答不出"为什么这么设计"，反而失分。

---

## 7. 目录结构

```
problem4-tavern/
├── README.md                  # 启动方式 / 主要设计 / 兼容范围 / 设计决策 / 截图
├── .gitignore                 # 必须含 .env / .env.local / node_modules/ / dist/（dist/ 兜底产物用 git add -f 显式提交）
├── .env.example               # `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 占位值（真实值在本地 .env.local，不入库）
├── package.json
├── package-lock.json          # 🔴 必须提交（README 用 npm ci 复现依赖）
├── tsconfig.json
├── vite.config.ts             # 🔴 loadEnv(mode, root, 'LLM_') 读 LLM_* 默认值 + configureServer 挂 GET /llm/defaults（返回 {baseUrl, model}，绝不返回 key）；server.proxy + preview.proxy 用 router(req) 按 x-llm-base-url 动态选 target，proxyReq 注入 Authorization（不改写请求体）
├── index.html
├── dist/                      # 🔴 安装期无网的兜底：构建产物（.gitignore 里排除，用 git add -f 提交）
├── scripts/
│   └── static-proxy.mjs       # （建议）零依赖：静态服务 dist/ + 转发 /llm 与 /llm/defaults，使 dist 兜底可实际聊天
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles.css
│   ├── core/                  # 🔴 纯函数内核，不依赖 DOM / React
│   │   ├── types.ts
│   │   ├── defaultCharacter.ts # L1 内置默认角色卡（保证等级 1 就有开场白，见 §4.10）
│   │   ├── tokens.ts          # estimate()
│   │   ├── worldbook.ts       # activateWorldBook()
│   │   ├── assembly.ts        # buildRequest()
│   │   ├── panel.ts           # parsePanels()
│   │   ├── characterCard.ts   # V2 导入导出 + 字段映射
│   │   ├── preset.ts          # 预设校验 / 导入
│   │   ├── template.ts        # {{变量}} 替换（L4）
│   │   └── llm.ts             # 流式客户端
│   ├── storage/
│   │   ├── idb.ts             # IndexedDB 薄封装
│   │   └── repo.ts            # 各 store 的 CRUD
│   ├── state/
│   │   ├── store.tsx          # useReducer + Context
│   │   └── actions.ts
│   └── ui/
│       ├── SessionList.tsx
│       ├── ChatView.tsx
│       ├── MessageBubble.tsx      # 含 uiHidden / excluded 两种标记
│       ├── MessageToolbar.tsx     # 批量 / 筛选
│       ├── WorldBookEditor.tsx
│       ├── PresetManager.tsx
│       ├── CharacterCardImport.tsx
│       ├── RequestPreview.tsx     # 发送前预览
│       ├── SnapshotInspector.tsx  # 检查视图（四问）+ 历史快照列表 / 回放
│       ├── UsageBar.tsx           # 80% 提醒
│       ├── PanelRenderer.tsx      # tavern-panel 渲染
│       └── SettingsPanel.tsx
├── tests/
│   ├── worldbook.test.ts      # 世界书引擎 5 条规则
│   ├── assembly.test.ts       # 装配顺序 / 排除 / 未完成 / pending 只装配一次
│   ├── panel.test.ts          # 标签解析与错误保留
│   ├── preset.test.ts         # 预设导入 / 模板 {{}} / 配置优先级
│   └── characterCard.test.ts  # V2 映射 / 错误处理 / 保留未知字段
├── docs/
│   └── defense/               # 🔴 每个模块一份《答辩问答》（题面"答不出细节 = 过度使用 AI"的唯一评分门）
├── samples/
    ├── sample-session.json
    ├── sample-character-v2.json     # 含内嵌世界书
    ├── sample-preset.json
    └── sample-message-with-panels.md # 题面 tavern-panel 示例
```

---

## 8. 验收与测试清单（执行者必须逐条覆盖）

**纯函数单测（`tests/`，优先做）** —— 跑法：`node --experimental-strip-types --test tests/*.test.ts`（`src/core/` 无 DOM 依赖，跑得起来）。🔴 **不引入 `vitest`**：handoff §2.3 把题 4 的 devDeps 限定为 `vite` + `@vitejs/plugin-react` + `typescript` + `@types/*`；若确需变更，**改 handoff 而不是本文件**。

| # | 用例 | 期望 |
|---|---|---|
| 1 | 扫描深度 3，关键词只在第 4 条旧消息里 | **不激活**（题面原例） |
| 2 | 关键词跨两条消息各出现一半（如"abc"/"def"应为"abcdef"） | **不激活**（不跨消息拼接） |
| 3 | 常驻且启用 + 无关键词 | 直接激活 |
| 4 | 禁用条目 + 关键词命中 | **不激活**（禁用优先） |
| 5 | 同一关键词在 3 条消息里都出现 | **只激活 1 次** |
| 6 | 优先级相同、ID 为 `"10"` 与 `"9"` | 按 **ASCII** 升序 → `"10"` 在 `"9"` **之前**（注意不是数值序） |
| 7 | 未完成（streaming/interrupted）的 assistant 消息 | 不参与装配、也不算扫描集 |
| 8 | `uiHidden = true` 的消息 | **仍然参与装配**（隐藏不影响上下文） |
| 9 | `excluded = true` 的消息 | 不参与装配，也不在扫描集 |
| 10 | 世界书超预算 | 超出者进 `skipped`，reason = `budget_exceeded`；🔴 **超预算的条目不得出现在 `activated` 里**（装了 `continue` 后仍装不下的小条目可继续插入，但每个超预算者一律只进 `skipped`、不计入 `used`） |
| 11 | `<tavern-panel>` JSON 非法 | `raw` 原文保留 + problem 非空 |
| 12 | 标签未闭合 | 同上，且不丢失后续文本 |
| 13 | `type` 不支持（如 `type="foo"`） | 保留原文 + 明确提示 |
| 14 | V2 卡含未知 `extensions` / 未支持字段 | 导出后**原样保留** |
| 15 | V2 卡 `spec_version = "1.0"` | **拒绝** + 说明支持范围 |
| 16 | 发一条 user 消息后装配 | `history` 与 `pending` 中**该消息只出现一次**（§4.2/§4.3：装配时排除 `seq === pendingSeq` 的那条） |
| 17 | 流式生成期间改动输入框 | **本次快照不变**（不得用新输入框内容重算 snapshot / preview）；输入框里已计入本次请求的部分置灰标为"已发送的原文" |
| 18 | 预设导入（含 `{{}}` 模板模块） | 模块数据驱动参与编排；`{{char}}` / 自定义变量展开正确、缺失变量保留原样；`contextConfig` 只作初值、**会话设置优先** |

**端到端手动清单（演示前逐条过）**

- [ ] L1 四个边界场景
- [ ] L1：**新建会话即显示开场白**（来自内置默认角色卡 `DEFAULT_CHARACTER`，`role='assistant'` / `status='complete'`）；L3 导入角色卡后换成卡内 `first_mes`
- [ ] 🔴 **经 `/llm` 代理的 SSE 逐块到达**：DevTools Network 里 `/llm` 的响应是**多个 chunk 增量到达**、聊天气泡**逐段增长**（而不是等整段返回后一次性出现）—— 等级 1「逐步展示 ai 的回复」现在**全部模型流量都走代理**，代理透传不能缓冲整流，这条必须实测
- [ ] 消息三分离：三种操作视觉可区分；隐藏后发给 AI 的内容不变
- [ ] 预览 → 发送 → 检查视图四问都有答案
- [ ] 改历史消息后：旧快照不变，新预览变化；**旧快照能从历史快照列表回放**
- [ ] 发一条 user 消息后装配：**该消息只出现一次**（不得 history + pending 各一份）
- [ ] 流式生成期间改输入框：**本次快照不变**，输入框已发送部分置灰
- [ ] 导入同 ID 会话 → 出现"覆盖 / 副本 / 取消"
- [ ] 上下文到 80% → 提醒条出现且带消息入口
- [ ] 键盘可达：Tab 能走完主要操作，焦点可见，输入框有 label

---

## 9. 演示脚本（交付时写进 README，能按顺序演出来）

建议录制/演示顺序（约 5 分钟）：

1. **开门营业**：新建会话 →（**L1/L2 用内置默认角色卡**，开门即见开场白；L3 完成后改为演示"导入角色卡 → 开场白随之切换"）→ 发一条消息 → 流式回复。
2. **刷新**：F5 → 会话/消息/状态都还在。
3. **消息控制**：隐藏一条（界面变化，但**预览里它仍在**）→ 再排除另一条（预览里消失）→ 展示两种标记不同。
4. **世界书**：新建条目（关键词命中 → 自动激活）→ 加一条常驻 → 把一条禁用 → 点"预览"，在检查视图里指出：**哪条命中、哪个关键词、哪条消息触发**、**哪条为什么没发送**。
5. **上下文提醒**：把 `contextLimit` 调小（如 1000）→ 提醒条出现 → 点消息入口批量排除旧消息。
6. **tavern-panel**：发一条含示例标签的消息 → 看到正文 + 状态栏 + 按钮 → 点按钮 → 文字进输入框（不自动发）。
7. **错误兜底**：故意贴一个坏 JSON 的标签 → 显示原文 + 具体问题。
8. **（若选总结扩展）**：演示摘要的**生成 → 使用 → 撤销**；未选则在 README「未实现」里写明。

---

## 10. README 要求 + 交付物

README 必须包含：

1. **一句话定位** + 截图（至少聊天页 + 世界书检查视图）。
2. **启动方式**：`npm ci`（已提交 `package-lock.json`；无锁文件时才退回 `npm install`）→ `npm run dev`；Node 版本要求 + `node -v` 自检；🔴 **安装期无网兜底**：若无法联网安装依赖，用仓库里已提交的 `dist/`（`.gitignore` 排除，用 `git add -f dist/` 提交）。🔴 **必须写清能力边界**：静态打开 `dist/` 时**本地功能全可用、模型请求必失败**（前端只打 `/llm`，静态服务器无该代理、也无 `/llm/defaults`，本项目无直连模式）；**推荐**给出 `node scripts/static-proxy.mjs`（零依赖，见 §2.1）这条**能实际完成聊天**的兜底路径；**若未做该脚本，必须显式写明"`dist/` 只能展示界面、无法完成聊天"**；**CORS / proxy 的说明**（`/llm` 是**唯一**模型请求路径、**不直连**；代理 target 由请求头 `x-llm-base-url` **动态路由**、无该头时回落 `.env` 的 `LLM_BASE_URL`；`Authorization: Bearer` 只在 Node 侧注入；`.env` 的 `LLM_*` 只是默认值、**改它需重启 dev server**，面板里改 `baseUrl` 不需要；用 `npm run preview` 演示需配 `preview.proxy`，复用同一套 `router(req)`）；**单测跑法** `node --experimental-strip-types --test tests/*.test.ts`（不引入额外测试框架）。
3. **主要设计**：
   - 数据模型（消息的两个开关 + 删除的区别）
   - 装配顺序（§4.3）与**为什么这么定**
   - 世界书算法（§4.4 五条规则）与**处理顺序 / 预算的默认定义**；🔴 **必须写明预算机制是自行引入的**：题面规则 5 只规定"按优先级处理 + 同一条目最多插入一次"，**未提预算或丢弃**（"预算"一词仅出现在等级 4）。本项目的 `worldBookBudgetPct = 25` 与 `budget_exceeded` 跳过是**为配合"上下文过长提醒"而自定**；把 `worldBookBudgetPct` 调到 100 即等价关闭该机制
   - 快照机制（为什么已发送的不可改写）
4. **兼容范围声明**：预设格式 schema；Character Card V2 支持的子集 + **被忽略的运行规则列表**；PNG 是否为扩展。
5. **设计决策 / 已知取舍**（§11 的默认值都写在这）。
6. **未实现**：如实列出（如未做：递归扫描、secondary keys、向量检索、概率触发、移动端适配……）；**若选总结扩展，需说明摘要的生成、使用与撤销；不选则明确写"未实现"**。
7. **演示步骤**（§9）。
8. **密钥与环境变量**：`.env.example` 与密钥处理说明 —— 🔴 **仓库内任何文件都不得写真实 key；真实 key 仅存在于 `.env.local`（已 gitignore）**，由 `vite.config.ts`（Node 侧 `loadEnv(mode, root, 'LLM_')`）读取 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 作为**默认值**，并在代理侧注入 `Authorization`；🔴 **变量名刻意不加 `VITE_` 前缀**：`VITE_*` 会被 Vite **编译期内联进客户端 bundle**，只要有人写一句 `import.meta.env.VITE_*` 形式的读取，key 就进了前端产物，而 `LLM_*` 浏览器侧永远看不到；浏览器侧「模型设置」面板可配 `baseUrl` / `model` / `apiKey`（题面要求，存 `settings` store = IndexedDB），🔴 **README 必须写明事实与风险：用户填的 key 会落在浏览器本地（IndexedDB）**，清浏览器数据即失效，共享机器上不要填私人 key。`docs/problem-statement.md` 里的 key 已掩码，该文件**仍按 handoff 保留在交付中**（它是题面依据）。🔴 **首个 commit 前确认 `git status` 里没有密钥文件**。
9. 🔴 **每个模块必须产出《答辩问答》**，放在 `docs/defense/` —— 题面"答不出细节 = 过度使用 AI"是唯一评分门（另见 §7 目录树）。

交付物：

- 可运行源码 + README + `samples/` 样例数据（**必须有**，题面要"观看效果的演示"）。
- **`docs/defense/` 下每个模块的《答辩问答》**（是什么 / 为什么这么设计 / 会被追问什么，至少 3 问）。
- **git 历史**：分层 commit（题面用它看过程）。
- 会话 session（题面通用要求"如果方便可以留下你的 session"）。

---

## 11. 默认值账本（正文取值一律以本节为准）

| 项 | 题面状况 | 默认值 |
|---|---|---|
| 📒 **本表是 §2–§10 全部默认值 / 阈值 / 可调参数 / 我方决定的汇总账本。凡正文写"未定 / 由 §11 拍板 / 可调"的项，取值一律以本表为准；正文与本节不一致属 PLAN 自身缺陷，须回报修正。** | | |
| 世界书扫描深度 N 的默认值 | 未规定 | **4**（可设置，范围 1–100）；🔴 **`scanDepth = N` 指最近 N 条合格历史，另加本次待发送消息（共 N+1 条参与关键词匹配）** —— **不采用"pending 计入 N 之内"的读法**（那会让最近 N 条实际只扫 N-1 条历史，与题面例子不符）；见 §4.4，已写进 README |
| 扫描深度的范围与非法值 | 未规定 | **1–100**；`0` 或负数视为非法 → 拒绝或钳制为 **1**（§4.4） |
| 超出扫描深度的消息怎么呈现 | 未规定 | 为每条被 `scanDepth` 截断在外的合格历史各产出 `skipped{ reason: 'out_of_scan_depth', source: 'message' }`（消息级未发送原因的产出通路）；与条目级 `skipped` **共用一张表**，靠判别字段 **`source`**（`'message'` / `'entry'`）区分两类来源 —— 对应关系见 §3 `SkippedEntry`（`out_of_scan_depth` / `message_excluded` / `message_incomplete` ⇒ `'message'`，其余 ⇒ `'entry'`），不再靠"`entryId` 是不是消息 id"隐式区分（§4.4 步骤 1、§4.6） |
| 匹配是否大小写敏感 | 未规定 | **不敏感**（子串包含） |
| 世界书内容的**插入位置** | 未规定（只说"处理顺序"） | 拼成一个 `worldbook` 部分，插在 **系统提示之后、历史消息之前**（§4.3 装配顺序 1–6，**每条一行**） |
| 排序 / 去重的确定性口径 | 题面给了 tie-break 规则 | 候选**按 `priority` 降序**；**`priority` 相同时按 `id` 的 ASCII 升序**（不是数值序）；**同一条目最多插入一次**（按 `entry.id` 去重）；V2 转换后多条映射到同一 `id` 时同样按"最多一次"处理，被丢弃者记入 `skipped`（§4.4 步骤 3–4） |
| 关键词匹配的规范化 | 未规定 | **大小写不敏感**（`key` 与消息正文均 `toLowerCase()` 后做子串包含）；`key` 先 `trim()`，**空字符串 key 视为无效并跳过**；**不做正则、不做分词、不做整词匹配**（§4.4 步骤 2、§4.4 末注） |
| "处理"的含义 | 未规定 | **按优先级降序逐个尝试选中并计入预算**（`budgetTokens = floor(contextLimit * worldBookBudgetPct / 100)`），`used + t > budgetTokens` 即 `skip('budget_exceeded')` **并 `continue`**（跳过装不下的、继续尝试后面的小条目，**不是 `break`**）；🔴 **不得静默截断** —— 必须在 `worldbook` 部分末尾追加标记"（世界书预算已满，共 N 条未插入）"，并在预览 / 检查视图的"未发送原因"里逐条列出（`reason = 'budget_exceeded'`，可点击跳到该条目） |
| 世界书预算 | 未规定 | 上下文上限的 **25%**；公式与超预算呈现**同"处理"的含义**那一行（§4.5） |
| 上下文上限默认值 | 未规定 | **32768**（可配置） |
| token 估算方式 | 未规定 | CJK 按 1、其他按 4 字符 1 token 粗估（README 声明为估算） |
| 提醒阈值 | 题面示例 80% | **80%**（可配置）；🔴 以**发送瞬间冻结的快照**为准（`RequestSnapshot.totalTokens`），预览时显示的百分比**仅供参考**、不作为判定依据；发送后按最新一次快照重算（写进 README） |
| 用户消息 `status` / `seq` 时机 | 未规定 | **入库即 `status='complete'` 并在入库时分配 `seq`**；装配时按 **`seq === pendingSeq`** 排除同一条（**不再保留"发送前不落库"备选**）；如确需改动，必须同步修改 §4.3 签名与 §8 用例 16，**不得两套并存** |
| 世界书超预算的处理顺序 | 未规定 | 按 `priority` 降序依次处理、**先处理的先占预算**（这正是"处理顺序"有意义的原因）；`priority` 相同时**按 ASCII ID 升序** —— 排序决定"谁先占预算" |
| 阈值类按"当前值"还是"快照"判定 | 未规定 | 🔴 **快照一旦冻结就只读**：流式期间改输入框/改消息/改设置**不得**重算或改写本次 `RequestSnapshot`。**提醒条本身按实时装配值判定**（题面原话是"待发送内容达到 80%"，它必须随输入变化），快照负责"发之后能复核当时发了什么" —— 🔴 2026-10-11 审计修订，原写法"一律以快照为准"与实现不符（`docs/notes-plan-conflicts.md` §7） |
| 上下文用量提醒的判定式 | 未规定 | 装配后 `totalTokens / contextLimit >= contextWarnPct / 100` 即显示提醒条（**精确比较**，见 §4.5）；提醒条**必须带"可处理的消息入口"**：点击即整批选中较早的消息（最近 2 条除外）并显示隐藏消息，随后一键「批量不进上下文」。位置在**输入框上方**（不在"发送前预览"面板里）—— 🔴 2026-10-11 审计修订 |
| 预设的 `contextConfig` 四项 | 未规定 | 字段为 `contextLimit` / `scanDepth` / `worldBookBudgetPct` / `contextWarnPct`（示例值 32768 / 4 / 25 / 80）；**仅作会话初值**，之后以会话设置为准（§4.9） |
| 扫描集"符合条件"的含义 | 未规定 | `excluded === false && status === 'complete'`（`uiHidden` 不影响扫描集与装配） |
| 无关键词的非常驻条目 | 未规定 | **不参与**（视为永远未命中） |
| 会话导出格式 | 未规定 | 单个 `.json`，含 `{ format, formatVersion, session, messages, snapshots, characterCard?, worldBooks? }`；下载文件名带会话标题与时间（§4.7） |
| 同名条目 / 同名会话 | 未规定 | 允许重名，靠 ID 区分 |
| 同名配置（预设 `contextConfig` vs `SessionSettings`） | 未规定 | 🔴 **会话设置优先；导入预设只填初值** —— 预设 `contextConfig` 仅在会话首次绑定该预设时写入 `SessionSettings`，之后以会话内改动为准（§4.9） |
| 模型请求路径 / 代理口径 | 题面只说"可配置服务地址" | 🔴 一律走 `/llm`（**不直连**）；`vite.config.ts` 用 `loadEnv(mode, root, 'LLM_')` 把 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 读成**默认值**，并挂一个极小的 `configureServer` 中间件 **`GET /llm/defaults`** 返回 `{ baseUrl, model }`（取自 `LLM_BASE_URL` / `LLM_MODEL`，**绝不返回 key**）；代理用 http-proxy 的 **`router(req)`** 按请求头 `x-llm-base-url`（合法 `http(s)://` 才认）**动态选 target**、无该头时回落 `LLM_BASE_URL`，`Authorization: Bearer <x-llm-api-key>` 由 `configure(proxy)` 的 `proxyReq` 在 **Node 侧**注入；🔴 **代理只做这两件事（选 target + 注入 Authorization），不改写请求体** —— `model` 由前端**始终显式发送**（启动时从 `/llm/defaults` 预填面板）；用户填了 `baseUrl` / `apiKey` 就以用户的为准（值存 IndexedDB，README 须写明"key 落在浏览器本地"）；**三项都留空 → 全用 `.env` 默认值**（此时浏览器不持有 key）；🔴 **改 `.env` 里的默认值必须重启 dev server**，面板里改 `baseUrl` 不需要；`npm run preview` 演示需另配 **`preview.proxy`**（同一套 `router(req)`；`/llm/defaults` 中间件只挂在 `configureServer` 上，`preview` 模式下需另行说明或在 README 注明该端点仅 dev 可用）；🔴 **不再需要"直连模式"**，面板配置经代理动态路由即同时满足题面与 CORS（§2.1 / §4.8）。🔴 **2026-10-11 实现修订**：动态选 target 不能用 `server.proxy` 的 `router`（Vite 7 的 `ProxyOptions` 无此选项、`target` 也不接受函数）⇒ 改为自写 `/llm` 转发中间件，语义等价（见 `docs/notes-plan-conflicts.md` §4） |
| 密钥来源 | 题面给公益站 key | 🔴 **真实 key 仅存在于 `.env.local`（已 gitignore）**；**仓库内任何文件都不得写真实 key**；变量名为 **`LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`（刻意不用 `VITE_` 前缀**，避免被 Vite 编译期内联进前端 bundle），只在 `vite.config.ts` 里用 `loadEnv(mode, root, 'LLM_')` 读取（**同时加载 `.env` 与 `.env.local`**）；`docs/problem-statement.md` 里的 key 已掩码、该文件保留在交付中；仓库提供 `.env.example`（占位值），**真实值放 `.env.local`** |
| 设置面板可配项 | 题面要求"能够配置服务地址、模型名称、API Key" | 🔴 **「模型设置」面板提供 `baseUrl` / `model` / `apiKey` 三个输入框**（+ `stream`），全部持久化到 `settings` store（IndexedDB）—— 这是 **L1 交付物**（§5 L1 第 5 步）；**前端启动时 `GET /llm/defaults` 取回 `{ baseUrl, model }` 并预填面板**（三项仍可被用户改）；请求仍走 `/llm`，`baseUrl` / `apiKey` 经请求头 `x-llm-base-url` / `x-llm-api-key` 交给代理动态路由（**不直连**），`model` 由前端**始终显式发送**（代理不改写请求体）；**三项留空即用 `.env` 的 `LLM_*` 默认值**（此时浏览器不持有 key），填了则 key 落在浏览器本地（README 必须写明该事实与风险）（§4.8 / §2.1） |
| 导出 / 导入的覆盖与副本 | 题面要求"明确区分覆盖与创建副本" | 🔴 导出为**内容快照**、各资源 ID 不变；导入同 ID 时**必须三选一**（「覆盖」/「创建副本」/「取消」）；**副本 = 分配新 ID，绝不复用原 ID**（§4.7） |
| 导入副本的标题 | 未规定 | 原标题加后缀 `（副本 2）`（序号递增），副本内消息与快照的 `sessionId` 一并改写（§4.7） |
| 世界书同集合内重复 ID | 题面要求处理"重复 ID" | 保存前**强制 `entries[].id` 唯一**：重复即**报错并报出重复的 ID 值与其条目序号**（**能给出原文行号更好**，需自己扫原文定位，**允许降级**、不作硬指标）、不静默改写；引擎去重时被丢弃的条目**必须记入 `skipped`**（§4.10） |
| 开场白如何进入会话 | 未规定 | 绑定角色卡后，会话创建时插入一条 `role='assistant'`、`status='complete'` 的消息；🔴 **L1 阶段尚无角色卡导入（属 L3）** ⇒ **L1 内置默认角色卡 `DEFAULT_CHARACTER`（`src/core/defaultCharacter.ts`），新建会话默认绑定它**，开场白机制全程一致（§4.10 / §5 L1 第 4 步） |
| 删除的级联规则 | 题面只要求 CRUD | **删会话 → 级联删其 `messages` 与 `snapshots`**；**删预设 → 已导入会话保留快照出的模块副本**（不回溯失效）；**删世界书 / 条目 → 从各 `session.worldBookIds` 及条目引用中移除**，不留悬空引用（§4.1） |
| 同 ID 冲突的处理顺序 | 未规定（题面只要求"覆盖 / 副本 / 取消"） | 🔴 固定三步：**先创建副本资源（分配新 ID）→ 用一张 `idMap` 一次性重写所有引用**（`session.worldBookIds` / `session.characterCardId` / 消息里的 `characterCardId`）→ **最后替换原资源**；禁止先改被引用资源再补引用（§4.7） |
| 每次写操作后 `updatedAt` | 未规定 | 每次写操作完成后更新该资源的 `updatedAt`（`Session.updatedAt`）；**所有写入必须 `await` 事务完成后**再更新内存状态（§4.1） |
| 消息完成态的判定口径 | 题面要求"未完成的助手回复不进上下文" | 参与装配与扫描集的消息必须**同时**满足 `excluded === false` **且** `status === 'complete'`；`streaming` / `interrupted` 一律排除（并作为 `message_incomplete` 记入 `skipped`）（§4.3 / §4.4） |
| 流式写库的节流阈值 | 未规定 | **≥500ms 或累计 200 字符写一次** pending 内容（两个阈值都可调，调整时本表与 §4.8 须同步）；刷新后据此恢复或标记 `interrupted`（§4.8） |
| V2 转换后多条条目映射到同一 ID | 未规定 | 与"同一条目最多插入一次"同口径：**按 `entry.id` 去重，被丢弃者记入 `skipped`，不得静默丢条目**（§4.4 步骤 3、§4.10） |
| `dist/` 兜底的能力边界 | 未规定（PLAN 自引入的安装期兜底） | 静态打开 `dist/`：**本地功能全可用、模型请求必失败**（无 `/llm` 代理、无 `/llm/defaults`，且本项目无直连模式）；**推荐**产出零依赖 `scripts/static-proxy.mjs`（静态服务 `dist/` + 转发 `/llm`、`/llm/defaults`）使其**可实际完成聊天**，否则 README 必须显式写明该边界（§2.1 / §5 L1 / §10 第 2 条） |
| 移动端适配 | 可选加分 | L1–L3 完成后再考虑 |
| PNG 角色卡导入 | 可选扩展 | 最后再做 |

---

## 附：给执行者的第一步

1. 读 §1（题面）与 §4.4（世界书五条规则）—— 这两处是本项目的成败点。
2. 搭脚手架 + 纯函数内核（`core/worldbook.ts`、`core/assembly.ts`）+ 先把 §8 的前 10 条单测写出来跑绿。**内核绿了再写 UI。**
3. 再按 §5 的 L1 → L2 → L3 推进，**每层一个 commit**。
4. 交付前跑 §6.3 的自检（搜 SillyTavern 专有标识符，应为零命中）与 §8 的端到端清单。

## 附二：不要做的事

- ❌ 不要把真实 SillyTavern 的复杂度搬进来（递归扫描 / secondary keys / 概率 / 定时效果 / 分组互斥）—— 题面明确说"核心版本不递归"。
- ❌ 不要用隐藏或排除来模拟删除。
- ❌ 不要让已发送的快照被后续编辑改写。
- ❌ 不要在渲染失败时丢弃消息内容。
- ❌ 不要引入超出 §2.2 的依赖。
