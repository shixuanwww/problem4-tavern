import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Message, Preset, Session, WorldBook } from '../src/core/types.ts';
import { buildRequest, freezeSnapshot, partsToChat } from '../src/core/assembly.ts';
import { DEFAULT_CHARACTER } from '../src/core/defaultCharacter.ts';

function mkSession(
  over: Partial<Omit<Session, 'settings'>> & { settings?: Partial<Session['settings']> } = {},
): Session {
  const { settings, ...rest } = over;
  return {
    id: 's1',
    title: '测试会话',
    createdAt: 0,
    updatedAt: 0,
    characterCardId: DEFAULT_CHARACTER.id,
    worldBookIds: [],
    ...rest,
    settings: {
      scanDepth: 4,
      contextLimit: 32768,
      worldBookBudgetPct: 25,
      contextWarnPct: 80,
      stream: true,
      ...settings,
    },
  };
}

function msg(seq: number, role: Message['role'], content: string, over: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    sessionId: 's1',
    role,
    content,
    createdAt: seq,
    status: 'complete',
    uiHidden: false,
    excluded: false,
    seq,
    ...over,
  };
}

const emptyBooks: WorldBook[] = [];

// 用例 8：uiHidden = true 的消息仍然参与装配
test('#8 uiHidden 的消息仍然参与装配（隐藏不改变发给 AI 的内容）', () => {
  const messages = [
    msg(1, 'user', '第一条'),
    msg(2, 'assistant', '第二条', { uiHidden: true }),
    msg(3, 'user', '第三条'),
  ];
  const built = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '新输入',
    pendingSeq: 4,
  });
  const texts = built.parts.map((p) => p.content);
  assert.ok(texts.includes('第二条'), '被界面隐藏的消息必须仍然进入上下文');
});

// 用例 9：excluded = true 的消息不参与装配
test('#9 excluded 的消息不参与装配，并记入 skipped(message_excluded)', () => {
  const messages = [
    msg(1, 'user', '要排除的内容', { excluded: true }),
    msg(2, 'assistant', '正常内容'),
  ];
  const built = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '新输入',
    pendingSeq: 3,
  });
  assert.ok(!built.parts.some((p) => p.content === '要排除的内容'));
  assert.ok(
    built.skipped.some((s) => s.reason === 'message_excluded' && s.source === 'message' && s.entryId === 'm1'),
  );
});

// 用例 7：未完成的助手回复不进上下文
test('#7 未完成的助手回复不进上下文，并记入 skipped(message_incomplete)', () => {
  const messages = [
    msg(1, 'user', '问题'),
    msg(2, 'assistant', '半截回复', { status: 'streaming' }),
    msg(3, 'assistant', '被打断的回复', { status: 'interrupted' }),
  ];
  const built = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '继续',
    pendingSeq: 4,
  });
  assert.ok(!built.parts.some((p) => p.content === '半截回复'));
  assert.ok(!built.parts.some((p) => p.content === '被打断的回复'));
  const incomplete = built.skipped.filter((s) => s.reason === 'message_incomplete');
  assert.equal(incomplete.length, 2);
});

// 用例 16：发一条 user 消息后装配，该消息只出现一次
test('#16 待发送的 user 消息在 history 与 pending 中只出现一次', () => {
  const messages = [
    msg(1, 'assistant', '你好呀'),
    msg(2, 'user', '这是本次要发送的输入'), // 已入库，seq=2
  ];
  const built = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '这是本次要发送的输入',
    pendingSeq: 2,
  });
  const hits = built.parts.filter((p) => p.content === '这是本次要发送的输入');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'pending');
});

// 用例 17：装配结果被冻结后，后续编辑历史消息不得改写已发送快照
test('#17 已发送的快照不被后续编辑改写（freeze 之后只读）', () => {
  const messages = [msg(1, 'user', '原始内容')];
  const built = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '新输入',
    pendingSeq: 2,
  });
  const snap = freezeSnapshot(mkSession(), 'gemini-3.8-flash', built, 1000, 'snap-1');

  // 用户随后编辑历史消息
  messages[0].content = '被改过的内容';

  const again = buildRequest({
    session: mkSession(),
    messages,
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '新输入',
    pendingSeq: 2,
  });

  assert.ok(snap.parts.some((p) => p.content === '原始内容'), '旧快照必须仍是旧内容');
  assert.ok(!snap.parts.some((p) => p.content === '被改过的内容'));
  assert.ok(again.parts.some((p) => p.content === '被改过的内容'), '新一次装配才反映改动');
});

