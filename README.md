# 我的酒馆 · Tavern Lite（题 4 交付说明）

> **一句话**：一个**纯前端、本地优先**的轻量 SillyTavern —— 自己做角色卡、自己写世界书、
> 自己决定每次请求到底发了什么；数据全部落在浏览器 IndexedDB，没有后端。
>
> 本 README 面向**快速评审**：完成度 → 怎么用 → 怎么检查 → 代码导读。
> 完整设计细节见 **`docs/README-设计详版.md`**；每个模块的《答辩问答》在 **`docs/defense/`**（13 篇）。

---

## 1. 完成度（对照题面四个等级）

| 等级 | 题面要求 | 状态 |
|---|---|---|
| **L1 开门营业** | 会话增删改切、角色开场白、流式回复、刷新恢复、导入导出（区分覆盖/副本）；**四条硬要求**（重试不重复插入 / 未完成回复不进上下文 / 生成中切会话归属正确 / 刷新打断标中断） | ✅ 全做；四条硬要求抽成纯函数内核，**27 条专门行为用例**覆盖 |
| **L2 调配记忆（本题核心）** | (A) 消息三态分离（隐藏 / 不进上下文 / 删除是另一回事，界面可区分）＋批量；(B) 世界书编辑器 + **题面 5 条规则逐条实现** + 发送前预览 + 请求快照 + 检查视图（能答"发了什么/来自哪/谁触发/为什么没发"）；(C) 上下文 80% 提醒（用量/上限/可处理入口） | ✅ 全做 |
| **L3 接待新客** | (A) 可导入预设（数据驱动，不改代码即可用）+ Character Card V2 明确子集 + 未知字段导出保留 + 错误处理 + 同 ID 三选一；(B) `<tavern-panel>` 标签 → 状态栏/按钮小界面，坏 JSON 保留原文并提示问题 | ✅ 全做（PNG 角色卡仅导入尽力提取，不导出） |
| **L4 扩建（任选）** | 变量模板 | ✅ 做了（含 `{{#if}}` 条件分支） |
| 模型配置 | 服务地址 / 模型名 / API Key 可配置 | ✅ 设置面板三项即时生效 + `.env.local` 默认值；全程走 `/llm` 代理（浏览器不直连，密钥不进 bundle） |

**测试**：83 条用例 **83 pass / 0 fail**（Node 内置 runner，`src/core/` 纯函数不依赖 DOM）；另有浏览器端到端清单（`docs/defense/13-delivery-checklist.md`）覆盖"真流式 / 真刷新恢复"等自动化测不到的点。
**未实现**（如实声明，详版 §5）：世界书递归扫描 / 次级关键词 / 概率触发 / 总结扩展 / 移动端适配 / PNG 导出 / 多模态 / 群聊 —— 均为题面"核心版本不做"或任选项。

---

## 2. 怎么使用

**环境**：Node ≥ 20.19 或 ≥ 22.12（Vite 7 要求）+ Chromium 系浏览器。

```bash
npm ci            # 有锁文件，优先 ci
npm run dev       # 打开 http://localhost:5173
```

**接模型**：复制 `.env.example` 为 `.env.local` 填 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`；
或在**页面「设置 → 模型设置」**里填（界面填的优先、立即生效不用重启）。
**没有 Key 也能用**：所有本地功能（会话/世界书/预设/角色卡/快照/导入导出）离线可用，发消息时给出明确错误而非白屏。

**无网兜底**：仓库内已提交构建产物 `dist/`，装不上依赖时：

```bash
npm run serve:dist   # = node scripts/static-proxy.mjs（零依赖）：托管 dist/ + 转发 /llm → http://localhost:4173
```

> ⚠️ 直接 `file://` 或任意静态服务器打开 `dist/` **只能看界面，不能聊天**（前端只打同源 `/llm`，无直连模式 —— CORS 会挡）。

---

## 3. 怎么检查（5 分钟验收清单）

