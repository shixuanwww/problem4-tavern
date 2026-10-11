import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  importCharacterCard,
  exportCharacterCard,
  parseJsonText,
  looksLikeV2,
} from '../src/core/characterCard.ts';

const V2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Saber',
    description: '亚瑟王。',
    first_mes: '你终于来了，魔术师。',
    personality: '这是本项目不支持的字段，导出时必须保留',
    extensions: { some_vendor: { note: '未知扩展也要保留' } },
    character_book: {
      name: 'Fate',
      entries: [
        {
          id: 'e1',
          keys: ['圣杯', 'grail'],
          content: '圣杯是实现愿望的装置。',
          name: '圣杯',
          enabled: true,
          constant: false,
          insertion_order: 10,
          extensions: { position: 1, probability: 100, selective: true },
        },
        {
          id: 'e2',
          comment: '没有 name 时退化成 comment',
          keys: [],
          content: '常驻背景。',
          enabled: true,
          constant: true,
          insertion_order: 5,
        },
      ],
    },
  },
};

test('V2 子集导入：名称 / 描述 / 开场白 / 内嵌世界书 都映射正确', () => {
  const r = importCharacterCard(V2);
  assert.ok(r.ok);
  assert.equal(r.card.name, 'Saber');
  assert.equal(r.card.description, '亚瑟王。');
  assert.equal(r.card.firstMes, '你终于来了，魔术师。');
  assert.ok(r.worldBook);
  assert.equal(r.worldBook.name, 'Fate');
  assert.equal(r.worldBook.entries.length, 2);
  const e1 = r.worldBook.entries[0];
  assert.deepEqual(e1.keys, ['圣杯', 'grail']);
  assert.equal(e1.priority, 10);
  assert.equal(e1.enabled, true);
  assert.equal(e1.constant, false);
  // name 为空时退化到 comment
  assert.equal(r.worldBook.entries[1].name, '没有 name 时退化成 comment');
  assert.equal(r.worldBook.entries[1].constant, true);
  // 被忽略的运行规则要被列出来
  assert.ok(r.ignoredPresent.includes('probability'));
  assert.ok(r.ignoredPresent.includes('selective'));
});

// 用例 14：未知 extensions / 未支持字段，导出后原样保留
test('#14 未知 extensions 与未支持字段在导出后原样保留', () => {
  const r = importCharacterCard(V2);
  assert.ok(r.ok);
  const out = exportCharacterCard(r.card, r.worldBook) as Record<string, any>;
  assert.equal(out.data.personality, V2.data.personality);
  assert.deepEqual(out.data.extensions, V2.data.extensions);
  assert.equal(out.data.character_book.entries[0].extensions.probability, 100);
  assert.equal(out.data.character_book.entries[0].extensions.selective, true);
  // 可映射字段写回
  assert.equal(out.spec, 'chara_card_v2');
  assert.equal(out.data.name, 'Saber');
});

test('导出到 raw 后仍能再次导入（往返）', () => {
  const r = importCharacterCard(V2);
  assert.ok(r.ok);
  const out = exportCharacterCard(r.card, r.worldBook);
  const again = importCharacterCard(out);
  assert.ok(again.ok);
  assert.equal(again.card.name, 'Saber');
  assert.equal(again.worldBook?.entries.length, 2);
});

// 用例 15：spec_version = "1.0" → 拒绝 + 说明支持范围
test('#15 spec_version="1.0" → 明确拒绝并说明支持范围', () => {
  const r = importCharacterCard({ ...V2, spec_version: '1.0' });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes('不支持的格式版本') && e.includes('2.x')));
});

test('spec 不为 chara_card_v2 → 拒绝', () => {
  const r = importCharacterCard({ ...V2, spec: 'chara_card_v1' });
  assert.ok(!r.ok && r.errors.some((e) => e.includes('不支持的格式规范')));
});

test('字段类型错误：entries 不是数组 / keys 不是数组', () => {
  const a = importCharacterCard({
    ...V2,
    data: { ...V2.data, character_book: { name: 'x', entries: 'nope' } },
  });
  assert.ok(!a.ok && a.errors.some((e) => e.includes('entries 类型错误')));

  const b = importCharacterCard({
    ...V2,
    data: {
      ...V2.data,
      character_book: { name: 'x', entries: [{ id: 'a', keys: 'oops', content: 'c' }] },
    },
  });
  assert.ok(!b.ok && b.errors.some((e) => e.includes('keys') && e.includes('期望字符串数组')));
});

test('重复 ID → 报出重复值、条目序号（并尽力给原文行号）', () => {
  const dup = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'X',
      description: '',
      first_mes: '',
      character_book: {
        name: 'B',
        entries: [
          { id: 'dup', keys: ['a'], content: '1' },
          { id: 'dup', keys: ['b'], content: '2' },
        ],
      },
    },
  };
  const text = JSON.stringify(dup, null, 2);
  const r = importCharacterCard(dup, text);
  assert.ok(!r.ok);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].id, 'dup');
  assert.deepEqual(r.duplicates[0].indices, [0, 1]);
  assert.ok(r.duplicates[0].lines.length > 0, '应能尽力定位原文行号');
  assert.ok(r.errors.some((e) => e.includes('重复 id')));
});

test('id 缺失 → 用数组下标补齐（字符串）', () => {
  const r = importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'X',
      character_book: { name: 'B', entries: [{ keys: ['a'], content: '1' }] },
    },
  });
  assert.ok(r.ok);
  assert.equal(r.worldBook?.entries[0].id, '0');
});

test('parseJsonText：语法错误带行列信息', () => {
  const bad = parseJsonText('{\n  "a": 1,\n}');
  assert.ok(!bad.ok);
  assert.ok(bad.error.includes('JSON 语法错误'));
  const good = parseJsonText('{"a":1}');
  assert.ok(good.ok);
});

test('looksLikeV2 粗判', () => {
  assert.equal(looksLikeV2(V2), true);
  assert.equal(looksLikeV2({ a: 1 }), false);
});
