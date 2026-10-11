import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePreset, serializePreset, PRESET_FORMAT } from '../src/core/preset.ts';
import { expandTemplate } from '../src/core/template.ts';
import { buildRequest } from '../src/core/assembly.ts';
import { DEFAULT_CHARACTER } from '../src/core/defaultCharacter.ts';
import type { Message, Session, WorldBook } from '../src/core/types.ts';

const GOOD = {
  format: 'st-lite',
  formatVersion: '1.0',
  id: 'preset-1',
  name: '我的预设',
  modules: [
    {
      id: 'm1',
      name: '人设',
      role: 'system',
      content: '你是 {{char}}，当前地点是 {{location}}，生命值是 {{hp}}。',
      enabled: true,
      order: 10,
      position: 'system',
      template: true,
    },
    {
      id: 'm2',
      name: '风格约束',
      role: 'system',
      content: '保持简短。',
      enabled: true,
      order: 20,
      position: 'postHistory',
    },
  ],
  contextConfig: { contextLimit: 8000, scanDepth: 3, worldBookBudgetPct: 20, contextWarnPct: 80 },
};

test('合法预设导入成功', () => {
  const r = parsePreset(GOOD);
  assert.ok(r.ok);
  assert.equal(r.preset.format, PRESET_FORMAT);
  assert.equal(r.preset.modules.length, 2);
  assert.equal(r.preset.contextConfig.scanDepth, 3);
});

test('format 不匹配 / formatVersion 不支持 → 明确报错', () => {
  const a = parsePreset({ ...GOOD, format: 'other' });
  assert.ok(!a.ok && a.errors.some((e) => e.includes('format')));
  const b = parsePreset({ ...GOOD, formatVersion: '9.9' });
  assert.ok(!b.ok && b.errors.some((e) => e.includes('formatVersion')));
});

test('字段类型错误 → 指出字段路径与期望类型', () => {
  const bad = parsePreset({ ...GOOD, modules: [{ ...GOOD.modules[0], keys: 1, order: '10' }] });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes('modules[0].order')));
});

test('modules 不是数组 → 报错', () => {
  const r = parsePreset({ ...GOOD, modules: {} });
  assert.ok(!r.ok && r.errors.some((e) => e.includes('modules')));
});

// 用例 18：预设导入（含 {{}} 模板模块）→ 数据驱动参与编排 + 变量展开 + 缺失保留原样
test('#18 预设模块数据驱动参与编排，{{char}} 展开、缺失变量保留原样', () => {
  const r = parsePreset(GOOD);
  assert.ok(r.ok);

  const session: Session = {
    id: 's1',
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    characterCardId: DEFAULT_CHARACTER.id,
    worldBookIds: [],
    presetId: 'preset-1',
    settings: { scanDepth: 4, contextLimit: 32768, worldBookBudgetPct: 25, contextWarnPct: 80, stream: true },
    variables: { location: '柳洞寺' },
  };
  const messages: Message[] = [];
  const books: WorldBook[] = [];

  const built = buildRequest({
    session,
    messages,
    worldBooks: books,
    preset: r.preset,
    character: DEFAULT_CHARACTER,
    pendingUserText: '你好',
    pendingSeq: 1,
  });

  const sys = built.parts.find((p) => p.sourceId === 'm1');
  assert.ok(sys);
  assert.ok(sys.content.includes(`你是 ${DEFAULT_CHARACTER.name}`), '{{char}} 应展开为角色名');
  assert.ok(sys.content.includes('柳洞寺'), '会话自定义变量应展开');
  // 缺失变量保留原样
  assert.ok(sys.content.includes('{{hp}}'), '缺失变量应保留原样以便告警');

  // 数据驱动：模块名/内容/顺序全部来自数据，代码里没有硬编码
  const post = built.parts.find((p) => p.sourceId === 'm2');
  assert.ok(post && post.kind === 'post-history');
});

test('禁用的预设模块不参与编排（数据驱动启停）', () => {
  const r = parsePreset(GOOD);
  assert.ok(r.ok);
  r.preset.modules[0].enabled = false;
  const built = buildRequest({
    session: {
      id: 's1',
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      presetId: 'preset-1',
      worldBookIds: [],
      settings: { scanDepth: 4, contextLimit: 32768, worldBookBudgetPct: 25, contextWarnPct: 80, stream: true },
    },
    messages: [],
    worldBooks: [],
    preset: r.preset,
    character: undefined,
    pendingUserText: 'hi',
    pendingSeq: 1,
  });
  assert.ok(!built.parts.some((p) => p.sourceId === 'm1'));
  assert.ok(built.parts.some((p) => p.sourceId === 'm2'));
});

test('模板 {{}} 展开：if 条件 + 缺失变量告警', () => {
  const out = expandTemplate('生命值 {{hp}}。{{#if hp < 20}}你受伤了。{{/if}}', { hp: '10' });
  assert.equal(out.text, '生命值 10。你受伤了。');
  const out2 = expandTemplate('{{#if hp < 20}}受伤{{/if}}', { hp: '50' });
  assert.equal(out2.text, '');
  const out3 = expandTemplate('地点 {{location}}', {});
  assert.equal(out3.text, '地点 {{location}}');
  assert.deepEqual(out3.missing, ['location']);
});

test('serializePreset 往返可用', () => {
  const r = parsePreset(GOOD);
  assert.ok(r.ok);
  const round = parsePreset(serializePreset(r.preset));
  assert.ok(round.ok);
  assert.equal(round.preset.name, r.preset.name);
});
