# 模块 01 · 世界书引擎

> 源码：`src/core/worldbook.ts`（纯函数）· 测试：`tests/worldbook.test.ts`（16 个用例）
> 题面位置：等级 2「世界书」五条规则（`docs/problem-statement.md` §2.4）

## ① 这段在干什么

输入「本会话启用的全部世界书条目 + 该会话全部消息 + 本次待发送的用户输入 + 扫描深度 N + 预算」，
输出三样东西：

| 输出 | 含义 |
|---|---|
| `activated[]` | 这次真正要插进上下文的世界书条目（含"为什么激活"的证据） |
| `skipped[]` | **没**插入的条目 / 消息，以及原因（这是检查视图第 4 问的答案来源） |
| `usedTokens` | 这次世界书占掉多少预算 |

## ② 关键设计决策 + 为什么

### 2.1 六步流水线（与题面规则一一对应）

```
步骤 1  构造扫描集   eligible = 消息里 !excluded && status==='complete' 且 **不是** seq===pendingSeq 那条
                     scanSet  = 最近 N 条 eligible  +  {pending 待发送输入}
步骤 2  逐条判定候选  禁用→skip('disabled') / 常驻→候选 / 无关键词→skip / 命中→候选 / 未命中→skip
步骤 3  去重         同一条目最多一次（按 entry.id），被丢弃者记 skipped('duplicate_id')
步骤 4  排序         priority 降序；同优先级按 id 的 ASCII 升序
步骤 5  预算         按排序逐个尝试；装不下的 skip('budget_exceeded') 后 **continue**
步骤 6  空正文       候选条目正文为空白 → skip('empty_content')
```

### 2.2 为什么必须**单条消息内**匹配（`matchKeyword`）

真实 SillyTavern 会把最近 N 条消息**拼成一个大字符串**再 `includes`。题面规则 2 明确否掉了这个做法：
**"在单条消息正文内进行关键词包含匹配……不跨消息拼接匹配。"**

所以实现是双重循环 **消息在外、关键词在内**，每条消息独立判断：

```ts
for (const msg of scanSet) {            // 单条消息为边界
  const haystack = msg.content.toLowerCase();
  for (const rawKey of keys) { ... haystack.includes(key.toLowerCase()) ... }
}
```

- **测试**：`#2 关键词跨两条消息各出现一半（"abc" / "def"）→ 不激活`。
- **副作用（要主动说清）**：消息在外层 → 命中的是**扫描集里最早**那条消息，这也让
  `matchedMessageId` 有确定含义（检查视图据此跳转）。

### 2.3 为什么"扫描深度 N"= 最近 N 条历史 **+ pending**（共 N+1 条）

题面规则 1 是**一句话里并列两个对象**："扫描最近 N 条消息，**包含本次待发送的用户消息**"。
- 读法 A（本项目）：`eligible` 的最后 N 条 **加上** pending ⇒ N+1 条参与匹配。
- 读法 B（不采用）：pending 也算在 N 之内 ⇒ "最近 N 条"实际只扫到 N-1 条历史，
  与题面"扫描深度是 3，就检查最近 3 条符合条件的消息"的例子直接冲突。

**测试**：`#1 扫描深度 3，关键词只在第 4 条旧消息里 → 不激活`；`pending 关键词也能命中`。

> 🔴 **一个容易自己踩到的坑（已修）**：正常发送时"本次待发送的 user 消息"**已经入库**
> （`seq === pendingSeq`）。如果它既进 `eligible`、又作为 pending 进扫描集，就会**占掉两格扫描窗口** ——
> `scanDepth=3` 实际只扫到 2 条旧消息，于是"**预览里激活的条目，真正发送时不激活**"。
> 所以 `buildRequest()` 入口先按 `message.id` 去重、再把 `seq === pendingSeq` 那条从扫描集里剔除
> （见模块 02 §2.3）。另一个入口 `activateWorldBook()` 本身不做这件事 —— 它是纯函数，
> 调用方必须传"已经排除掉 pending 的"消息集合。

### 2.4 为什么排序要加"同级按 ASCII 升序"

题面规则 5 比真实 ST 多了一句 tie-break。JS 字符串 `<` 比较的是 UTF-16 码元，
对 ASCII 就是码点序，因此**直接用 `<` 即可**，不需要任何数值转换：

```ts
if (a.entry.id < b.entry.id) return -1;   // "10" < "9"，因为 '1'(49) < '9'(57)
```

**测试**：`#6 同优先级 "10" 排在 "9" 之前`。

### 2.5 为什么预算用 `continue` 而不是 `break`

题面只说"按优先级从高到低**处理**"，没说装不下怎么办。本项目默认：
**逐个尝试，装不下的跳过、继续试后面的小条目** —— 这才是"处理顺序"有意义的原因（先处理的先占预算）。
`break` 会让一个大条目把后面所有小条目一起害死。

