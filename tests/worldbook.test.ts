import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Message, WorldBookEntry } from '../src/core/types.ts';
import { activateWorldBook } from '../src/core/worldbook.ts';
import { estimate, clampScanDepth, worldBookBudget } from '../src/core/tokens.ts';

function msg(seq: number, content: string, over: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    sessionId: 's1',
    role: 'user',
    content,
    createdAt: seq,
    status: 'complete',
    uiHidden: false,
    excluded: false,
    seq,
    ...over,
  };
}

function entry(id: string, over: Partial<WorldBookEntry> = {}): WorldBookEntry {
  return {
    id,
    name: `条目${id}`,
    keys: [],
    content: `正文${id}`,
    enabled: true,
    constant: false,
    priority: 0,
    ...over,
  };
}

const BIG_BUDGET = 100000;

// 用例 1：扫描深度 3，关键词只在第 4 条旧消息里 → 不激活
test('#1 扫描深度 3：关键词只在更早（超出扫描深度）的消息里 → 不激活', () => {
  const messages = [
    msg(1, '这里出现了 saber 这个名字'),
    msg(2, '无关二'),
    msg(3, '无关三'),
    msg(4, '无关四'),
  ];
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['saber'] })],
    messages,
    pendingUserText: '继续',
    scanDepth: 3,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'no_keyword_match' && s.entryId === 'a'));
});

// 用例 2：关键词跨两条消息各出现一半 → 不激活（不跨消息拼接）
test('#2 关键词跨两条消息各出现一半 → 不激活（单条消息内匹配）', () => {
  const messages = [msg(1, '前半个关键词 abc'), msg(2, '后半个关键词 def')];
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['abcdef'] })],
    messages,
    pendingUserText: '继续',
    scanDepth: 5,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 0);
});

// 用例 3：常驻且启用 + 无关键词 → 直接激活
test('#3 常驻且启用、无关键词 → 直接激活（reason=constant）', () => {
  const r = activateWorldBook({
    entries: [entry('a', { constant: true, keys: [] })],
    messages: [msg(1, '无关')],
    pendingUserText: '无关',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 1);
  assert.equal(r.activated[0].activation.reason, 'constant');
});

// 用例 4：禁用条目 + 关键词命中 → 不激活（禁用优先）
test('#4 禁用条目即使关键词命中也不激活（disabled 优先）', () => {
  const r = activateWorldBook({
    entries: [entry('a', { enabled: false, keys: ['saber'] })],
    messages: [msg(1, 'saber')],
    pendingUserText: 'saber',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'disabled'));
});

// 用例 5：同一关键词在 3 条消息里都出现 → 只激活 1 次
test('#5 同一关键词在 3 条消息里都出现 → 只激活 1 次', () => {
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['saber'] })],
    messages: [msg(1, 'saber'), msg(2, 'saber 又出现'), msg(3, '还是 saber')],
    pendingUserText: 'saber',
    scanDepth: 10,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 1);
  // 命中证据应指回最早的那条消息
  assert.equal(r.activated[0].activation.matchedMessageId, 'm1');
  assert.equal(r.activated[0].activation.matchedKey, 'saber');
});

