import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AppSettings,
  CharacterCardLite,
  Message,
  RequestSnapshot,
  Session,
  WorldBook,
} from '../src/core/types.ts';
import {
  finalStreamStatus,
  orderedSessionMessages,
  planRetry,
  repairStreamingMessages,
} from '../src/core/messaging.ts';
import { initialState, reducer, type AppState } from '../src/state/actions.ts';
import { buildSessionBundle, checkBundle, copyTitle, planImport } from '../src/storage/repo.ts';
import { createSseDecoder, deltaFromSseLine, pickDelta } from '../src/core/llm.ts';

/**
 * 本文件补的是题面【等级 1】里被点名的四条"必须正确处理"：
 *   - 重试不重复插入同一条用户消息            → planRetry
 *   - 未完成的助手回复默认不进后续上下文      → 已由 tests/assembly.test.ts #7 覆盖
 *   - 生成中切换会话，结果仍属于发起请求的会话 → reducer（state/actions.ts）
 *   - 刷新打断的生成应标为中断，不能永远停在生成中 → repairStreamingMessages
 * 外加两条同样属于 L1 的交付行为：会话导入的"覆盖 / 创建副本"与流式的分块边界解析。
 *
 * 这些规则原先只写在 state/store.tsx（依赖 React）与 storage/repo.ts（依赖 IndexedDB）里，
 * Node 内置 test runner 一条也碰不到；现在判定被抽成纯函数，于是可以在这里钉死。
 */

const SESSION_SETTINGS = {
  scanDepth: 4,
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
    characterCardId: 'char-1',
    worldBookIds: [],
    settings: { ...SESSION_SETTINGS },
    ...over,
  };
}

function msg(seq: number, role: Message['role'], over: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    sessionId: 's1',
    role,
    content: `内容 ${seq}`,
    createdAt: seq,
    status: 'complete',
    uiHidden: false,
    excluded: false,
    seq,
    ...over,
  };
}

// ===========================================================================
// 一、重试不重复插入同一条用户消息
// ===========================================================================

test('L1 重试：锚点是最后一条 user，要丢弃的只有它之后的 assistant', () => {
  const messages = [
    msg(1, 'assistant', { content: '开场白' }),
    msg(2, 'user'),
    msg(3, 'assistant'),
    msg(4, 'user'),
    msg(5, 'assistant', { status: 'interrupted' }),
  ];
  const plan = planRetry(messages, 's1');
  assert.ok(plan, '有 user 消息就必须给出计划');
  assert.equal(plan.anchor.id, 'm4');
  assert.equal(plan.anchor.seq, 4);
  assert.deepEqual(plan.dropIds, ['m5'], '只丢锚点之后的失败回复');
});

test('L1 重试：锚点自己既不在 dropIds 里，也不会被重新创建（用户消息条数恒等）', () => {
  const before = [msg(1, 'assistant'), msg(2, 'user'), msg(3, 'assistant')];
  const plan = planRetry(before, 's1')!;
  assert.ok(!plan.dropIds.includes(plan.anchor.id), '锚点不许出现在待删列表里');

  // 忠实模拟 store 的真实链路：
  //   ① 删掉 dropIds（失败的 assistant）
  //   ② 用锚点的 content / seq 发起生成 —— 锚点本身**不会**被重新插入
  //   ③ store 给新 assistant 分配 seq = anchor.seq + 1
  const afterDelete = before.filter((m) => !plan.dropIds.includes(m.id));
  const regenerated = msg(plan.anchor.seq + 1, 'assistant', { id: 'new-a', status: 'streaming', content: '' });
  const after = [...afterDelete, regenerated];

  const userMessages = after.filter((m) => m.role === 'user');
  assert.equal(userMessages.length, 1, '重试前后 user 消息必须恒为 1 条');
  assert.equal(userMessages[0]!.id, plan.anchor.id);
  assert.equal(userMessages[0]!.seq, plan.anchor.seq);
  assert.deepEqual(afterDelete.map((m) => m.id), ['m1', 'm2'], '被删的只有 m3（失败的 assistant）');
  assert.deepEqual(after.map((m) => m.seq), [1, 2, 3], 'seq 既不跳号也不重号');
});

test('L1 重试：该会话还没有 user 消息 → 不重试（返回 null，不误建消息）', () => {
  assert.equal(planRetry([msg(1, 'assistant', { content: '开场白' })], 's1'), null);
  assert.equal(planRetry([], 's1'), null);
});

