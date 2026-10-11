# 模块 06 · 预设导入（提示词模块）

> 源码：`src/core/preset.ts`（纯函数）+ `src/core/template.ts` + `src/ui/PresetManager.tsx`
> 测试：`tests/preset.test.ts`（8 个用例）· 样例：`samples/sample-preset.json`
> 题面位置：等级 3「导入预设和角色卡」

## ① 这段在干什么

导入一个 JSON 预设 → 校验 → 落库 → 在「预设」面板里**编辑 / 启停 / 上下移动排序** →
立刻参与下一次请求编排。预设的核心是**一组提示词模块**（人设、风格、输出约定……）和**一组上下文参数**。

```json
{
  "format": "st-lite",
  "formatVersion": "1.0",
  "id": "preset-fate-demo",
  "name": "示例预设 · Fate RP",
  "modules": [
    { "id": "m-role", "name": "人设", "role": "system",
      "content": "你正在扮演 {{char}}。", "enabled": true,
      "order": 10, "position": "system", "template": true }
  ],
  "contextConfig": { "contextLimit": 32768, "scanDepth": 4,
                     "worldBookBudgetPct": 25, "contextWarnPct": 80 }
}
```

## ② 关键设计决策 + 为什么

### 2.1 🔴 "不修改业务代码即可使用" ⇒ 代码里**没有**任何模块名

题面硬要求："**新预设符合已有格式时，不修改业务代码即可使用。**"

因此渲染、启停、排序、参与编排**全部由 `modules` 数组驱动**：

- `PresetManager` 用 `[...preset.modules].sort((a,b)=>a.order-b.order).map(...)` 渲染 —— 有几条数据就渲染几个卡片；
- `assembly.ts` 用 `preset.modules.filter(m => m.enabled)` 决定谁参与；
- "添加模块"按钮生成的是一个**全新的空白模块**（`name: '新模块'`），而不是某个内置模板。

代码里**搜不到**"人设""越狱""风格约束"这类字面量 —— 它们只出现在样例 JSON 里。
（演示动作：现场把 `sample-preset.json` 里的模块改名/加一条，回头刷新即可用，**不碰代码**。）

### 2.2 模块的两个维度：`position` 与 `order`

- `position: 'system' | 'postHistory'` —— **插在哪**：系统提示区，还是历史消息之后。
  这是真实需求（"输出格式约定"通常要放在最近的位置，模型更听话）；
  装配顺序见模块 02：`preset-system` 在历史之前，`post-history` 在历史的**后面**。
- `order: number` —— **同一区域内的先后**，升序。同 order 时按 id 的 ASCII 升序（与 worldbook 同口径，
  保证确定性）。

### 2.3 模板 `{{变量}}`：替换在**发送前**，原样保留

`module.template === true` 时，`buildRequest` 会调 `expandTemplate(content, vars)`：

- 变量来源：`{ char: 角色卡名, ...session.variables }`（会话自定义变量表，见 `docs/notes-plan-conflicts.md` §3）；
- **缺失变量保留原样 `{{hp}}`** 并记进 `missing[]` —— 保留原样而不是替换成空串，
  因为"变成空串"会让提示词悄悄变形，"留着 `{{hp}}`"一眼就能看出漏了什么；
- 支持 `{{#if hp < 20}}...{{/if}}` 单层条件（`< > <= >= == !=`，数字优先、字符串兜底），
  **不支持嵌套 if / 表达式求值** —— 题面原话"无需完整实现 EJS"；
- UI 侧 `PresetManager` 对 `template: true` 的模块提供"**展开结果**"折叠区（同一函数、同一变量表），
  满足题面"保留原始模板，并让用户能看到展开结果"。

### 2.4 `contextConfig` 只作**初值**（会话设置优先）

题面没规定，PLAN §4.9/§11 拍板：**会话设置优先；导入预设只填初值**。
实现：绑定预设时把 `preset.contextConfig` 的四个字段**合并进 `SessionSettings` 一次**
（`store.attachPreset`），之后在「设置」里改的就是会话自己的值，不会再被预设覆盖。

为什么不让预设持续覆盖会话：用户在一个会话里把 `scanDepth` 从 4 调到 8，
是**针对这个会话**的调整；如果每次读都从预设取，用户的调整会被无声吞掉。

### 2.5 校验：错误要指出**字段路径 + 期望类型**

`parsePreset()` 返回 `{ ok: false, errors: string[] }`，每条都带路径：

- `字段 format 不匹配：期望 "st-lite"，实际 "other"`
- `不支持的 formatVersion：9.9（支持 1.0）`
- `字段 modules[0].order 类型错误：期望数字`
- `字段 modules[0].position 取值非法：期望 system / postHistory`

导入失败时 UI 用红框列出**全部**错误（不是只报第一条），用户一次改完。

## ③ 可能被追问的问题

**Q1：为什么不把模块做成 TypeScript 里的枚举/常量？**
那正是题面禁止的"修改业务代码才能用"。预设是**用户数据**，它的形状必须由**运行时数据**决定，
而不是由编译期类型决定。类型系统在这里只负责"校验输入合不合法"，不负责"有哪些模块"。

**Q2：`order` 用数字，两个人导入同一个预设会不会打架？**
不会。`order` 只在**同一个预设内部**比较，不跨预设。同 order 时按 `id` 的 ASCII 升序兜底，
所以即使两个模块 `order` 都是 10，渲染顺序也是确定的、可复现的。

**Q3：`template` 为什么是可选的？**
不是所有模块都该做变量替换。比如"输出约定"里可能**故意**出现 `{{` 字样（教模型用什么语法），
如果强行替换会被吃掉。默认为 `false`（不替换），要替换的模块显式打开。

**Q4：变量缺失时为什么不报错、只是保留原样？**
因为"模板里有变量但这次没有值"是**正常情况**（比如 `{{hp}}` 只在状态面板出现后才赋值）。
硬报错会让提示词根本发不出去。保留原样 + 在 UI 的"展开结果"里让人看到，
是"不打断流程、又不静默出错"的折中。测试 `#18` 锁住了这个行为。

**Q5：预设删除后，已经绑定它的会话会怎样？**
会话不受影响。预设的 `contextConfig` 已经写入会话设置（一次性），会话的 `settings` 是独立副本；
`store.removePreset` 只删 `presets` 记录。已在会话里的编排结果不变 —— 符合 PLAN §4.1
"删预设 → 已导入的会话保留其快照出的模块副本（不回溯失效）"的意图。
（注意：会话的 `presetId` 会变成悬空引用，此时装配取不到预设模块，只是少了一段提示词，
不会崩 —— `buildRequest` 对 `preset === undefined` 是有分支的。）

**Q6：能不能导入 SillyTavern 原生的预设格式？**
不能，也不打算做。本项目定义的是**自己的格式**（`format: "st-lite"`, `formatVersion: "1.0"`），
导入时严格校验 `format` / `formatVersion`，不匹配就明确报错。
理由：ST 原生预设耦合了大量本题不实现的运行规则（递归、概率、分组等），
强行兼容会变成"看起来支持、实际行为不一致"的假兼容 —— 不如**如实声明支持范围**。
