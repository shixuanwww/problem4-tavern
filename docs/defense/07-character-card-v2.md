# 模块 07 · 角色卡 V2 导入 / 导出

> 源码：`src/core/characterCard.ts`（纯函数）· `src/ui/CharacterCardImport.tsx`
> 测试：`tests/characterCard.test.ts`（10 个用例）· 样例：`samples/sample-character-v2.json`
> 题面位置：等级 3「支持 Character Card V2 JSON 的明确子集」

## ① 这段在干什么

读一张 Character Card V2 的 JSON（或 PNG），抽出**题面指定的四样东西** ——
**名称 / 描述 / 开场白 / 内嵌世界书** —— 转成本项目的数据模型；反过来导出时，
**以原始 JSON 为基底只写回被编辑过的可映射字段**，其余一律原样保留。

## ② 关键设计决策 + 为什么

### 2.1 字段映射表（UI 上原样展示，答辩可直接对着念）

| Character Card V2 | 本题模型 | 备注 |
|---|---|---|
| `spec` / `spec_version` | 校验用 | 须为 `chara_card_v2` / `2.x` |
| `data.name` | `CharacterCardLite.name` | |
| `data.description` | `.description` | |
| `data.first_mes` | `.firstMes` | 也接受 `data.first_message` 作为别名 |
| `data.character_book.name` | `WorldBook.name` | |
| `data.character_book.entries[].id` | `WorldBookEntry.id` | **缺失时用数组下标补齐，且转成字符串** |
| `…entries[].keys` | `.keys` | |
| `…entries[].content` | `.content` | |
| `…entries[].name` / `.comment` | `.name` | 取 `name`，为空**退化到 `comment`** |
| `…entries[].enabled` | `.enabled` | ⚠️ **方向一致，不要取反** |
| `…entries[].constant` | `.constant` | |
| `…entries[].insertion_order` | `.priority` | |
| `…entries[].extensions.*` | 忽略但保留 | 在"被忽略的运行规则"里列出 |

### 2.2 🔴 为什么不取反 `enabled`

这是最容易踩的坑：很多格式里"启用"由**反义字段**表达（如 `disable: true`）。
V2 的 `entries[].enabled` 是**正方向**（`true` = 启用），与本题一致，所以**直接赋值**。
代码里刻意写成 `enabled: e.enabled === undefined ? true : Boolean(e.enabled)`，
并在表里标注"⚠️ 方向一致，不要取反"——因为一旦取反，"导入的卡里所有条目都变成禁用"，
症状是"世界书完全不生效"，很难第一时间定位。

### 2.3 被忽略的运行规则（导入预览必须列出）

`secondary_keys` / `selective` / `selectiveLogic` / `position`（before_char / after_char 等）/
`case_sensitive` / `match_whole_words` / `probability` / `sticky` / `cooldown` / `delay` /
`group` / `group_weight` / `scan_depth` / `vectorized`。

实现细节：`importCharacterCard()` 会**检测这些字段是否真的出现在你的卡里**（`ignoredPresent`），
UI 只在"确实出现了"时展开一个"被忽略的运行规则（N 条）"说明块 —— 比无脑列全 14 条更有信息量。

### 2.4 未知字段 / 未知 extensions **原样保留**（题面硬要求）

```ts
card.raw = raw;   // 整份原始 JSON 原封不动存下来
```

导出时：

```ts
const base = JSON.parse(JSON.stringify(card.raw));  // 以 raw 为基底
base.data.name = card.name; base.data.description = ...; base.data.first_mes = ...;  // 只写回可映射字段
// 其余（personality / mes_example / extensions.vendor_specific …）一个字都没动
```

**测试 `#14`**：一张卡里带 `data.personality` 与未知 `extensions.vendor_specific`，
导出后这些字段**逐字节还在**，而编辑过的 `name` 正确写回。

### 2.5 四类错误处理（题面硬要求"导入导出还须处理"）