test('L1 重试：锚点后面没有消息 → dropIds 为空（不误删任何东西）', () => {
  const plan = planRetry([msg(1, 'assistant'), msg(2, 'user')], 's1')!;
  assert.deepEqual(plan.dropIds, []);
});

test('L1 重试：多会话混放时，锚点与待删消息都限定在目标会话内', () => {
  const messages = [
    msg(1, 'user', { sessionId: 's1', id: 'a1' }),
    msg(2, 'assistant', { sessionId: 's1', id: 'a2' }),
    msg(3, 'user', { sessionId: 's2', id: 'b1' }),
    msg(4, 'assistant', { sessionId: 's2', id: 'b2' }),
  ];
  const plan = planRetry(messages, 's1')!;
  assert.equal(plan.anchor.id, 'a1');
  assert.deepEqual(plan.dropIds, ['a2'], '绝不能把 s2 的消息算进来');
});

test('L1 重试：界面隐藏 / 不进上下文 / 中断的回复都属于"要被重试掉"的尾部', () => {
  const messages = [
    msg(1, 'user'),
    msg(2, 'assistant', { uiHidden: true }),
    msg(3, 'assistant', { excluded: true }),
    msg(4, 'assistant', { status: 'interrupted' }),
  ];
  const plan = planRetry(messages, 's1')!;
  assert.deepEqual(plan.dropIds, ['m2', 'm3', 'm4']);
});

test('L1 重试：排序按 seq，与数组里传入的顺序无关', () => {
  const shuffled = [msg(3, 'assistant'), msg(1, 'user'), msg(2, 'assistant')];
  const plan = planRetry(shuffled, 's1')!;
  assert.equal(plan.anchor.id, 'm1');
  assert.deepEqual(plan.dropIds, ['m2', 'm3']);
  assert.deepEqual(
    orderedSessionMessages(shuffled, 's1').map((m) => m.id),
    ['m1', 'm2', 'm3'],
  );
});

// ===========================================================================
// 二、生成中切换会话，后续结果仍属于发起请求的会话
// ===========================================================================

function hydrateState(base: AppState, sessions: Session[], messages: Message[]): AppState {
  return reducer(base, {
    type: 'hydrate',
    db: {
      sessions,
      messages,
      worldBooks: [],
      presets: [],
      characters: [],
      snapshots: [],
      settings: { ...APP_SETTINGS },
    },
  });
}

test('L1 切会话：生成中切到别的会话，流式增量仍然长在发起请求的那条消息上', () => {
  const s1 = mkSession({ id: 's1', updatedAt: 10 });
  const s2 = mkSession({ id: 's2', updatedAt: 20 });
  const a1 = msg(1, 'assistant', { id: 'a1', sessionId: 's1', status: 'streaming', content: '' });

  let state = hydrateState(initialState, [s1, s2], [a1]);
  state = reducer(state, { type: 'generating/set', sessionId: 's1', messageId: 'a1' });

  // 用户切到 s2 —— 这一步不得影响正在跑的 s1
  state = reducer(state, { type: 'session/activate', id: 's2' });
  assert.equal(state.activeSessionId, 's2');

  // s1 的流继续到达
  state = reducer(state, { type: 'message/append', id: 'a1', chunk: '第一段' });
  state = reducer(state, { type: 'message/append', id: 'a1', chunk: '第二段' });

  const appended = state.messages.find((m) => m.id === 'a1')!;
  assert.equal(appended.content, '第一段第二段');
  assert.equal(appended.sessionId, 's1', '结果必须仍归属发起请求的会话');
  assert.equal(state.activeSessionId, 's2', '切会话不该把用户拽回去');
});

test('L1 切会话：generating 按会话分桶，互不覆盖', () => {
  let state = hydrateState(initialState, [mkSession({ id: 's1' }), mkSession({ id: 's2' })], []);
  state = reducer(state, { type: 'generating/set', sessionId: 's1', messageId: 'a1' });
  state = reducer(state, { type: 'generating/set', sessionId: 's2', messageId: 'b1' });
  assert.deepEqual(state.generating, { s1: 'a1', s2: 'b1' });

  // s1 收尾，只清 s1 的桶
  state = reducer(state, { type: 'generating/set', sessionId: 's1', messageId: null });
  assert.deepEqual(state.generating, { s2: 'b1' }, 's2 的生成状态不该被 s1 收尾清掉');
});

