import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePanels, hasPanelProblem } from '../src/core/panel.ts';

const SAMPLE = `saber 正在破坏圣杯

<tavern-panel type="status">
{"hp":10,"令咒":3,"location":"柳洞寺"}
</tavern-panel>

<tavern-panel type="choices">
{"options":[{"label":"发动令咒","text":"saber自裁吧"}]}
</tavern-panel>`;

test('题面示例：正文 + 状态栏 + 选项按钮 都能解析出来', () => {
  const parsed = parsePanels(SAMPLE);
  const kinds = parsed.segments.map((s) => s.kind);
  assert.deepEqual(kinds, ['text', 'status', 'text', 'choices']);

  const status = parsed.segments.find((s) => s.kind === 'status');
  assert.ok(status && status.kind === 'status');
  assert.deepEqual(status.data, { hp: 10, 令咒: 3, location: '柳洞寺' });

  const choices = parsed.segments.find((s) => s.kind === 'choices');
  assert.ok(choices && choices.kind === 'choices');
  assert.deepEqual(choices.options, [{ label: '发动令咒', text: 'saber自裁吧' }]);
  assert.equal(hasPanelProblem(parsed), false);
});

// 用例 11：JSON 非法 → raw 原文保留 + problem 非空
test('#11 JSON 非法：保留原文 + 给出具体问题', () => {
  const src = '正文\n<tavern-panel type="status">{"hp":10,}</tavern-panel>\n尾部正文';
  const parsed = parsePanels(src);
  const err = parsed.segments.find((s) => s.kind === 'error');
  assert.ok(err && err.kind === 'error');
  assert.ok(err.problem.length > 0);
  assert.ok(err.raw.includes('{"hp":10,}'), 'raw 必须保留原始标签内容');
  assert.ok(err.raw.includes('<tavern-panel'), 'raw 必须保留完整标签');
  // 标签外的正文不能丢
  assert.ok(parsed.segments.some((s) => s.kind === 'text' && s.text.includes('正文')));
  assert.ok(parsed.segments.some((s) => s.kind === 'text' && s.text.includes('尾部正文')));
});

// 用例 12：标签未闭合 → 保留原文且不丢后续文本
test('#12 标签未闭合：整段作为 error，后续文本不丢', () => {
  const src = '前面正文\n<tavern-panel type="status">{"hp":1}\n后面的文字还在';
  const parsed = parsePanels(src);
  const err = parsed.segments.find((s) => s.kind === 'error');
  assert.ok(err && err.kind === 'error');
  assert.ok(err.problem.includes('未闭合'));
  assert.ok(err.raw.includes('后面的文字还在'), '未闭合标签之后的文本必须一并保留在原文里');
  assert.ok(err.raw.includes('{"hp":1}'));
});

// 用例 13：type 不支持 → 保留原文 + 明确提示
test('#13 不支持的 type：保留原文 + 明确提示', () => {
  const src = '<tavern-panel type="foo">{"a":1}</tavern-panel>';
  const parsed = parsePanels(src);
  const err = parsed.segments.find((s) => s.kind === 'error');
  assert.ok(err && err.kind === 'error');
  assert.equal(err.panelType, 'foo');
  assert.ok(err.problem.includes('foo'));
  assert.ok(err.raw.includes('{"a":1}'));
});

test('choices 结构不对（options 不是数组 / label 不是字符串）→ error 保留原文', () => {
  const a = parsePanels('<tavern-panel type="choices">{"options":"nope"}</tavern-panel>');
  assert.ok(a.segments.some((s) => s.kind === 'error'));
  const b = parsePanels('<tavern-panel type="choices">{"options":[{"label":1,"text":"x"}]}</tavern-panel>');
  const err = b.segments.find((s) => s.kind === 'error');
  assert.ok(err && err.kind === 'error' && err.problem.includes('options[0]'));
});

test('status 顶层不是对象（数组）→ error', () => {
  const p = parsePanels('<tavern-panel type="status">[1,2]</tavern-panel>');
  assert.ok(p.segments.some((s) => s.kind === 'error'));
});

test('杂项：缺 type、单引号属性、跨行内容', () => {
  assert.ok(parsePanels('<tavern-panel>{"a":1}</tavern-panel>').segments.some((s) => s.kind === 'error'));
  const q = parsePanels("<tavern-panel type='status'>{\"hp\":5}</tavern-panel>");
  const st = q.segments.find((s) => s.kind === 'status');
  assert.ok(st && st.kind === 'status' && st.data.hp === 5);
  const multi = parsePanels('<tavern-panel type="status">\n{\n"hp": 1\n}\n</tavern-panel>');
  assert.ok(multi.segments.some((s) => s.kind === 'status'));
});

test('纯文本消息不产生面板块', () => {
  const p = parsePanels('就是一段普通的话');
  assert.deepEqual(p.segments, [{ kind: 'text', text: '就是一段普通的话' }]);
  assert.equal(hasPanelProblem(p), false);
});
