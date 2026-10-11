# 模块 12：等级 1 的四条"必须正确处理"与它们的可测化

**代码**：`src/core/messaging.ts`（判定）＋ `src/state/store.tsx` / `src/storage/repo.ts`（副作用）
**测试**：`tests/l1-behaviors.test.ts`（27 条）

## 1. 这段在干什么

题面【等级 1】里唯一点名的四条"必须正确处理"，是本项目**最容易被追问、也最容易讲不清**的地方：

| # | 题面原话 | 判定落在哪 | 副作用落在哪 |
|---|---|---|---|
| ① | 重试不重复插入同一条用户消息 | `planRetry()` | `store.retryLast` → `repo.deleteMessages` |
| ② | 未完成的助手回复默认不进后续上下文 | `assembly.buildRequest` | —（已有 `#7` 覆盖） |
| ③ | 生成中切换会话，后续结果仍属于发起请求的会话 | `actions.reducer`（`generating` 分桶） | `store.runGeneration` 闭包捕获 `sessionId` |
| ④ | 刷新打断的生成应标为中断，不能永远停在"生成中" | `finalStreamStatus()` / `repairStreamingMessages()` | `repo.repairInterrupted`（启动时） |

## 2. 关键设计决策 + 为什么

| 决策 | 为什么 |
|---|---|
| 🔴 **把"纯判定"从 React / IndexedDB 里抽出来**（`core/messaging.ts`） | ①③④ 原先只写在 `store.tsx`（依赖 React hooks）与 `repo.ts`（依赖 `indexedDB` 全局）的函数体里 —— `node --test` **一条也碰不到**。抽出来之后，判定可以被单测直接喂输入断言，`store`/`repo` 只剩"落库 + dispatch"。这是"能讲清"与"只能手演"的区别 |
| 🔴 重试**只删锚点之后的 assistant**，锚点本身不删也不重建（`planRetry` 把锚点排除在 `dropIds` 之外） | 如果重试走"再插一条 user 消息"，同一条用户输入就会出现两次（一次在 `history`、一次在 `pending`），既污染上下文又让 seq 重号。测试直接断言**重试前后 user 消息恒为 1 条、seq 为 `[1,2,3]` 不跳号不重号** |
| 🔴 `generating` 是 `Record<sessionId, messageId>`，**按会话分桶** | 用一个全局 `generatingId` 的写法，在"生成中切会话"时会把停止按钮挂到错误的会话上。分桶之后：s1 收尾只清 s1 的桶，s2 的生成状态不受影响（有专门用例） |
| 🔴 流式增量按 `message.id` 追加（`message/append`），而消息自带 `sessionId` | 于是"切会话"这个动作**不参与**结果归属 —— 归属由消息自己的 `sessionId` 决定，与当前激活哪个会话无关。这是"后续结果仍属于发起请求的会话"最省事也最难写错的实现 |
| 🔴 收尾状态只有 `complete` / `interrupted` 两条路（`finalStreamStatus`） | 只有 `finished && !aborted` 才算 `complete`：读到流尾但内容被刷新打断、用户点停止、网络在读流中途断掉，**全都**落进 `interrupted`。不存在"第三条路"，所以消息不可能永远停在 `streaming` |
| 启动修复是 `{...m, status:'interrupted'}` 而不是删记录 | 已经收到的半句必须留住（用户可能想复制它），只改状态不动正文 |
| SSE 解析保留 `buffer`，只处理**完整行**（`createSseDecoder`） | 一个 `data: {...}` 行完全可能被切在两个网络分块之间；按块直接 `JSON.parse` 会**偶发丢字**（而且"看起来能跑"）。测试里专门有一条"一行切两半 + 一次只喂 1 个字符"的用例 |

## 3. 可能被追问的问题

**Q：你凭什么说"重试不会重复插入同一条用户消息"？**
A：`planRetry()`（`core/messaging.ts:39`）把要丢弃的消息限定为"锚点之后"，锚点自身既不在 `dropIds` 里也不会被重建；
`tests/l1-behaviors.test.ts` 里那条用例把 store 的真实链路（删除尾部 → 用锚点的 `content`/`seq` 发起生成 → 新 assistant 分到 `seq+1`）完整模拟了一遍，
断言**user 消息恒为 1 条、seq 为 `[1,2,3]`**。这不是"我读了代码觉得对"，是可复跑的断言。

**Q：生成中切会话，为什么结果不会串到别的会话？**
A：`message/append`（`state/actions.ts:126`）按 `message.id` 定位、只改 `content`；
消息对象自带的 `sessionId`（在 `runGeneration` 里创建时就写死为发起请求的会话）从头到尾没被改过。
`runGeneration` 还在闭包里深拷贝了 `settings` 与 `session`，所以"生成期间改设置"也只影响下一次请求。
用例同时断言了 `activeSessionId` 仍是用户切过去的那一个（切会话不该把用户拽回来）。

**Q：刷新之后怎么就不是"永远生成中"了？**
A：两道保险。① 写入时：assistant 消息**先以 `status:'streaming'` 落库**，流式期间按 ≥500ms 或 200 字符节流写库，
收尾时用 `finalStreamStatus()` 写终态；② 启动时：`repo.repairInterrupted()` 把库里**任何**还停在 `streaming` 的记录标成 `interrupted`
（保留已收到的正文）。所以"刷新打断"最坏情况是丢最后不到 500ms 的增量，状态一定是 `interrupted`。

**Q：这些测试为什么以前没有？**
A：因为它们要断言的判定原先长在 React 组件与 IndexedDB 调用中间 —— 那两层在 `node --test` 里跑不起来
（项目刻意不引 `vitest` / `fake-indexeddb`，见 `handoff` 的依赖上限）。把判定抽成纯函数之后才补得上。
`core/messaging.ts` 是**纯增量**模块：`store` / `repo` 的行为逐行等价，只是把 if/else 换成了函数调用。

**Q：你怎么证明流式真的是"逐步"到达，而不是等整段返回？**
A：三条证据。① `core/llm.ts` 的 `createSseDecoder` 是**增量式**的：每读到一个网络分块就立刻派发其中的完整 `data:` 行；
② 受控用例把 SSE 切在最恶劣的位置（一行中间）断言 3 段增量逐个派发且内容不丢；
③ 本机实测：`scripts/static-proxy.mjs` + 真实公益站，`reader.read()` 3–4 次 / `onDelta` 3 次、正文拼回正确，
响应头带 `x-accel-buffering: no`（Node 侧不缓冲）。
⚠️ 诚实边界：上游网关**偶尔**会把整段回复合并成一个 HTTP 分块（实测出现过一次），那种情况下"逐步"受限于上游，不是前端能决定的 —— 这一点当场可以复现给对方看。
