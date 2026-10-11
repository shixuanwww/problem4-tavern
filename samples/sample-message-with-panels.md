# 题面示例消息 + 几组「故意坏掉」的面板

> 本文件是**样例数据**的一部分：把下面任意一段粘进输入框（或作为 AI 回复内容编辑进去），
> 就能看到 `PanelRenderer` 的实际效果。存储层永远保存**原始正文（含标签）**，解析只发生在渲染时。

---

## 1. 题面原文示例（正常情况）

```text
saber 正在破坏圣杯

<tavern-panel type="status">
{"hp":10,"令咒":3,"location":"柳洞寺"}
</tavern-panel>

<tavern-panel type="choices">
{"options":[{"label":"发动令咒","text":"saber自裁吧"}]}
</tavern-panel>
```

**预期渲染**：一段普通正文 →「状态」卡片（hp / 令咒 / location 三个键值，hp 走进度条增强）
→「可选行动」按钮「发动令咒」。点按钮后，`saber自裁吧` 被填进**这条消息所属会话**的输入框，
**不会自动发送**。

---

## 2. 字段名由自己约定（验证"状态栏不写死字段名"）

```text
夜雾漫上石阶。

<tavern-panel type="status">
{"hp":72,"令咒":2,"location":"柳洞寺·山门","装扮":"深蓝斗篷（完好）","状态":["中毒","被追踪"]}
</tavern-panel>

<tavern-panel type="choices">
{"options":[
  {"label":"推门进去","text":"我推开寺门，走进去。"},
  {"label":"先在门外观察","text":"我贴着门缝往里看。"},
  {"label":"先给自己包扎","text":"我先处理一下伤口再进去。"}
]}
</tavern-panel>
```

**预期渲染**：通用键值遍历 —— 未知键（`装扮` / `状态`）走通用渲染，
数组值会用 `JSON.stringify` 展开；hp 仍走进度条。**证明字段名没有硬编码。**

---

## 3. 故意坏掉的情况（验证"渲染失败不丢内容"）

### 3.1 JSON 非法（尾逗号）

```text
<tavern-panel type="status">
{"hp":10,}
</tavern-panel>
```

预期：灰色折叠块「无法解析这段面板：JSON 无法解析：…」，展开后能看到**原始标签全文**。

### 3.2 标签未闭合

```text
<tavern-panel type="status">{"hp":1}
这句在标签后面，不能丢。
```

预期：整段（含"这句在标签后面"）作为错误块保留，problem 提示"标签未闭合"。

### 3.3 不支持的 type

```text
<tavern-panel type="inventory">
{"items":["剑","书"]}
</tavern-panel>
```

预期：提示"不支持的 type：「inventory」"，并保留原文。

### 3.4 choices 结构不对

```text
<tavern-panel type="choices">
{"options":[{"label":1,"text":"x"}]}
</tavern-panel>
```

预期：提示 `options[0] 的 label / text 必须是字符串`，保留原文。

---

## 4. 对应的结构化样例

- 完整会话（含上述消息 + 世界书 + 一张请求快照）：`sample-session.json`
- 带内嵌世界书的角色卡：`sample-character-v2.json`
- 提示词预设（含 `{{}}` 模板模块）：`sample-preset.json`

**导入方式**：`sample-session.json` → 左侧「导入会话」（同 ID 时会弹「覆盖 / 创建副本 / 取消」）；
`sample-preset.json` → 「预设」面板 → 导入预设 JSON；
`sample-character-v2.json` → 「角色卡」面板 → 选择文件。