test('L1 切会话：删会话会清掉它的 generating 与错误，但不碰另一个会话', () => {
  let state = hydrateState(initialState, [mkSession({ id: 's1' }), mkSession({ id: 's2' })], [
    msg(1, 'user', { id: 'a1', sessionId: 's1' }),
    msg(1, 'user', { id: 'b1', sessionId: 's2' }),
  ]);
  state = reducer(state, { type: 'generating/set', sessionId: 's1', messageId: 'a1' });
  state = reducer(state, { type: 'error/set', sessionId: 's1', text: '接口 500' });
  state = reducer(state, { type: 'error/set', sessionId: 's2', text: '接口 502' });

  state = reducer(state, { type: 'session/remove', id: 's1' });

  assert.deepEqual(state.sessions.map((s) => s.id), ['s2']);
  assert.deepEqual(state.messages.map((m) => m.id), ['b1'], '只级联删 s1 的消息');
  assert.equal(state.generating['s1'], undefined);
  assert.equal(state.errors['s1'], undefined);
  assert.equal(state.errors['s2'], '接口 502');
});

test('L1 切会话：水合时优先恢复"上次激活的会话"，它不存在时回落到最近更新的那个', () => {
  const older = mkSession({ id: 's-old', updatedAt: 10 });
  const newer = mkSession({ id: 's-new', updatedAt: 20 });

  const preferred = reducer(initialState, {
    type: 'hydrate',
    db: {
      sessions: [older, newer],
      messages: [],
      worldBooks: [],
      presets: [],
      characters: [],
      snapshots: [],
      settings: { ...APP_SETTINGS },
    },
    preferredActiveId: 's-old',
  });
  assert.equal(preferred.activeSessionId, 's-old');

  const fallback = hydrateState(initialState, [older, newer], []);
  assert.equal(fallback.activeSessionId, 's-new', '没有有效偏好时激活最近更新的会话');
});

// ===========================================================================
// 三、刷新打断的生成必须标为中断
// ===========================================================================

test('L1 中断：启动时把还停在 streaming 的消息标成 interrupted，并保留已收到的正文', () => {
  const rows = [
    msg(1, 'user'),
    msg(2, 'assistant', { id: 'a2', status: 'streaming', content: '已经收到的半句' }),
    msg(3, 'assistant', { id: 'a3', status: 'complete', content: '完整回复' }),
    msg(4, 'assistant', { id: 'a4', status: 'interrupted', content: '上次就中断了' }),
  ];
  const fixed = repairStreamingMessages(rows);
  assert.equal(fixed.length, 1, '只修 streaming 的那条');
  assert.equal(fixed[0]!.id, 'a2');
  assert.equal(fixed[0]!.status, 'interrupted');
  assert.equal(fixed[0]!.content, '已经收到的半句', '不许把已收到的内容丢掉');
});

test('L1 中断：没有 streaming 时返回空数组（repo 据此跳过写库）', () => {
  assert.deepEqual(repairStreamingMessages([msg(1, 'user'), msg(2, 'assistant')]), []);
});

test('L1 中断：收尾状态只有 complete / interrupted 两种，不存在"永远生成中"', () => {
  assert.equal(finalStreamStatus(true, false), 'complete', '读到流尾且未被中止');
  assert.equal(finalStreamStatus(false, false), 'interrupted', '流在结束前断了（刷新打断）');
  assert.equal(finalStreamStatus(true, true), 'interrupted', '用户点了停止');
  assert.equal(finalStreamStatus(false, true), 'interrupted');
});

// ===========================================================================
// 四、会话导入：覆盖 / 创建副本（L1「明确区分覆盖与创建副本」）
// ===========================================================================

const CARD: CharacterCardLite = {
  id: 'char-1',
  name: '角色卡',
  description: '描述',
  firstMes: '开场白',
  raw: { unknown_field: 1 },
};

