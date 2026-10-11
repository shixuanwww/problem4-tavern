# 模块 04 · 请求快照与检查视图

> 源码：`src/core/assembly.ts`（`freezeSnapshot` / `partsToChat`）· `src/ui/SnapshotInspector.tsx` · `src/ui/RequestPreview.tsx`
> 测试：`tests/assembly.test.ts` `#17` · 题面位置：等级 2「提供发送前预览，并保存发送后的请求快照。检查视图至少能回答：四问」

## ① 这段在干什么

- **发送前预览**：点「发送前预览」→ 调 `buildRequest()` → 按顺序列出将要发送的每个部分（来源标签 / 内容 / token）。
- **发送快照**：点「发送」的**那一瞬间**，把同一份 `buildRequest()` 的结果冻结成 `RequestSnapshot` 落库，
  并把 `snapshot.id` 写到生成的 assistant 消息上（`message.requestId`）。
- **检查视图**（`SnapshotInspector`）：按会话倒序列出历史快照，点任意一条**只读回放**，
  并逐条回答题面的四个问题。

## ② 关键设计决策 + 为什么

### 2.1 快照 = 发送瞬间的 parts **副本**（冻结）

```ts
export function freezeSnapshot(session, model, built, now, id): RequestSnapshot {
  return {
    ...,
    parts: built.parts.map((p) => ({ ...p })),          // 浅拷贝每个 part
    activations: built.activations.map((a) => ({ ...a })),
    skipped: built.skipped.map((s) => ({ ...s })),
  };
}
```

为什么必须**拷贝**而不是直接引用：`buildRequest` 的返回值每次都是新对象，看起来"不拷贝也没事"，
但一旦将来有人复用 part 对象，引用就会把"当时的内容"和"现在的内容"绑在一起。
拷贝是**用便宜的代价买下"旧快照绝不被改写"这条不变量**。

**测试**：`#17 冻结之后编辑历史消息，旧快照仍是旧内容，新一次装配才反映改动`。

### 2.2 为什么"改历史消息只影响后续请求"

题面原话："**修改历史消息会影响后续请求，但不能改写已经发出的请求快照。生成期间修改设置，也只能影响下一次请求。**"

在本项目里这是**结构性成立**的，不是靠纪律：

1. 快照是**落库的独立记录**（`snapshots` store），不含对消息的引用，只含文本与来源标签；
2. 流式生成期间**不会**再调用 `buildRequest()` —— `store.runGeneration` 在开流之前算完、冻好，
   然后闭包持有 `built.parts` 的拷贝；
3. 输入框在生成期间被改掉，只是改 `ChatView` 的 `draft`，**不会**回算本次请求。

UI 上也把这件事说出来：生成中会在输入框上方显示一条
"**本次请求已冻结成快照 —— 现在改设置或裁剪消息只影响下一次请求**"。

### 2.3 检查视图四问 → 四个产出通路

| 题面四问 | 数据来源 | UI 位置 |
|---|---|---|
| ① 实际发送了哪些内容、**顺序**是什么 | `parts` 按 `index` | `PartList`（编号 + 类型标签 + 来源标签 + token） |
| ② 每部分**来自哪里** | `part.label`（如 `世界书「Fate」/ 条目「圣杯」`）+ `part.sourceId` | 同上，每行一个来源标签 |
| ③ **哪个关键词、哪条消息**触发了世界书 | `activations[]`：`entryName` / `reason` / `matchedKey` / `matchedMessageId` | `ActivationTable`，命中消息可点击跳转 |
| ④ 某条内容**为什么没有发送** | `skipped[]`，按 `reason` 分类，**再按 `source` 分成"条目级 / 消息级"两张表** | `SkippedTable` |

第 4 问的 `reason` 覆盖题面点名的全部情形：
`disabled`（禁用）· `no_keyword_match`（未命中）· `message_incomplete`（未完成）·
`message_excluded`（关闭上下文）· `budget_exceeded`（超预算）· `empty_content`（空正文）·
`out_of_scan_depth`（超出扫描深度）· `duplicate_id`（重复被去重）。

### 2.4 历史快照列表 + 只读回放（"快照只写不读不算完成"）

检查视图顶部是**倒序的快照列表**（时间 / model / token / N），点任意一条切换查看 ——
这就是"旧快照不变"的**可视化验收点**：改了消息之后回到旧快照，内容纹丝不动。

`ActivationTable` 里 `matchedMessageId === '__pending__'` 会被显示成"本次待发送消息"
（那是扫描集里代表 pending 的伪 id，见 `worldbook.ts` 的 `PENDING_SCAN_ID`）。

### 2.5 为什么预览和快照要长得一样

预览用的是**同一批组件**（`PartList` / `ActivationTable` / `SkippedTable`）。
这样"预览 = 快照的预演"在视觉上自明，答辩演示时可以直接对照：
改掉一条消息 → 预览里变化 → 而历史快照不变。

## ③ 可能被追问的问题

**Q1：快照里存了 `apiKey` 吗？**
**没有，而且绝不能有**。`RequestSnapshot` 只有 `model` / `parts` / `activations` / `skipped` /
`totalTokens` / `contextLimit` / `scanDepth`。`apiKey` 只在 `runGeneration` 的**闭包内**用于设请求头，
既不落 `RequestSnapshot`，也不落 `session`。导出会话时自然也不会带出去。

**Q2：生成期间用户改了模型设置，本次请求用哪个？**
用**发送时快照下来的那一个**。`store.runGeneration` 开头就 `const config = { ...snap.settings }`，
之后所有 `streamChat` 调用都读 `config`，**不读 `stateRef.current.settings`**。
这也回答了"生成期间修改设置，也只能影响下一次请求"。

**Q3：为什么快照不直接存"最终发给模型的 messages 数组"？**
因为题面第 2 问要的是"**每部分来自哪条消息、哪个模块或哪个世界书条目**"。
只存 `messages: [{role, content}]` 会丢掉来源；存 `parts`（带 `label` / `sourceId` / `kind`）
才能回答来源问题。需要还原成请求体时用 `partsToChat(parts)`，两者可以互相推出，但 `parts` 是超集。

**Q4：`totalTokens` 是快照时的值，之后会话变长了，提醒条用哪个？**
提醒条用**最新一次**的装配结果（预览）来显示进度；但"是否触发提醒"的**权威判据**是
**发送瞬间冻结的快照**（`RequestSnapshot.totalTokens / contextLimit >= contextWarnPct/100`）。
这样"发送后用量变化"不会反过来改写"当时到底超没超"这个结论。见模块 11。

**Q5：`scanDepth` 为什么要存进快照？**
因为它决定了"当时哪些消息参与了世界书扫描"。事后回放时若不知道当时的 N，
就没法解释"为什么这条消息没触发世界书"。同理由 `contextLimit` 也一起存，
让快照自带完整的"当时口径"。

**Q6：删掉会话之后，它的快照还在吗？**
不在。`deleteSessionCascade` 会把该会话的 `messages` 与 `snapshots` 一起删掉。
理由：快照脱离了会话就没有语义（它的 `sessionId` 已指向不存在的记录），留着就是孤儿数据。
但**删除单条消息不会删快照** —— 见模块 03 Q2。