| 情况 | 处理 |
|---|---|
| **JSON 语法错误** | `parseJsonText()` 捕获，并从 V8 的 `position N` **换算出行号 + 列号**（原生 `JSON.parse` 不给位置信息，只能自己扫） |
| **字段类型错误** | 指出**路径 + 期望类型**：`字段 data.character_book.entries 类型错误：期望数组`、`字段 …entries[0].keys 类型错误：期望字符串数组` |
| **重复 ID** | **报出重复的 ID 值 + 条目序号**，并**尽力给出原文行号**（`locateIdLines()` 在原文里 `indexOf("\"<id>\"")` 逐次定位后换算行号）—— 行号**允许降级**，定位不到就如实写"（未能定位原文行号）" |
| **不支持的 spec_version** | **明确拒绝**并说明支持范围：`不支持的格式版本：spec_version = "1.0"（仅支持 2.x，本项目不支持 V1 的 1.0）` |

**测试 `#15`** 专门锁住"1.0 必须被拒"这条。

### 2.6 PNG 导入（可选扩展，已实现）

V2 卡片可以嵌在 PNG 的 `tEXt` chunk 里（关键字 `chara`，V3 用 `ccv3`）。
实现是手写 PNG chunk 扫描：校验 8 字节签名 → 逐 chunk 读 `length` + `type` + `data(CRC 跳过)` →
遇到 `tEXt` 就按 `keyword\0text` 拆 → **优先 `ccv3`，其次 `chara`** → base64 解码 → `JSON.parse`。
**零依赖**（`atob` + `TextDecoder` 都是平台内置）。

### 2.7 开场白怎么进会话

绑定角色卡后，**新建会话时**插入一条 `role='assistant'`、`status='complete'` 的消息（`repo.createSession`）。
L1 阶段没有角色卡导入，就内置一张默认卡（`src/core/defaultCharacter.ts` 的 `DEFAULT_CHARACTER`），
新建会话默认绑定它 —— **这样等级 1 的"展示角色开场白"在 L1 就能达成**，机制全程一致。

## ③ 可能被追问的问题

**Q1：为什么 `card.raw` 要整份存下来，而不是只存支持的那几个字段？**
因为题面要求"**暂时不支持的字段及未知 extensions，在导出时应保留**"。
只有把原文件整份留着，导出时才能"以它为基底写回"，否则丢失的字段再也补不回来。
代价是每条角色卡多占一点存储 —— 对这个规模的应用完全可接受。

**Q2：重复 ID 为什么不是自动改掉就完了？**
题面要求"**必须报出重复的 ID 值与其条目序号**" —— 报出来是**给用户看的**，
让用户能回到原文件去修。自动静默改写会让用户以为卡已经没问题了。
本项目的处理是：**报告 + 拒绝导入**（挡在预览页），由用户决定改文件还是放弃。

**Q3：`name` 为空时为什么退化到 `comment`，而不是报错？**
因为 V2 世界里 `comment` 是 `name` 的**事实上的同义字段**（很多卡只写 `comment`）。
报错会让大量真实卡导不进来；退化的代价只是"条目名用了 comment 的内容"，无害。
再兜一层：两者都没有时用 `条目 ${i+1}`。

**Q4：`insertion_order` → `priority` 是一比一映射吗？**
是数值直传（`typeof e.insertion_order === 'number' ? e.insertion_order : 0`）。
语义差异仅在于：本题的 `priority` 在**相同时**要按 id 的 ASCII 升序 tie-break（V2 没这个规则），
这属于本题世界书规则的补充，不改变映射本身。

**Q5：PNG 里的 V3 卡（`ccv3`）也支持吗？**
读得到，但**会被拒绝**：V3 的 `spec` 不是 `chara_card_v2`，校验会给出"不支持的格式规范"。
这是**刻意的**：题面只要求 V2 子集，声称支持 V3 会带来一堆没验证的行为。
解析器的取值顺序是 `ccv3` 优先（若两个 chunk 都在），失败后走同一条校验路径。

**Q6：导入角色卡会不会自动把内嵌世界书挂到当前会话？**
会（`CharacterCardImport.doImport`）：导入后 `saveWorldBook` + 把新世界书 id 追加进
`session.worldBookIds`，并 `attachCharacter` 到当前会话。这样"导入一张卡 → 立刻能聊"是连贯的。
同时 UI 明确提示"角色卡只影响**之后的请求**，已有的开场白消息不会被替换" —— 不偷偷改历史。
