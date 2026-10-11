# 《答辩问答》索引

> 题面原话：**"我们会对项目细节进行深入提问，如果你不能答出细节可能会被认为过度使用 AI。"**
> 这是本题**唯一的评分门**。本目录按模块逐份给出：**① 这段在干什么 → ② 关键设计决策 + 为什么 → ③ 会被追问的问题与要点**。
>
> 每份文档都标了对应源码位置，答辩时可以直接按 `文件:行号` 打开给对方看。

## 模块清单

| # | 模块 | 源码 | 一句话 |
|---|---|---|---|
| 01 | [世界书引擎](01-worldbook-engine.md) | `src/core/worldbook.ts` | 决定本次请求补哪些背景信息（题面五条规则） |
| 02 | [上下文装配](02-assembly.md) | `src/core/assembly.ts` | 把角色卡 / 预设 / 世界书 / 历史 / 待发送拼成一次请求 |
| 03 | [消息三分离](03-message-three-way.md) | `types.ts` + `store.tsx` + `MessageBubble.tsx` | 界面隐藏 / 不进上下文 / 删除 是三个不同机制 |
| 04 | [快照与检查视图](04-snapshot-inspector.md) | `assembly.ts` + `SnapshotInspector.tsx` | 发送了什么必须可回放，且旧快照不可被改写 |
| 05 | [tavern-panel 解析与渲染](05-panel-parser.md) | `core/panel.ts` + `ui/PanelRenderer.tsx` | 标签坏掉也要保留原文 |
| 06 | [预设导入](06-preset.md) | `core/preset.ts` + `ui/PresetManager.tsx` | 数据驱动，不写死模块名 |
| 07 | [角色卡 V2 导入导出](07-character-card-v2.md) | `core/characterCard.ts` | 明确子集 + 未知字段原样保留 |
| 08 | [存储层 IndexedDB](08-storage-idb.md) | `storage/idb.ts` + `storage/repo.ts` | 自写薄封装，写操作等事务完成 |
| 09 | [状态与流式生成](09-state-streaming.md) | `state/actions.ts` + `state/store.tsx` | 生成中切会话、配置快照、中断修复 |
| 10 | [/llm 代理与 CORS](10-llm-proxy-cors.md) | `vite.config.ts` + `scripts/static-proxy.mjs` | 浏览器不直连第三方 API |
| 11 | [token 估算与 80% 提醒](11-tokens-usage.md) | `core/tokens.ts` + `ui/UsageBar.tsx` | 估算是估算，判定以快照为准 |

## 开场先讲的四句话（30 秒版）

1. **纯函数内核，UI 只是壳**：世界书激活、上下文装配、面板解析、V2 转换四块都在 `src/core/`，
   **不依赖 DOM 和 React**，所以能用 `node --test` 直接跑单测（50 个用例全绿）。
2. **三个操作是三种机制**：`uiHidden` 只影响渲染、`excluded` 只影响装配、删除是真删 —— 不是一个开关的三种叫法。
3. **每条"发送了什么"都可回放**：每次发送冻结一条 `RequestSnapshot`（含每部分来源 + 命中证据 + 未发送原因），
   冻结之后任何编辑都不改写它。
4. **模型流量一律走同源 `/llm`**：浏览器不直连第三方 API，CORS 在这个架构里根本不会出现。

## 最容易被问倒的三个"陷阱题"（提前背）

| 陷阱 | 错误答法 | 正确答法 |
|---|---|---|
| "世界书关键词匹配是拼成一个大字符串再 includes 吗？" | "是，SillyTavern 就这么做" | **不是**。题面规则 2 明确要求**单条消息正文内**匹配、**不跨消息拼接**（`worldbook.ts` 的 `matchKeyword` 逐条消息独立判断） |
| "同级优先级是按数值排吗？" | "按数字大小" | **按 id 的 ASCII 升序**：`"10" < "9"`（`'1'`=49 < `'9'`=57）。直接字符串比较即可 |
| "把消息隐藏起来就等于没发给 AI 吧？" | "对" | **不对**。`uiHidden` **不参与任何过滤** —— 它只改渲染，装配里一个字都不少 |

## 已知取舍（主动交代，别等被问）

- **世界书预算**是**本项目自引入**的机制（题面规则 5 只说"按优先级处理"，"预算"一词只出现在等级 4）。
  它存在的目的是给"上下文过长提醒"一个可解释的配额；把 `worldBookBudgetPct` 调到 **100 就等于关闭**。
- **scanDepth 的读法**：`N` = 最近 N 条**合格历史**，**另加**本次待发送消息 ⇒ 共 **N+1** 条参与匹配。
  （若把 pending 算进 N，就变成"最近 N 条"实际只扫 N-1 条历史，与题面例子不符。）
- **未实现**：递归扫描世界书正文、secondary keys、概率触发、sticky/cooldown、分组互斥、向量检索、
  移动端适配、总结扩展。详见 README「未实现」一节。
- **Vite 7 没有 `router` 选项**，PLAN 里"用 `server.proxy` 动态选 target"实际做不到，
  已改为自写转发中间件（`docs/notes-plan-conflicts.md` §4）。
