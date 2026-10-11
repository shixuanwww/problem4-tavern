# 模块 08 · 存储层（IndexedDB 薄封装 + repo）

> 源码：`src/storage/idb.ts`（~110 行）+ `src/storage/repo.ts`
> 题面位置：§2 范围与技术要求"**会话与资源必须保存在浏览器本地，刷新后能够恢复。采用 IndexedDB 或其他方案均可。**"

## ① 这段在干什么

- `idb.ts`：把手写的 `indexedDB.open` / 事务 / 请求回调包成 Promise，对外只暴露
  `idbGet / idbGetAll / idbGetBySession / idbPut / idbBulkPut / idbDelete / idbDeleteMany`。
- `repo.ts`：业务级读写（会话 / 消息 / 世界书 / 预设 / 角色卡 / 快照 / 设置）+ **级联删除规则** +
  会话导出导入。

## ② 关键设计决策 + 为什么

### 2.1 为什么自己写而不是用 `idb` / `dexie`

题面允许任何方案，但本项目**只用 `react` + `react-dom`**（PLAN §2.2 的依赖上限）。
自写的这部分只有约 110 行，而且答辩时能讲清每一行；引入一个库反而多一个要解释的东西。

### 2.2 🔴 所有写入都必须 **await 事务完成** 再更新内存

```ts
export async function idbPut<T>(store, value) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);            // ← 等 oncomplete / onerror / onabort
}
```

如果不等事务完成就 `dispatch` 更新内存，就会出现最难查的一类 bug：
**界面显示已经保存，刷新后数据没了**（尤其是用户存完立刻刷新）。
`txDone()` 同时挂 `oncomplete` / `onerror` / `onabort`，保证失败也能冒泡成 Promise rejection。

### 2.3 store 与索引的划分

| store | keyPath | 索引 | 说明 |
|---|---|---|---|
| `sessions` | `id` | — | |
| `messages` | `id` | **`bySession` → `sessionId`** | 按会话取消息，不扫全表 |
| `worldbooks` | `id` | — | |
| `presets` | `id` | — | |
| `characters` | `id` | — | |
| `snapshots` | `id` | **`bySession` → `sessionId`** | 历史快照按会话查 |
| `settings` | `id` | — | 单条记录，固定 `id: 'app'` |

**为什么 messages 不按会话拆成多个 store**：IndexedDB 的 store 是 schema 级概念，
不能按数据动态创建。用一条索引就够了，而且删会话时的批量删除更简单。

### 2.4 刷新后恢复：`loadAll()` + `repairInterrupted()`

启动流程（`store.tsx` 的 `useEffect`）：

```
1. repairInterrupted()   —— 把所有 status==='streaming' 的消息改成 'interrupted'（保留已收到的文本）
2. loadAll()             —— 一次性把 7 个 store 读进内存镜像
3. ensureDefaultCharacter()
4. hydrate               —— dispatch 进 reducer
5. fetchDefaults()       —— 从 /llm/defaults 取回 baseUrl / model 预填设置面板（不含 key）
```

第 1 步是等级 1 的硬要求（"**刷新打断的生成应标为中断，不能永远停在'生成中'**"）：
浏览器刷新会把正在跑的 `fetch` 流掐断，但库里那条消息还是 `streaming`。
启动时统一改成 `interrupted` —— 保留已经流式收到的部分，并且在装配时被排除
（未完成的消息不进上下文，见模块 02）。

> 追问预判：为什么能"保留已收到的部分"？因为流式期间**节流写库**
> （≥500ms 或累计 200 字符写一次，见模块 09），所以刷新时库里已经有最近一次的中间状态。

### 2.5 级联删除（题面只要求 CRUD，这里补齐，不留悬空引用）

| 删除对象 | 连带处理 |
|---|---|
| **会话** | `deleteSessionCascade()`：级联删该会话的 `messages` 与 `snapshots`，再删会话本身 |
| **世界书** | `deleteWorldBookCascade()`：删书 + 把 `session.worldBookIds` 里的引用摘掉（返回被改动的会话，供 dispatch） |
| **预设** | 只删 `presets` 记录；已绑定会话的 `settings` 是独立副本，不受影响 |
| **单条消息** | 只删这一条；**快照不动**（快照是历史记录） |

**为什么"删世界书要反过来找会话"**：引用方向是 `session.worldBookIds → worldbook.id`，
删被引用者时必须反向清扫，否则会话里会留下指向不存在世界书的 id
（症状：预览里世界上少一块内容，但看不出为什么）。