```bash
# A. 全量用例（应输出 # tests 83 / # pass 83 / # fail 0）
npm test
npm run typecheck    # 零错误

# B. 界面演示（样例数据在 samples/：sample-session.json / sample-character-v2.json /
#    sample-preset.json / sample-message-with-panels.md）
npm run dev
```

**预期看点**（对应题面演示逻辑，约 5 分钟）：
1. 新建会话**开门即见开场白**（内置默认角色卡）→ 发消息 → 回复**逐段流式增长**（DevTools Network 里 `/llm` 是多个 chunk 增量到达，不是一次性出现）；
2. F5 刷新 → 会话/消息/状态都在（IndexedDB），且停留在刚才的会话；
3. 隐藏一条消息（**发送前预览里仍在**）vs「不进上下文」另一条（预览里**消失**）—— 两种标记视觉可区分，删除是独立的第三个操作；
4. 世界书：命中关键词自动激活 / 常驻 / 禁用 → 打开**检查视图**：哪条命中、哪个关键词、哪条消息触发、哪条为什么没发送，全部可答；
5. 把 `contextLimit` 调小 → **80% 提醒条**出现 → 点「选中较早的消息」→ 批量不进上下文，一步解决；
6. 发一条含 `<tavern-panel>` 的消息（从 `samples/sample-message-with-panels.md` 复制）→ 状态栏 + 按钮 → 点按钮文字**进输入框不自动发**；贴坏 JSON → **保留原文 + 提示具体问题**；
7. 「导入会话」选 `samples/sample-session.json` → 同 ID 时出现**覆盖 / 创建副本 / 取消**三选一。

---

## 4. 代码导读

```
src/
  core/          ★纯函数内核：不依赖 DOM/React，node --test 直接可跑 —— 业务逻辑全在这里
    worldbook.ts       世界书引擎（题面 5 条规则逐条）
    assembly.ts        上下文装配 buildRequest / 快照冻结 freezeSnapshot
    messaging.ts       L1 四条硬要求的判定（重试锚点 / 中断判定与启动修复）
    panel.ts           <tavern-panel> 解析（坏标签保留原文 + 报具体问题）
    characterCard.ts   V2 导入/导出（未知字段保留）
    preset.ts          预设 st-lite 格式校验 / 序列化（数据驱动，改代码才能加模块是不合格项）
    template.ts        {{}} 变量模板（L4，含 {{#if}}）
    tokens.ts          token 粗估 / 世界书预算 / 80% 阈值判定
    llm.ts             /llm 客户端（SSE 增量解码）
  storage/       IndexedDB 薄封装 + 仓储（级联删除 / 导入 idMap）
  state/         useReducer + Context（流式生成 / 快照冻结）
  ui/            组件（仅渲染与交互，业务逻辑都在 core/）
tests/           83 用例（Node 内置 test runner，不引 vitest —— 依赖上限要求）
samples/         4 件可演示样例数据
scripts/static-proxy.mjs   零依赖兜底服务（静态 + /llm 转发）
vite.config.ts   /llm 动态代理（dev + preview 双挂载；Vite 7 无 server.proxy.router，故自写中间件）
```

**主要设计（答辩深挖入口，详版 §2 各有展开）**：
1. **消息三态分离**：界面隐藏 / 不进上下文 / 真删除是三个独立操作 —— "不想看"和"不想让 AI 读"语义不同；
2. **世界书 5 条规则 + 预算机制**：预算（上下文的 25%）是**本项目自引入的**，题面未规定 —— 已在 README 主动交代，调到 100 即等价关闭；
3. **请求快照不可改写**：已发出的请求冻结存档，后续编辑只影响下一次请求 —— "检查视图"答的是快照，不是当前状态；
4. **密钥零进 bundle**：变量刻意不带 `VITE_` 前缀，`LLM_*` 只在 Node 侧读取注入 Authorization；浏览器侧 key 只存在用户自己填的 IndexedDB（风险已在 README 声明）；
5. **core 纯函数架构**：所有判定（流式解码 / 中断修复 / 面板解析）抽离 DOM，83 条测试无需浏览器。
