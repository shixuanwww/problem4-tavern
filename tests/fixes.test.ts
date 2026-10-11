import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AppSettings, CharacterCardLite, Message, RequestSnapshot, Session, WorldBook } from '../src/core/types.ts';
import { buildRequest } from '../src/core/assembly.ts';
import { isOverWarnThreshold } from '../src/core/tokens.ts';
import { DEFAULT_CHARACTER } from '../src/core/defaultCharacter.ts';
import { importCharacterCard } from '../src/core/characterCard.ts';
import { buildSessionBundle, checkBundle } from '../src/storage/repo.ts';
import { initialState, reducer, type AppState } from '../src/state/actions.ts';

/**
 * 本轮审计修复的回归用例。
 *
 * 这些用例覆盖的都是"原有 77 条测试一条都没碰到"的边界 —— 特别是
 * **预览与真实发送必须给出同一份世界书激活结果**：这是题面"发送前预览 + 检查视图"的地基。
 */

const SESSION_SETTINGS = {
  scanDepth: 3,
  contextLimit: 32768,
  worldBookBudgetPct: 25,
  contextWarnPct: 80,
  stream: true,
};

const APP_SETTINGS: AppSettings = { baseUrl: '', model: '', apiKey: '', stream: true };

function mkSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: '会话 1',
    createdAt: 1,
    updatedAt: 1,
    characterCardId: DEFAULT_CHARACTER.id,
    worldBookIds: ['wb1'],
    settings: { ...SESSION_SETTINGS },
    ...over,
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

const BOOKS: WorldBook[] = [
  {
    id: 'wb1',
    name: 'Fate',
    createdAt: 0,
    updatedAt: 0,
    entries: [
      {
        id: 'e1',
        name: '圣杯条目',
        keys: ['圣杯'],
        content: '圣杯是世界级别的许愿机。',
        enabled: true,
        constant: false,
        priority: 1,
      },
    ],
  },
];

const HISTORY = [
  msg(1, 'assistant', '开场白：圣杯 出现在最早这条'),
  msg(2, 'user', '无关二'),
  msg(3, 'assistant', '无关三'),
];

const DRAFT = '我们出发吧';

// ===========================================================================
// 一、预览 == 真实发送（修复前：待发送消息入库后占掉一格扫描窗口）
// ===========================================================================

test('修复①：待发送消息入库后不再占用世界书扫描窗口，预览与真实发送结论一致', () => {
  const preview = buildRequest({
    session: mkSession(),
    messages: HISTORY,
    worldBooks: BOOKS,
    character: DEFAULT_CHARACTER,
    pendingUserText: DRAFT,
    pendingSeq: 4, // 预览路径：还没入库，用"下一个 seq"占位
  });
  const send = buildRequest({
    session: mkSession(),
    messages: [...HISTORY, msg(4, 'user', DRAFT)], // 发送路径：已入库
    worldBooks: BOOKS,
    character: DEFAULT_CHARACTER,
    pendingUserText: DRAFT,
    pendingSeq: 4,
  });

  assert.equal(preview.activations.length, 1, '扫描深度 3 应从最早那条历史命中');
  assert.deepEqual(
    send.activations.map((a) => a.entryId),
    preview.activations.map((a) => a.entryId),
    '真实发送的世界书激活结果必须与预览一致',
  );
  assert.deepEqual(
    send.parts.map((p) => p.kind),
    preview.parts.map((p) => p.kind),
    '两边的装配部分与顺序也必须一致',
  );
});

// ===========================================================================
// 二、同 id 重复注入（state + extraMessages）不影响装配
// ===========================================================================

test('修复②：同 id 的消息被传两遍时按 id 去重，且不会挤掉扫描窗口', () => {
  const pending = msg(4, 'user', DRAFT);
  const built = buildRequest({
    session: mkSession(),
    // 模拟 runGeneration：state.messages 里已有一份，extraMessages 又塞了一份
    messages: [...HISTORY, pending, { ...pending }],
    worldBooks: BOOKS,
    character: DEFAULT_CHARACTER,
    pendingUserText: DRAFT,
    pendingSeq: 4,
  });

  const hits = built.parts.filter((p) => p.content === DRAFT);
  assert.equal(hits.length, 1, '待发送内容全文只出现一次');
  assert.equal(hits[0]!.kind, 'pending');
  assert.equal(built.activations.length, 1, '重复注入不得把圣杯条目挤出扫描窗口');

  const historyIds = built.parts.filter((p) => p.kind === 'history').map((p) => p.sourceId);
  assert.deepEqual(historyIds, ['m1', 'm2', 'm3'], 'history 部分不应含待发送的那条');
});

// ===========================================================================
// 三、覆盖导入 = 整体替换（内存层）
// ===========================================================================

function hydrate(base: AppState, sessions: Session[], messages: Message[], snapshots: RequestSnapshot[]): AppState {
  return reducer(base, {
    type: 'hydrate',
    db: { sessions, messages, snapshots, worldBooks: [], presets: [], characters: [], settings: { ...APP_SETTINGS } },
  });
}

const SNAP = (id: string, sessionId: string): RequestSnapshot => ({
  id,
  sessionId,
  createdAt: 1,
  model: 'm',
  parts: [],
  totalTokens: 0,
  contextLimit: 32768,
  activations: [],
  skipped: [],
  scanDepth: 3,
});

