# 模块 02 · 上下文装配

> 源码：`src/core/assembly.ts`（纯函数）· 测试：`tests/assembly.test.ts`（8 个用例）
> 题面位置：等级 2「消息控制」+「世界书」的"发送前预览 / 请求快照"

## ① 这段在干什么

`buildRequest()` 把一次请求要发给模型的东西**按固定顺序**拼出来，并给出**每部分的来源**：

```
1. character     角色卡：名称 + 描述
2. preset-system 预设中 position='system' 且 enabled 的模块，按 order 升序
3. worldbook     世界书激活内容（拼成一个部分，每条一行）
4. history       status==='complete' && excluded===false 的消息，按 seq 升序
                 —— 再排除 seq === pendingSeq 的那一条（入口处统一剔除，见 §2.3）
5. pending       本次待发送的用户输入（全文只在这里出现一次）
6. post-history  预设中 position='postHistory' 且 enabled 的模块
```

输出 `{ parts, activations, skipped, totalTokens }`。
另有 `partsToChat(parts)` 把 parts 还原成模型真正收到的 `{role, content}[]`，
`freezeSnapshot()` 把它冻结成 `RequestSnapshot`。

## ② 关键设计决策 + 为什么

### 2.1 为什么要"装配顺序"这个概念

题面没规定顺序，但**顺序本身是语义的一部分**：系统提示必须在历史之前、post-history 模块必须在历史之后。
把它写成**文档化的编号 1–6**，而不是散落在各个 UI 回调里，好处是：
预览、快照、真实请求**共用同一份实现**（`ChatView` 的预览、`RequestPreview`、`store.runGeneration`
全都调 `buildRequest`），不可能出现"预览里是这样、实际发出去是那样"。

### 2.2 两个独立开关在装配里的地位（与模块 03 呼应）

```ts
// 入口先做两件归一化（整个装配共用这份消息集合）
const ordered = [...new Map(messages.map((m) => [m.id, m])).values()].sort((a, b) => a.seq - b.seq);
const contextMessages = ordered.filter((m) => m.seq !== input.pendingSeq);

// history 部分
for (const msg of contextMessages) {
  if (msg.excluded) continue;              // 不进上下文 ⇒ 装配阶段直接跳过
  if (msg.status !== 'complete') continue; // 未完成 ⇒ 不参与
  push({ kind: 'history', ... });
}
```

**`uiHidden` 根本不出现** —— 这是刻意的：装配层不读这个字段，从代码结构上就没有"隐藏能改变上下文"的可能。

### 2.3 为什么"待发送消息只装配一次"要按 `seq` 排除

本项目采用 **"用户消息入库即 `status='complete'` 并分配 `seq`"**（PLAN §4.2 / §11）。
好处是：**刷新页面不会丢这条消息**，重试也不会重复插入。
代价是它同时存在于"历史"和"本次待发送"两个语义位置，所以装配时必须按 `seq === pendingSeq`
把它从 history 里剔掉，只保留 pending 那一份。

```ts
const contextMessages = ordered.filter((m) => m.seq !== input.pendingSeq);   // 这条就是 pendingUserText
```

**为什么在入口剔除、而不是只在 history 循环里 `continue`**：同一个 `pendingSeq` 也**必须**
从世界书扫描集里剔除。否则"待发送消息"会占掉一格扫描窗口，导致
**预览里激活的世界书条目在真正发送时激活不了**（`scanDepth=3` 时最明显）。
另外调用方（`store.runGeneration`）可能把同一条消息既从 `state.messages`
又从 `extraMessages` 传进来，所以入口还要**按 `message.id` 去重**。
两件归一化合起来，保证预览与真实发送看到的是**同一份**消息集合。

**测试**：`#16 待发送的 user 消息在 history 与 pending 中只出现一次`；
`tests/fixes.test.ts` 的"预览与真实发送的世界书激活必须逐项一致"与"同 id 重复注入按 id 去重"。