// 用例 6：优先级相同、ID "10" 与 "9" → 按 ASCII 升序，"10" 在 "9" 之前
test('#6 同优先级按 id 的 ASCII 升序："10" 排在 "9" 之前', () => {
  const r = activateWorldBook({
    entries: [entry('9', { constant: true, priority: 5 }), entry('10', { constant: true, priority: 5 })],
    messages: [],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.deepEqual(
    r.activated.map((a) => a.entry.id),
    ['10', '9'],
  );
});

// 用例 10：世界书超预算 → 超出者进 skipped(budget_exceeded)，不进 activated
test('#10 超预算条目进 skipped(budget_exceeded)、不出现在 activated 中', () => {
  // 每条正文 token = estimate('很长的正文内容内容内容内容内容内容内容内容内容') ≈ 21
  const a = entry('a', { constant: true, priority: 10, content: '很长的正文内容内容内容内容内容内容内容内容内容' });
  const b = entry('b', { constant: true, priority: 5, content: '另一段很长的正文内容内容内容内容内容内容内容内容' });
  const budget = estimate(a.content); // 只装得下 a
  const r = activateWorldBook({
    entries: [a, b],
    messages: [],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: budget,
    estimate,
  });
  assert.deepEqual(
    r.activated.map((x) => x.entry.id),
    ['a'],
  );
  assert.ok(r.skipped.some((s) => s.entryId === 'b' && s.reason === 'budget_exceeded'));
  // 被跳过者不得计入 used
  assert.equal(r.usedTokens, estimate(a.content));
});

// 超预算后 continue：装不下的大条目被跳过，后面装得下的小条目仍应插入
test('#10b 超预算用 continue 而非 break：小条目仍能被插入', () => {
  const big = entry('a', { constant: true, priority: 10, content: '很长的正文内容内容内容内容内容内容内容内容内容内容内容内容' });
  const small = entry('b', { constant: true, priority: 1, content: '短' });
  const r = activateWorldBook({
    entries: [big, small],
    messages: [],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: estimate(small.content),
    estimate,
  });
  assert.deepEqual(
    r.activated.map((x) => x.entry.id),
    ['b'],
  );
  assert.ok(r.skipped.some((s) => s.entryId === 'a' && s.reason === 'budget_exceeded'));
});

// 扫描集与装配共通的两条过滤：excluded / 未完成
test('#7/#9 excluded 与未完成消息不进扫描集（out_of_scan_depth 通道给出消息级原因）', () => {
  const messages = [
    msg(1, 'saber 在第一条', { excluded: true }),
    msg(2, 'saber 在第二条', { status: 'streaming', role: 'assistant' }),
    msg(3, '第三条无关'),
    msg(4, '第四条无关'),
    msg(5, '第五条无关'),
  ];
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['saber'] })],
    messages,
    pendingUserText: '继续',
    scanDepth: 2,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 0, '被排除 / 未完成的消息都不该参与关键词匹配');
  // 扫描深度截断掉的合格历史 → 消息级 skipped
  const reasons = r.skipped.filter((s) => s.source === 'message').map((s) => s.reason);
  assert.ok(reasons.includes('out_of_scan_depth'));
});

test('#11 去重：同一 id 出现两次 → 只处理一次，被丢弃者记入 skipped(duplicate_id)', () => {
  const r = activateWorldBook({
    entries: [entry('a', { constant: true }), entry('a', { constant: true })],
    messages: [],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 1);
  assert.ok(r.skipped.some((s) => s.reason === 'duplicate_id' && s.source === 'entry'));
});

test('空正文的候选条目 → skipped(empty_content)', () => {
  const r = activateWorldBook({
    entries: [entry('a', { constant: true, content: '   ' })],
    messages: [],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'empty_content'));
});

test('关键词大小写不敏感 + key 先 trim + 空 key 无效', () => {
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['  SABER ', ''] })],
    messages: [msg(1, 'Saber 出场了')],
    pendingUserText: '',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 1);
  assert.equal(r.activated[0].activation.matchedKey, 'SABER');
});

test('pending 消息参与扫描（规则 1）：关键词只出现在本次待发送输入里也能命中', () => {
  const r = activateWorldBook({
    entries: [entry('a', { keys: ['圣杯'] })],
    messages: [msg(1, '无关')],
    pendingUserText: '关于圣杯的事',
    scanDepth: 1,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.equal(r.activated.length, 1);
});

test('不扫描世界书正文（规则 4）：A 的关键词只出现在 B 的正文里 → A 不激活', () => {
  const r = activateWorldBook({
    entries: [
      entry('a', { keys: ['saber'], constant: true, content: '常驻正文' }),
      entry('b', { keys: ['不存在的词'], content: 'saber 出现在这本世界书的正文里' }),
    ],
    messages: [msg(1, '无关消息')],
    pendingUserText: '无关',
    scanDepth: 4,
    budgetTokens: BIG_BUDGET,
    estimate,
  });
  assert.deepEqual(
    r.activated.map((x) => x.entry.id),
    ['a'],
  );
});

test('scanDepth 钳制：0 / 负数 → 1，>100 → 100', () => {
  assert.equal(clampScanDepth(0), 1);
  assert.equal(clampScanDepth(-5), 1);
  assert.equal(clampScanDepth(999), 100);
  assert.equal(clampScanDepth(Number.NaN), 1);
});

test('世界书预算公式 = floor(contextLimit * pct / 100)', () => {
  assert.equal(worldBookBudget(32768, 25), 8192);
  assert.equal(worldBookBudget(1000, 25), 250);
});