test('修复③：session/replace 会用导入包整体替换旧消息与旧快照，且不碰别的会话', () => {
  let state = hydrate(
    initialState,
    [mkSession({ id: 's1' }), mkSession({ id: 's2' })],
    [
      msg(1, 'assistant', '本地旧消息 1', { id: 'old1', sessionId: 's1' }),
      msg(2, 'user', '本地旧消息 2', { id: 'old2', sessionId: 's1' }),
      msg(1, 'user', '别的会话的消息', { id: 'other', sessionId: 's2' }),
    ],
    [SNAP('snap-old', 's1'), SNAP('snap-other', 's2')],
  );

  state = reducer(state, {
    type: 'session/replace',
    session: mkSession({ id: 's1', title: '会话 1' }),
    messages: [msg(1, 'assistant', '导入包里的消息', { id: 'new1', sessionId: 's1' })],
    snapshots: [SNAP('snap-new', 's1')],
  });

  assert.deepEqual(
    state.messages.filter((m) => m.sessionId === 's1').map((m) => m.id),
    ['new1'],
    '覆盖后本地旧消息必须消失（不能新旧混在一起）',
  );
  assert.deepEqual(
    state.snapshots.filter((s) => s.sessionId === 's1').map((s) => s.id),
    ['snap-new'],
  );
  assert.deepEqual(
    state.messages.filter((m) => m.sessionId === 's2').map((m) => m.id),
    ['other'],
    '别的会话不能被覆盖影响',
  );
  assert.deepEqual(state.snapshots.filter((s) => s.sessionId === 's2').map((s) => s.id), ['snap-other']);
});

// ===========================================================================
// 四、导入冲突：不只看会话 ID
// ===========================================================================

const CARD: CharacterCardLite = {
  id: 'char-1',
  name: '角色卡',
  description: '描述',
  firstMes: '开场白',
  raw: {},
};

const BOOK_BUNDLE: WorldBook = {
  id: 'wb-1',
  name: '世界书',
  entries: [{ id: 'e1', name: '条目 1', keys: ['k'], content: '正文', enabled: true, constant: false, priority: 10 }],
  createdAt: 1,
  updatedAt: 1,
};

function bundle() {
  return buildSessionBundle(
    mkSession({ id: 's1', worldBookIds: ['wb-1'] }),
    [msg(1, 'user', '导入包里的消息', { id: 'm1', sessionId: 's1' })],
    [SNAP('snap-1', 's1')],
    CARD,
    [{ ...BOOK_BUNDLE, entries: BOOK_BUNDLE.entries.map((e) => ({ ...e })) }],
  );
}

test('修复④：checkBundle 也检测"非会话资源"的同 ID 冲突，同时保持旧签名行为', () => {
  const b = bundle();

  // 只传会话 ID 列表（旧签名）→ 不误报
  assert.equal(checkBundle(b, ['other']).idConflict, false);
  assert.equal(checkBundle(b, ['s1']).idConflict, true);

  // 传入其它资源的已有 ID → 命中即视为冲突（覆盖模式下这些资源会被替换）
  const c = checkBundle(b, ['other'], { worldBooks: ['wb-1'], messages: ['zzz'] });
  assert.equal(c.ok, true);
  assert.equal(c.idConflict, true);
  assert.deepEqual(c.conflicts?.sessionIds, []);
  assert.deepEqual(c.conflicts?.worldBookIds, ['wb-1']);
  assert.deepEqual(c.conflicts?.messageIds, []);
  assert.deepEqual(c.conflicts?.characterIds, []);
  assert.equal(c.conflicts?.total, 1);

  const d = checkBundle(b, ['s1'], { messages: ['m1'], snapshots: ['snap-1'], characters: ['char-1'] });
  assert.deepEqual(d.conflicts?.sessionIds, ['s1']);
  assert.deepEqual(d.conflicts?.messageIds, ['m1']);
  assert.deepEqual(d.conflicts?.snapshotIds, ['snap-1']);
  assert.deepEqual(d.conflicts?.characterIds, ['char-1']);
  assert.equal(d.conflicts?.total, 4);
});

// ===========================================================================
// 五、角色卡："被忽略的运行规则"要能看到写在条目顶层的那些字段
// ===========================================================================

test('修复⑤：条目顶层写的 ST 运行规则也要出现在"被忽略的运行规则"里', () => {
  const withTopLevelRules = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'X',
      character_book: {
        name: 'B',
        entries: [
          {
            id: 'e1',
            keys: ['a'],
            content: 'c',
            // V2 规范里这些是条目顶层字段；SillyTavern 才会额外镜像进 extensions
            position: 'before_char',
            selective: true,
            secondary_keys: ['b'],
            case_sensitive: true,
          },
        ],
      },
    },
  };
  const r = importCharacterCard(withTopLevelRules);
  assert.ok(r.ok);
  for (const rule of ['position', 'selective', 'secondary_keys', 'case_sensitive']) {
    assert.ok(r.ignoredPresent.includes(rule), `${rule} 应被列为"被忽略的运行规则"`);
  }
  // 本项目**实现**了的字段不许误报
  assert.ok(!r.ignoredPresent.includes('constant'));
  assert.ok(!r.ignoredPresent.includes('enabled'));
});

// ===========================================================================
// 六、上下文提醒阈值：精确比较（不经过四舍五入）
// ===========================================================================

test('修复⑥：80% 阈值用精确比较，79.5% 不得提前告警', () => {
  assert.equal(isOverWarnThreshold(795, 1000, 80), false);
  assert.equal(isOverWarnThreshold(800, 1000, 80), true);
  assert.equal(isOverWarnThreshold(801, 1000, 80), true);
  assert.equal(isOverWarnThreshold(100, 0, 80), false, '上限非法时不告警');
});
