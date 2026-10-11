# 模块 09 · 状态管理、流式生成与等级 1 的四个边界

> 源码：`src/state/actions.ts`（reducer）+ `src/state/store.tsx`（Provider / 异步动作）+ `src/ui/ChatView.tsx`
> 题面位置：等级 1「需要正确处理以下情况」（四条）

## ① 这段在干什么

- **内存镜像 + 纯 reducer**：React 只读 `state`，所有写操作先落 IndexedDB、成功后再 `dispatch`。
- **一次性把等级 1 的四条边界做到位**：

| 题面要求 | 本项目的做法 |
|---|---|
| 重试不重复插入同一条用户消息 | `retryLast()` 找到最后一条 user，只重跑它后面的生成；**那条 user 消息的 `id` / `seq` 一个都不动** |
| 未完成的助手回复默认不进入后续上下文 | 装配与扫描集统一按 `status === 'complete'` 过滤（模块 02 / 01） |
| 生成中切换会话，后续结果仍属于发起请求的会话 | 请求发出时把 `sessionId` **闭包固定**，流式回调只按 `assistant.id` 追加内容 |
| 刷新打断的生成应标为中断 | 启动时 `repairInterrupted()` 把 `streaming` → `interrupted`（模块 08） |

## ② 关键设计决策 + 为什么

### 2.1 为什么"先落库、后 dispatch"

```ts
await repo.saveMessage(userMessage);
dispatch({ type: 'message/upsert', messages: [userMessage] });
```

反过来（先 dispatch）会让界面领先于磁盘。用户在这个缝隙里刷新 → 消息消失。
本地应用没有网络延迟，"等一下磁盘"的成本几乎为零，所以统一采用**磁盘优先**。

### 2.2 🔴 配置快照：闭包持有，绝不读"最新设置"

```ts
const config: AppSettings = { ...snap.settings };   // 深拷贝进本次请求
const sessionSnapshot = { ...session, settings: { ...session.settings } };
...
await streamChat({ settings: config, model: config.model, messages: partsToChat(built.parts) }, {...})
```

`streamChat` 的每次重试/回调都只读 `config`，**没有任何一处读 `stateRef.current.settings`**。
这就是题面"生成期间修改设置，也只能影响下一次请求"的实现方式。
同理，`buildRequest` 收的是 `sessionSnapshot`（本次会话设置的副本），
生成期间用户改 `scanDepth` 也不会让本次请求"重新算一遍"。

### 2.3 生成中切换会话：结果写回**发起它的**会话

```ts
const runGeneration = async (sessionId, pendingText, pendingSeq, extraMessages) => { ... }
```

`sessionId` 是**参数**，被闭包捕获。流的 `onDelta` 做的是
`dispatch({ type: 'message/append', id: assistant.id, chunk })` —— **按消息 id 追加**，
而消息本身就带 `sessionId`。所以：

- 用户切到别的会话：`ChatView` 渲染的是另一个 `sessionId` 的消息列表，看不到这次流；
- 切回来：内容已经在那里（并且已经按节流写进库）；
- 全程**没有**"根据当前激活会话决定往哪写"的代码，从结构上避免串写。

### 2.4 流式写库的节流（≥500ms 或累计 200 字符）

```ts
const FLUSH_INTERVAL_MS = 500;
const FLUSH_CHARS = 200;
if (now - lastFlushAt >= FLUSH_INTERVAL_MS || acc.length - lastFlushLen >= FLUSH_CHARS) {
  lastFlushAt = now; lastFlushLen = acc.length;
  void flush('streaming');       // repo.saveMessage({...assistant, content: acc, status: 'streaming'})
}
```

**为什么必须节流而不能每个 chunk 都写**：一个长回复可能有几百个 SSE chunk，
每个都开一次 IndexedDB 事务会把主线程压垮（也会写爆写放大）。
也不能"等结束才写"——那样中途刷新就丢掉全部已收到的文本，`repairInterrupted()` 也就无从保留。
**500ms / 200 字符**是"刷新后丢字可接受"与"写放大可接受"之间的折中（PLAN §11 定的值，可调）。

收尾时**无条件再写一次**最终内容与终态（`complete` / `interrupted`），保证落库的一定是终稿。

### 2.5 重试的实现（`retryLast`）

```
1. 找到会话里最后一条 role === 'user' 的消息（它就是"这次要重新问的问题"）
2. 删掉它后面的一切（通常是那条要重生成的 assistant 回复）—— 真删，因为要被替换
3. runGeneration(sessionId, lastUser.content, lastUser.seq, [])
   ⇒ 装配时按 seq === pendingSeq 把它排进 pending，且【不再插入新的 user 消息】
```