> 追问预判：**为什么"剔除待发送消息"用 `seq`、"去重"用 `id`？**
> 两者表达的是不同的东西，不是二选一：
> `seq === pendingSeq` 是在说"**这一条就是本次待发送的那条**"（语义位置），
> 所以它必须同时也从扫描集里消失；而 `id` 去重是在说"**同一个对象被传了两遍**"（数量问题），
> 只有 `id` 能判断。
> 另：`seq` 同时被 worldbook 引擎用来做排序，一处定义两处受益。

### 2.4 为什么每个预设模块单独成一个 part（而不是拼成一个字符串）

题面检查视图第 2 问是"**每部分来自哪个模块**"。如果 6 个模块拼成一段文本，这一问就答不了。
所以 `preset-system` / `post-history` 的**每个模块各占一个 part**，带 `sourceId = module.id` 与
`label = 预设模块「名字」`；世界书则按 PLAN 要求**拼成一个 part**（因为它的语义就是"一段背景材料"），
条目级归属由 `activations` 表回答。

### 2.5 为什么 `SnapshotPart` 要带 `role`

PLAN §3 的 `SnapshotPart` 没有角色字段。但没有它，冻结的 `parts` 就只是"一堆文本"，
**无法还原成一次真实请求**（"回放旧快照"是题面要求）。因此加了**可选**字段 `role?: Role`：

- 写入侧：`buildRequest()` 给每个 part 填 `role`；
- 读取侧：`partsToChat()` 用它拼 `messages`；缺失时回落 `system`（旧数据仍可读）。

（记录在 `docs/notes-plan-conflicts.md` §2。）

### 2.6 世界书"超预算"的可观测标记

按 PLAN §4.4 / §11 原文，超预算时在 `worldbook` part 末尾追加
`（世界书预算已满，共 N 条未插入）`。这是**刻意的可观测性优先**：
验收时你要能一眼看出"这次有东西被预算挡掉了"，而不是怀疑程序没匹配上。

## ③ 可能被追问的问题

**Q1：为什么预览和快照是两次计算？会不会不一致？**
是**同一个函数**、两次调用。预览用"当前输入框内容 + 下一个 seq"计算，每次输入都会重算；
真正点「发送」时再算一次，**把结果冻结**成快照。两者用的是同一个 `buildRequest`，
差异只来自"调用时点的数据"。快照一旦冻结，输入框再改也不回写它（测试 `#17`）。

**Q2：`history` 里为什么只保留 `complete`？被中断的回复去哪了？**
`streaming` / `interrupted` 一律不参与装配 —— 题面等级 1 硬要求"未完成的助手回复默认不进入后续上下文"。
它们不会消失：消息仍在列表里（带「已中断」标记），并在检查视图的
**消息级 skipped** 里以 `reason: 'message_incomplete'` 出现（测试 `#7`）。

**Q3：`character` 部分为什么是 "名称 + 描述" 两行？**
因为这是本题自己定义的最小可用映射（V2 的 `data.name` + `data.description`）。
它同时是"角色卡确实生效了"的可见证据：改掉角色卡描述，预览里立刻能看到变化。

**Q4：`totalTokens` 是怎么算的？包括什么？**
`parts` 各项 `tokens` 之和；每项的 `tokens = estimate(content)`。
**包含**世界书预算标记那一行（因为它确实会被发出去）。这是估算值，见模块 11。

**Q5：`pendingSeq` 怎么来的？如果输入框的内容还没入库呢？**
`nextSeq(messages, sessionId)` = 现有消息最大 `seq` + 1。有两种情况：
① 正常发送 —— 用户消息先入库拿到真实 `seq`，再把它当 `pendingSeq` 传进来；
② 预览 —— 消息还没入库，用"下一个 seq"占位，语义完全一致（都不会与历史撞车）。

**Q6：装配时 `worldBooks` 传的是"本会话启用的"还是"全部"？**
调用方（`ChatView` / `store.runGeneration`）先按 `session.worldBookIds` 过滤，再传进来。
`buildRequest` 内部还会再建一张 `entryId → 世界书名` 的映射，用于生成
`世界书「Fate 世界观」/ 条目「圣杯」` 这种可读来源标签。