**测试**：`#10b 大条目超预算被跳过、后面的小条目仍被插入`。
**并且不静默截断**：超预算会在 `worldbook` 部分末尾追加"（世界书预算已满，共 N 条未插入）"，
同时在 `skipped` 里逐条给出 `budget_exceeded`。

### 2.6 为什么把"消息级原因"和"条目级原因"放在同一张表里

检查视图第 4 问要回答的是"**某条内容为什么没发送**"，而"内容"既可能是世界书条目，也可能是某条消息。
于是 `SkippedEntry` 用判别字段 `source: 'entry' | 'message'` 分区，**判据是 reason 的固定归属**：

- `source: 'message'` ⇒ `out_of_scan_depth` / `message_excluded` / `message_incomplete`
- `source: 'entry'` ⇒ `disabled` / `no_keyword_match` / `empty_content` / `budget_exceeded` / `duplicate_id`

**为什么不用"entryId 是不是某个消息 id"来判断**：那是隐式约定，改一处实现就会静默失效；
显式判别字段是能被单测锁住的。

**`out_of_scan_depth` 的产出通路**：`scanDepth` 把更早的合格历史截断在外时，
为**每一条被截断的合格消息**产出一条 `{ reason: 'out_of_scan_depth', source: 'message' }`。

### 2.7 不做的事（题面明确排除，主动说）

二级关键词（secondary keys）及其四种逻辑、概率触发、sticky/cooldown/delay 定时效果、
分组互斥（inclusion group）、正则关键词、整词匹配、向量检索、**递归扫描世界书正文**、
**扫描角色描述 / persona / 提示词模块**。

- 关键词语义固定为：**大小写不敏感 + 子串包含**；`key` 先 `trim()`，**空字符串视为无效**。
- **测试**：`不扫描世界书正文（A 的关键词只出现在 B 的正文里 → A 不激活）`。

## ③ 可能被追问的问题

**Q1：为什么扫描集要过滤掉 `excluded` 和未完成的消息？隐藏的消息呢？**
参与装配与参与扫描的标准是**同一套**：`excluded === false && status === 'complete'`。
`uiHidden` **不参与**任何过滤 —— 题面原话"隐藏显示不改变发给 AI 的内容"，
所以隐藏的消息照样能被关键词命中。未完成的回复（`streaming` / `interrupted`）也不进扫描集，
否则一条被刷新打断的半截回复会莫名激活世界书。

**Q2：常驻条目还要不要看关键词？禁用的常驻条目算不算？**
不需要。规则 3 是两条并列：**已启用的常驻条目直接成为候选**（不看关键词，`reason: 'constant'`）；
**禁用条目始终排除**。所以判断顺序是 `!enabled` → `constant` → `keys.length === 0` → 匹配 ——
"禁用"的优先级最高，能压过"常驻"和"关键词命中"。（测试 `#3` `#4`）

**Q3：同一条目在 3 条消息里都命中，会不会插入 3 次？**
不会。候选是按 `entry.id` 去重的：一条目最多一个候选（测试 `#5`）。
去重发生在步骤 3、排序在步骤 4 —— 顺序不能换，否则"同 id 两条不同 priority"时会选错保留哪条。

**Q4：重复 id 为什么记 `duplicate_id`？PLAN 里没这个枚举值。**
PLAN §4.10 与 §11 都要求"被丢弃的重复条目**必须记入 skipped**，不得静默丢"，但 §3 的 `SkipReason`
没有对应取值。补一个取值是最小改动（写在 `docs/notes-plan-conflicts.md` §1），
另一条路是静默丢弃，那就直接违反 PLAN。

**Q5：`budgetTokens` 怎么算？超预算算什么"未发送原因"？**
`budgetTokens = floor(contextLimit * worldBookBudgetPct / 100)`（默认 32768 × 25% = 8192）。
超预算的条目进 `skipped`、`reason: 'budget_exceeded'`，**且绝不进 `activated`**。
另外预算是**本项目自引入**的机制，题面规则 5 没提预算 —— `worldBookBudgetPct = 100` 即关闭。

**Q6：scanDepth 传 0 / -5 / 999 会怎样？**
`clampScanDepth()` 钳到 **1–100**，非有限值（NaN）→ 1。**绝不静默按 0 条扫描**：
0 条扫描会让所有关键词条目都"没命中"，这是最难查的一类 bug。

**Q7：为什么 `estimate` 是注入进来的参数，而不是直接 import？**
为了让这一层保持"纯粹的计算"，不绑死 token 估算的实现：单测可以注入固定函数验证预算逻辑，
UI 侧则传入统一的 `estimate()`（`core/tokens.ts`）。这也让"预算"和"估算口径"能各自独立演进。