test('装配顺序：character → preset-system → worldbook → history → pending → post-history', () => {
  const preset: Preset = {
    id: 'p1',
    format: 'st-lite',
    formatVersion: '1.0',
    name: '测试预设',
    modules: [
      { id: 'm-late', name: '历史之后', role: 'system', content: 'POST', enabled: true, order: 1, position: 'postHistory' },
      { id: 'm2', name: '系统B', role: 'system', content: 'SYS-B', enabled: true, order: 20, position: 'system' },
      { id: 'm1', name: '系统A', role: 'system', content: 'SYS-A', enabled: true, order: 10, position: 'system' },
      { id: 'm-off', name: '禁用模块', role: 'system', content: 'SHOULD-NOT-APPEAR', enabled: false, order: 0, position: 'system' },
    ],
    contextConfig: { contextLimit: 32768, scanDepth: 4, worldBookBudgetPct: 25, contextWarnPct: 80 },
  };
  const books: WorldBook[] = [
    {
      id: 'wb1',
      name: 'Fate',
      createdAt: 0,
      updatedAt: 0,
      entries: [
        { id: 'e1', name: '圣杯', keys: ['圣杯'], content: '圣杯是世界级别的许愿机。', enabled: true, constant: false, priority: 1 },
      ],
    },
  ];
  const messages = [msg(1, 'assistant', '开场白')];
  const built = buildRequest({
    session: mkSession({ presetId: 'p1', worldBookIds: ['wb1'] }),
    messages,
    worldBooks: books,
    preset,
    character: DEFAULT_CHARACTER,
    pendingUserText: '圣杯是什么',
    pendingSeq: 2,
  });

  const kinds = built.parts.map((p) => p.kind);
  assert.deepEqual(kinds, [
    'character',
    'preset-system',
    'preset-system',
    'worldbook',
    'history',
    'pending',
    'post-history',
  ]);
  // preset-system 按 order 升序
  const sys = built.parts.filter((p) => p.kind === 'preset-system').map((p) => p.content);
  assert.deepEqual(sys, ['SYS-A', 'SYS-B']);
  assert.ok(!built.parts.some((p) => p.content === 'SHOULD-NOT-APPEAR'));
});

test('partsToChat 能把 parts 还原成模型消息数组（含角色）', () => {
  const built = buildRequest({
    session: mkSession(),
    messages: [msg(1, 'assistant', '你好')],
    worldBooks: emptyBooks,
    character: DEFAULT_CHARACTER,
    pendingUserText: '在吗',
    pendingSeq: 2,
  });
  const chat = partsToChat(built.parts);
  assert.equal(chat[0].role, 'system');
  assert.equal(chat[chat.length - 1].role, 'user');
  assert.equal(chat[chat.length - 1].content, '在吗');
});

test('token 总量 = 各部分 token 之和；世界书预算外条目会出现在 skipped', () => {
  const books: WorldBook[] = [
    {
      id: 'wb1',
      name: 'B',
      createdAt: 0,
      updatedAt: 0,
      entries: Array.from({ length: 6 }, (_, i) => ({
        id: `e${i}`,
        name: `条目${i}`,
        keys: [],
        content: 'x'.repeat(4000),
        enabled: true,
        constant: true,
        priority: 10 - i,
      })),
    },
  ];
  const built = buildRequest({
    session: mkSession({ settings: { contextLimit: 1000, worldBookBudgetPct: 25 } }), // 预算 = 250
    messages: [],
    worldBooks: books,
    character: undefined,
    pendingUserText: 'hi',
    pendingSeq: 1,
  });
  assert.equal(built.totalTokens, built.parts.reduce((s, p) => s + p.tokens, 0));
  assert.ok(built.skipped.some((s) => s.reason === 'budget_exceeded'));
  // 预算标记行必须出现（可观测，不得静默截断）
  const wbPart = built.parts.find((p) => p.kind === 'worldbook');
  assert.ok(wbPart && wbPart.content.includes('世界书预算已满'));
});