题面原话"**重试不重复插入同一条用户消息**"——这里 `lastUser` 的 `id` 与 `seq` 自始至终没变过，
只是把它的正文重新当作 pending 发一次。生成出来的新 assistant 消息才拿新的 `id` 与新 `seq`。

### 2.6 reducer 的写法与取舍

- 所有集合操作都走 `upsertById`（Map 覆盖），所以同一个 action 重复派发是幂等的；
- 会话按 `updatedAt` 倒序（`sortSessions`），最近用的在最上面；
- `generating: Record<sessionId, messageId>` 与 `errors: Record<sessionId, string>` 是**瞬时 UI 状态**，
  不落库。这样"生成中"不会因为刷新而永久残留（刷新后由 `repairInterrupted` 从数据层修正）。

**为什么把消息放在一个平铺数组里**：本地单用户应用的量级（万级消息）下，
`filter(m => m.sessionId === id)` 比维护 `Record<sessionId, Message[]>` 的增删改一致性更省心，
也避免了"同一消息在两个结构里不同步"的经典 bug。这是个**刻意的、可解释的性能取舍**。

### 2.7 错误处理：不白屏，给可操作的错误卡

`streamChat` 把三类失败都转成 `onError(message)`，从不向上抛：

- 网络异常 → "网络请求失败：… 请确认 dev server 正在运行（模型请求走同源 /llm 代理）"
- 非 2xx → `模型接口返回 401 Unauthorized：{上游响应体前 500 字}`
- 读取流失败 → "读取流式响应失败：…"

UI 在聊天区顶部渲染 `.error-banner`（`role="alert"`），并给一个**「打开模型设置」**按钮。
**永远不会白屏**，而且用户下一步该做什么是明确的。

## ③ 可能被追问的问题

**Q1：`sendMessage` 里为什么把 `userMessage` 又塞进 `runGeneration` 的 `extraMessages`？**
因为 `dispatch` 之后 React 的重渲染是异步的，`stateRef.current` 可能还没包含这条新消息
（`runGeneration` 紧跟着同步读 `stateRef.current`）。
`extraMessages` 保证装配时一定能看到它；而装配本身按 `seq === pendingSeq` 排除重复，
所以**即使它同时出现在 `snap.messages` 里也不会重复出现**（测试 `#16` 覆盖了这一点）。
`retryLast` 传的是 `[]`，因为被重试的 user 消息早就在库里了。

**Q2：为什么用 `useReducer` + `Context` 而不用 Redux / Zustand？**
状态树不复杂（7 类资源 + 几个 UI 标志），reducer 是纯函数、可单测、可预测；
引入状态库要额外解释"为什么需要它"，而 PLAN §2.2 明确要求**不引入**。
这里真正的难点不在状态库，而在**异步边界的正确性**（配置快照、会话绑定、节流），
这些用任何库都得自己写对。

**Q3：`useRef` 存 `stateRef.current = state` 会不会有竞态？**
这是在渲染期直接赋值（不是 `useEffect`），所以每次 render 之后 ref 都指向最新的 state。
异步动作读的是"最近一次渲染的快照"，这对本应用的语义是**可接受的**：
所有关键数据（消息内容、设置）在写之前都已经 `await` 落库，
读到的旧值最多让"同一 tick 里的两次写"合并成一次后者胜出 —— 而 UI 交互本身就是串行的。

**Q4：生成期间用户点了「停止生成」会发生什么？**
`stopGeneration` 取出该会话的 `AbortController` 并 `abort()`。
`streamChat` 捕获到 `AbortError` 后**静默返回**（不报错）；收尾逻辑判定
`finished && !signal.aborted` 为假 → 消息被标成 `interrupted`，**保留已收到的部分**。
所以"停止"和"刷新打断"落到同一个终态 `interrupted`，语义一致。

**Q5：为什么 `errors` 用 `Record<sessionId, string>` 而不是挂在消息上？**
因为错误是**会话级**的、且是瞬时的：这次失败不代表那条消息有错，用户改完设置重试就会被覆盖。
挂在消息上会污染消息数据模型（消息里没有 error 字段，也不该有）。

**Q6：如果模型还没开始返回就失败了，那条空的 assistant 消息会留下吗？**
会留下，`content` 为空、`status='interrupted'`，并且**不进入后续上下文**（未完成）。
这样用户能"重试上一条"（`retryLast` 会把它连同位置删掉重生成），也不会出现"发出去了但什么都没有"的迷惑状态。