### 2.6 会话导出 / 导入：同 ID 冲突的三选一 + **固定处理顺序**

导出格式：

```json
{ "format": "tavern-lite-session", "formatVersion": "1.0",
  "session": {...}, "messages": [...], "snapshots": [...],
  "characterCard": {...}, "worldBooks": [...] }
```

导入时 `checkBundle()` 校验 `format` / `formatVersion` / 必需字段，并检测**同 ID 冲突**。
题面原话是"与**已有资源**同 ID 时"，所以冲突检测覆盖**会话 / 消息 / 快照 / 世界书 / 角色卡**五类
（只看会话 ID 会漏掉"角色卡或世界书被静默替换"）。命中时 UI 弹**三选一**：
「覆盖」/「创建副本」/「取消」，并把命中的资源逐项列出来（题面原话"明确区分覆盖与创建副本"）。
`checkBundle(raw, existingSessionIds, existing?)` 的第三个参数是**可选**的，旧调用方式行为不变。

🔴 **`persistImport()` 的固定三步**（PLAN §4.7/§11 硬规定）：

```
① 先给所有资源分配新 ID（copy 模式），建一张 idMap
② 用同一张 idMap 一次性重写所有引用：
   session.id / session.characterCardId / session.worldBookIds
   messages[].id / messages[].sessionId
   snapshots[].id / snapshots[].sessionId
   characterCard.id / worldBooks[].id / worldBooks[].entries[].id
③ 最后才写库（一个 Promise.all 批量落库）
```

**为什么顺序不能反**：如果先把被引用资源写进去、再补引用，中途失败就会留下**悬空 ID**；
先建映射、再一次性重写、最后落库，则"要么整体是新的一致状态，要么什么都没发生"。
副本模式的标题加后缀 `（副本 2）`，序号递增（`copyTitle()` 会避开已存在的标题）。

🔴 **覆盖模式 = 整体替换，不是"往上叠"**：写库前会先按 `sessionId` 删掉本地旧的消息与快照。
不这么做的话，"用一个 2 条消息的包覆盖本地 8 条消息的会话"会变成 10 条混在一起 ——
那不叫覆盖。内存层对应 `session/replace` 动作（`session/upsert` 只会合并、删不掉旧消息）。

## ③ 可能被追问的问题

**Q1：为什么不用 `localStorage`？**
`localStorage` 只能存字符串、容量约 5MB、且**同步阻塞主线程**。
题面要存的是"会话 + 消息 + 快照 + 世界书 + 角色卡"，随着聊天变长轻松超过 5MB。
IndexedDB 是异步的、容量按配额给、原生支持索引，是这类数据结构的正解。

**Q2：多个标签页同时开着会怎样？**
**不会互相同步**（没有 BroadcastChannel / Web Locks，这属于题面等级 4 的可选项，未实现）。
两个标签页各自持有内存镜像，后写的覆盖先写的。`openDb()` 里对 `onblocked` 做了拒绝处理，
在"需要升级 DB 版本而有旧标签页占用"时给出明确错误，而不是静默卡住。
这一点在 README 的「未实现」里如实写了。

**Q3：`settings` store 只有一条记录，为什么不放 `localStorage`？**
统一。所有持久化都走同一套 `idb*` API 与同一个 DB 连接，
少一套心智模型、少一处"忘记处理异步"的机会。而且 key 在里面放得下（没有 5MB 问题）。

**Q4：导出文件里会不会带 API Key？**
不会。导出的是 `session / messages / snapshots / characterCard / worldBooks`，
**`settings`（含 `apiKey`）根本不在导出范围**。这条是刻意的，避免"分享会话 = 泄漏 key"。

**Q5：`idMap` 里为什么要给快照 id 也重新分配？**
因为 `messages[].requestId` 指向快照。副本模式下消息换了新 id，如果不换快照 id 而
`requestId` 又指向旧快照 id，就会**串到原会话的快照**上去。一起重映射才能保持两张表的对应关系。

**Q6：`repairInterrupted()` 会不会误伤"此刻正在生成的那条"？**
不会，因为它只在**应用启动时**跑一次（`useEffect` 空依赖）。
此刻正在生成的流程是活的，不会经过启动路径。
如果用户在生成中途刷新，那就应当被判为中断 —— 正是我们要的行为。
