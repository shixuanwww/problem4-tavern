# 模块 05 · `<tavern-panel>` 解析与渲染

> 源码：`src/core/panel.ts`（纯函数）+ `src/ui/PanelRenderer.tsx`（渲染）
> 测试：`tests/panel.test.ts`（8 个用例）· 题面位置：等级 3「把消息里的简单标签显示成小界面」

## ① 这段在干什么

把消息正文里形如

```
saber 正在破坏圣杯

<tavern-panel type="status">
{"hp":10,"令咒":3,"location":"柳洞寺"}
</tavern-panel>

<tavern-panel type="choices">
{"options":[{"label":"发动令咒","text":"saber自裁吧"}]}
</tavern-panel>
```

的标签切出来，变成 `segments`：**普通文本 / 状态卡 / 选项按钮 / 错误块** 交替的序列。
`status` 渲染成状态卡片，`choices` 渲染成按钮（点了把文字填进输入框），**坏掉的标签渲染成"原文 + 问题说明"**。

## ② 关键设计决策 + 为什么

### 2.1 解析发生在**渲染时**，存储层永远存原文

- `Message.content` 存的是**含标签的原始正文**，一个字都不清洗；
- `MessageBubble` 渲染时才 `parsePanels(message.content)`。

为什么：这样"编辑消息"看到的是原文（能改坏 JSON、能补回闭合标签），
渲染器的任何 bug 都不会污染数据。反过来说，**渲染失败 ≠ 数据损坏**。

### 2.2 三类失败都必须**保留原文**（题面硬要求）

题面原话："**如果 JSON 不合法、标签没有闭合，或使用了应用不支持的类型，应保留原文，并提示具体问题，不能直接丢掉这段内容。**"

实现上，`error` 分支一律带上 `raw = 完整标签文本`：

| 情况 | `problem` | `raw` |
|---|---|---|
| JSON 语法错误 | `JSON 无法解析：<V8 的错误信息>` | 完整标签（含 `<tavern-panel …>` 与 `</tavern-panel>`） |
| JSON 顶层不是对象 | `JSON 顶层必须是对象（形如 {"hp":10,…}）` | 同上 |
| `choices` 缺 `options` | `缺少 options 数组` | 同上 |
| `options[i].label/text` 非字符串 | `options[0] 的 label / text 必须是字符串` | 同上 |
| `type` 不认识 | `不支持的 type：「inventory」（本项目仅支持 status / choices）` | 同上，并记下 `panelType` |
| 标签未闭合 | `标签未闭合（有 <tavern-panel> 但没有对应的 </tavern-panel>）` | **从开标签到文本结尾的全部内容** |

`PanelRenderer` 用 `<details><summary>无法解析这段面板：…</summary><pre>{raw}</pre></details>`
展示 —— **折叠**而不是塞满屏幕，但内容一个字符不少。

**注意"未闭合"那一条**：正则 `BLOCK_RE` 只能匹配成对的标签，所以实现是
"先跑完所有成对块，剩余尾巴里若还出现 `<tavern-panel`，整段尾巴作为 error"。
这样**未闭合标签之后的文字也不会丢**（测试 `#12` 专门验了这句）。

### 2.3 不用 `dangerouslySetInnerHTML`

LLM 的输出是不可信输入。整个渲染链走 React 的**数据渲染**（`{segment.text}` 作为子节点，
React 会转义），`raw` 也是放进 `<pre>{block.raw}</pre>`。
**不用** `dangerouslySetInnerHTML`，避免模型输出里的 `<script>` / `<img onerror>` 被当代码执行。

### 2.4 状态栏**不写死字段名**（题面：字段名和内容可以自行设计）

```tsx
const entries = Object.entries(block.data);   // 遍历键值对，不查表
<dt>{key}</dt><dd>{hp !== null ? <进度条/> : formatValue(value)}</dd>
```

- 未知键 → 通用键值渲染；对象/数组 → `JSON.stringify` 兜底；
- 只对**常见键**做样式增强：`hp`（大小写不敏感）走进度条。
- 所以 `{"hp":72,"令咒":2,"location":"柳洞寺·山门","装扮":"深蓝斗篷（完好）"}`
  里的 `装扮` 也能正常显示 —— 用例见 `samples/sample-message-with-panels.md` §2。

### 2.5 点选项 → 填进**这条消息所属会话**的输入框，**不自动发送**

`ChatView.handleChoose` → `App.handleChoose(targetSessionId, text)`：

```ts
if (targetSessionId !== sessionId) actions.activateSession(targetSessionId); // 先切回去
setDrafts(prev => ({ ...prev, [targetSessionId]: text }));                   // 按会话存草稿
requestAnimationFrame(() => composer.focus());
```

两个要点：
1. **草稿是按 sessionId 存的**（`drafts: Record<string, string>`），所以"填进哪条消息的会话"是精确的；
2. 用户可能已经切到别的会话，此时**先切回去**，否则就会"默默填到一个看不见的输入框里"。
   题面原话："由用户决定是否发送" —— 实现上**没有**任何自动发送路径。

## ③ 可能被追问的问题

**Q1：正则能处理标签跨行 / 属性用单引号 / 属性顺序颠倒吗？**
能。`BLOCK_RE = /<tavern-panel\b([^>]*?)>([\s\S]*?)<\/tavern-panel\s*>/g`：
`[\s\S]*?` 允许内容跨行（非贪婪），`([^>]*?)` 抓全部属性；
`readAttr` 用 `type\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))` 同时接受双引号、单引号、无引号。
测试里这三条都覆盖了。

**Q2：如果一条消息里有 3 个状态面板呢？**
都会渲染成状态卡。`parsePanels` 是全局 `g` 匹配的循环，`segments` 是一个交替序列，
`MessageBubble` 按 `segments.map` 顺序渲染（`key` 用 `t-${i}` / `p-${i}` 区分文本与面板）。

**Q3：`JSON.parse` 报的错能直接给用户看吗？**
可以但要包装。直接给用户看的是"无法解析" + V8 的原始消息（如 `Unexpected token } in JSON at position 8`），
外面套了中文说明。**能给出更精确的位置更好**——角色卡 JSON 那条路（模块 07）就额外把
`position N` 换算成了**行列号**；面板这条路因为内容短、且就在消息里肉眼可见，没有重复做。

**Q4：为什么错误块是折叠的，而不是直接铺开？**
因为一条 AI 回复里坏掉的面板可能很长（尤其标签未闭合时 `raw` 会包含之后的整段文字）。
折叠能保证**不丢失**，同时不把聊天流冲垮。summary 里已经写了具体问题，
用户想深究再展开看原文。

**Q5：解析失败会不会影响这条消息进入上下文？**
不会。存储的 `content` 是原文，装配时直接把原文发出去（**发给模型的就是带标签的原文**）。
渲染失败只影响"你看到的样子"，不影响"AI 收到的内容"——再次回到"渲染是壳、数据是内核"。

**Q6：为什么 `status` 的数据是 `Record<string, unknown>` 而不是更严格的类型？**
因为题面明确"**字段名称和内容可以自行设计**"。写死 schema 会让"角色卡作者自己定的字段"被拒。
放宽到任意键值对 + 显示层做格式化，是唯一能同时满足"可自定义"和"显示结果与消息中的数据一致"的做法。