const BOOK: WorldBook = {
  id: 'wb-1',
  name: '世界书',
  entries: [
    { id: 'e1', name: '条目 1', keys: ['k'], content: '正文', enabled: true, constant: false, priority: 10 },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const SNAPSHOT: RequestSnapshot = {
  id: 'snap-1',
  sessionId: 's1',
  createdAt: 1,
  model: 'test-model',
  parts: [],
  totalTokens: 0,
  contextLimit: 32768,
  activations: [],
  skipped: [],
  scanDepth: 4,
};

function bundle(): ReturnType<typeof buildSessionBundle> {
  return buildSessionBundle(
    mkSession({ id: 's1', worldBookIds: ['wb-1'] }),
    [msg(1, 'user', { id: 'm1', sessionId: 's1' })],
    [{ ...SNAPSHOT }],
    CARD,
    [{ ...BOOK, entries: BOOK.entries.map((e) => ({ ...e })) }],
  );
}

test('L1 导入：格式标识 / 版本 / 结构不对都必须明确报错，而不是"尽力而为"', () => {
  const b = bundle();
  assert.equal(checkBundle(b, []).ok, true);

  const wrongFormat = checkBundle({ ...b, format: 'sillytavern' }, []);
  assert.equal(wrongFormat.ok, false);
  assert.match(String(wrongFormat.error), /格式标识不匹配/);

  const wrongVersion = checkBundle({ ...b, formatVersion: '2.0' }, []);
  assert.equal(wrongVersion.ok, false);
  assert.match(String(wrongVersion.error), /不支持的格式版本/);

  const noSessionId = checkBundle({ ...b, session: { title: '无 id' } }, []);
  assert.equal(noSessionId.ok, false);
  assert.match(String(noSessionId.error), /session/);

  assert.match(String(checkBundle({ ...b, messages: {} }, []).error), /messages/);
  assert.match(String(checkBundle({ ...b, snapshots: null }, []).error), /snapshots/);
  assert.equal(checkBundle('not an object', []).ok, false);
});

test('L1 导入：同 ID 冲突必须被识别出来（UI 据此弹"覆盖 / 创建副本 / 取消"）', () => {
  assert.equal(checkBundle(bundle(), ['s1']).idConflict, true);
  assert.equal(checkBundle(bundle(), ['other']).idConflict, false);
});

test('L1 导入：副本标题递增，且不会把「（副本 2）」叠成「（副本 2）（副本 2）」', () => {
  assert.equal(copyTitle('会话 1', []), '会话 1（副本 2）');
  assert.equal(copyTitle('会话 1', ['会话 1（副本 2）']), '会话 1（副本 3）');
  assert.equal(copyTitle('会话 1', ['会话 1（副本 2）', '会话 1（副本 3）']), '会话 1（副本 4）');
  assert.equal(copyTitle('会话 1（副本 2）', []), '会话 1（副本 2）', '已有后缀先剥离再算');
});

test('L1 导入：覆盖模式沿用原 ID（就是覆盖同一个会话）', () => {
  const plan = planImport(bundle(), 'overwrite', []);
  assert.equal(plan.session.id, 's1');
  assert.equal(plan.session.title, '会话 1');
  assert.equal(plan.messages[0]!.id, 'm1');
  assert.equal(plan.characterCard!.id, 'char-1');
  assert.equal(plan.worldBooks![0]!.id, 'wb-1');
  assert.deepEqual(plan.idMap, {});
});

test('L1 导入：副本模式全部重新分配 ID，且引用一次性重写、不留悬空', () => {
  const src = bundle();
  const plan = planImport(src, 'copy', ['会话 1（副本 2）']);

  // 1) ID 全部换新
  assert.notEqual(plan.session.id, 's1');
  assert.notEqual(plan.messages[0]!.id, 'm1');
  assert.notEqual(plan.snapshots[0]!.id, 'snap-1');
  assert.notEqual(plan.characterCard!.id, 'char-1');
  assert.notEqual(plan.worldBooks![0]!.id, 'wb-1');
  assert.notEqual(plan.worldBooks![0]!.entries[0]!.id, 'e1');

  // 2) 标题按冲突递增
  assert.equal(plan.session.title, '会话 1（副本 3）');

  // 3) 引用一致性：所有指向别处资源的字段都必须用**同一张 idMap** 的新值
  assert.equal(plan.messages[0]!.sessionId, plan.session.id);
  assert.equal(plan.snapshots[0]!.sessionId, plan.session.id);
  assert.equal(plan.session.characterCardId, plan.characterCard!.id);
  assert.deepEqual(plan.session.worldBookIds, [plan.worldBooks![0]!.id]);
  assert.equal(plan.idMap['m1'], plan.messages[0]!.id);
  assert.equal(plan.idMap['char-1'], plan.characterCard!.id);
  assert.equal(plan.idMap['e1'], plan.worldBooks![0]!.entries[0]!.id);
});

test('L1 导入：副本模式不产生悬空引用（引用到的 ID 必须都在本次写入集合里）', () => {
  const plan = planImport(bundle(), 'copy', []);
  const written = new Set<string>([
    plan.session.id,
    ...plan.messages.map((m) => m.id),
    ...plan.snapshots.map((s) => s.id),
    ...(plan.characterCard ? [plan.characterCard.id] : []),
    ...(plan.worldBooks ?? []).flatMap((wb) => [wb.id, ...wb.entries.map((e) => e.id)]),
  ]);

  const referenced = [
    ...(plan.session.characterCardId ? [plan.session.characterCardId] : []),
    ...plan.session.worldBookIds,
    ...plan.messages.map((m) => m.sessionId),
    ...plan.snapshots.map((s) => s.sessionId),
  ];
  for (const id of referenced) {
    assert.ok(written.has(id), `引用 ${id} 必须存在于本次写入的资源里`);
  }
});

// ===========================================================================
// 五、流式的分块边界（L1「逐步展示 ai 的回复」）
// ===========================================================================

/** 与真实网关一致的分块形状（本机用 /llm 代理实测抓到的就是这三段） */
function chunkOf(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function collect(chunks: string[]): string {
  let out = '';
  const dec = createSseDecoder((d) => {
    out += d;
  });
  for (const c of chunks) dec.push(c);
  dec.flush();
  return out;
}

test('L1 流式：按真实分块喂进来能拼回完整正文', () => {
  assert.equal(collect([chunkOf('1, '), chunkOf('2, '), chunkOf('3')]), '1, 2, 3');
});

test('L1 流式：一个分块里含多行 data: 时全部取出', () => {
  assert.equal(collect([chunkOf('A') + chunkOf('B') + chunkOf('C')]), 'ABC');
});

test('L1 流式：一行被切在两个网络分块之间时，不许丢内容', () => {
  const whole = chunkOf('半个分块也不能丢');
  const cut = Math.floor(whole.length / 2);
  assert.equal(
    collect([whole.slice(0, cut), whole.slice(cut)]),
    '半个分块也不能丢',
    '按块直接 JSON.parse 的写法会在这里丢字，所以必须保留 buffer',
  );

  // 极端：一次只喂 1 个字符
  const perChar = whole.split('');
  assert.equal(collect(perChar), '半个分块也不能丢');
});

test('L1 流式：[DONE] / 心跳 / 坏 JSON / 非 data 行一律安静跳过，不抛异常', () => {
  const chunks = [
    ': keep-alive\n\n',
    'event: message\n',
    'data: [DONE]\n\n',
    'data: {坏 JSON\n\n',
    'data:\n\n',
    chunkOf('正常内容'),
    '\n',
  ];
  assert.equal(collect(chunks), '正常内容');
});

test('L1 流式：流结束时最后一行没有换行结尾，flush 也要取出', () => {
  const noTrailingNewline = `data: ${JSON.stringify({ choices: [{ delta: { content: '结尾' } }] })}`;
  assert.equal(collect([chunkOf('开头'), noTrailingNewline]), '开头结尾');
});

test('L1 流式：pickDelta 兼容流式 delta / 非流式 message / text 三种形状', () => {
  assert.equal(pickDelta({ choices: [{ delta: { content: 'x' } }] }), 'x');
  assert.equal(pickDelta({ choices: [{ message: { content: 'y' } }] }), 'y');
  assert.equal(pickDelta({ choices: [{ text: 'z' }] }), 'z');
  assert.equal(pickDelta({ choices: [] }), '');
  assert.equal(pickDelta({}), '');
  assert.equal(pickDelta({ choices: [{ delta: { content: 123 } }] }), '', '类型不对就当没有增量');
});

test('L1 流式：deltaFromSseLine 对空 data 行与注释行返回空串', () => {
  assert.equal(deltaFromSseLine('data:'), '');
  assert.equal(deltaFromSseLine('data:   '), '');
  assert.equal(deltaFromSseLine('data: [DONE]'), '');
  assert.equal(deltaFromSseLine('  : heartbeat'), '');
  assert.equal(deltaFromSseLine('data: {"choices":[{"delta":{"content":"a"}}]}'), 'a');
});
