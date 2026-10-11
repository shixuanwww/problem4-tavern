import type { CharacterCardLite, WorldBook, WorldBookEntry } from './types.ts';
import { cryptoRandomId } from './assembly.ts';

/**
 * Character Card V2 的【明确子集】导入 / 导出 —— 纯函数。
 *
 * 支持的子集（题面指定）：名称、描述、开场白、内嵌世界书。
 * 未支持的字段与未知 extensions：导入时忽略、但把整份 raw 原样保留，导出时写回 ⇒ 不丢数据。
 */

export const SUPPORTED_SPEC = 'chara_card_v2';
export const SUPPORTED_VERSION_RE = /^2\./;

/** UI 上要原样展示的字段映射表。 */
export const FIELD_MAPPING: { from: string; to: string; note: string }[] = [
  { from: 'spec / spec_version', to: '校验用', note: '须为 chara_card_v2 / 2.x，否则报"不支持的格式版本"' },
  { from: 'data.name', to: 'CharacterCardLite.name', note: '' },
  { from: 'data.description', to: 'CharacterCardLite.description', note: '' },
  { from: 'data.first_mes', to: 'CharacterCardLite.firstMes（开场白）', note: '也接受 data.first_message 别名' },
  { from: 'data.character_book.name', to: 'WorldBook.name', note: '内嵌世界书' },
  { from: 'data.character_book.entries[].id', to: 'WorldBookEntry.id', note: '缺失时用数组下标补齐，补齐值一律转字符串' },
  { from: 'data.character_book.entries[].keys', to: 'WorldBookEntry.keys', note: '' },
  { from: 'data.character_book.entries[].content', to: 'WorldBookEntry.content', note: '' },
  { from: 'data.character_book.entries[].name / .comment', to: 'WorldBookEntry.name', note: '取 name，为空时退化到 comment' },
  { from: 'data.character_book.entries[].enabled', to: 'WorldBookEntry.enabled', note: '⚠️ 方向一致，不要取反' },
  { from: 'data.character_book.entries[].constant', to: 'WorldBookEntry.constant', note: '' },
  { from: 'data.character_book.entries[].insertion_order', to: 'WorldBookEntry.priority', note: '' },
  { from: 'data.character_book.entries[].extensions.*', to: '忽略但保留', note: '在"被忽略的运行规则"里说明' },
];

/** 被忽略的运行规则（导入预览必须列出）。 */
export const IGNORED_RULES = [
  'secondary_keys',
  'selective',
  'selectiveLogic',
  'position',
  'case_sensitive',
  'match_whole_words',
  'probability',
  'sticky',
  'cooldown',
  'delay',
  'group',
  'group_weight',
  'scan_depth',
  'vectorized',
];

export interface CardImportOk {
  ok: true;
  card: CharacterCardLite;
  /** 内嵌世界书（若无则不返回）。 */
  worldBook?: WorldBook;
  /** 导入过程中发现的非致命问题（如 id 缺失已补齐）。 */
  warnings: string[];
  /** 本次实际出现且被忽略的运行规则（∩ IGNORED_RULES）。 */
  ignoredPresent: string[];
}

export interface CardImportErr {
  ok: false;
  errors: string[];
  /** 重复 id 明细（同时给出条目序号，尽力给原文行号）。 */
  duplicates: { id: string; indices: number[]; lines: number[] }[];
}

export type CardImportResult = CardImportOk | CardImportErr;

/** JSON 文本解析 + 语法错误定位（行/列）。 */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const msg = (e as Error).message;
    const pm = /position (\d+)/.exec(msg);
    if (pm) {
      const pos = Number(pm[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      return { ok: false, error: `JSON 语法错误：${msg}（第 ${line} 行，第 ${col} 列）` };
    }
    return { ok: false, error: `JSON 语法错误：${msg}` };
  }
}

/** 尽力在原文里找出每个 id 字面量出现的行号（原生 JSON.parse 拿不到位置，只能自己扫）。 */
function locateIdLines(text: string, ids: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const id of ids) {
    const needle = `"${id}"`;
    const lines: number[] = [];
    let from = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      lines.push(text.slice(0, at).split('\n').length);
      from = at + needle.length;
    }
    if (lines.length > 0) out.set(id, lines);
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function importCharacterCard(raw: unknown, rawText?: string): CardImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(raw)) {
    return { ok: false, errors: ['角色卡顶层必须是 JSON 对象'], duplicates: [] };
  }

  const spec = raw.spec;
  if (spec !== SUPPORTED_SPEC) {
    errors.push(
      `不支持的格式规范：spec = ${JSON.stringify(spec ?? null)}（本项目仅支持 ${SUPPORTED_SPEC}）`,
    );
  }
  const specVersion = raw.spec_version;
  if (typeof specVersion !== 'string' || !SUPPORTED_VERSION_RE.test(specVersion)) {
    errors.push(
      `不支持的格式版本：spec_version = ${JSON.stringify(specVersion ?? null)}（仅支持 2.x，本项目不支持 V1 的 1.0）`,
    );
  }

  const data = raw.data;
  if (!isObj(data)) {
    errors.push('字段 data 类型错误：期望对象（V2 把内容都放在 data 下）');
    return { ok: false, errors, duplicates: [] };
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('字段 data.name 类型错误：期望非空字符串');
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    errors.push('字段 data.description 类型错误：期望字符串');
  }

  let firstMes: unknown = data.first_mes;
  if (firstMes === undefined) firstMes = data.first_message; // 别名
  if (firstMes !== undefined && typeof firstMes !== 'string') {
    errors.push('字段 data.first_mes 类型错误：期望字符串');
  }

  // ---- 内嵌世界书 ---------------------------------------------------------
  let worldBook: WorldBook | undefined;
  let duplicates: { id: string; indices: number[]; lines: number[] }[] = [];
  const ignoredPresent = new Set<string>();

  const book = data.character_book;
  if (book !== undefined) {
    if (!isObj(book)) {
      errors.push('字段 data.character_book 类型错误：期望对象');
    } else {
      const bookName = typeof book.name === 'string' && book.name ? book.name : '（未命名世界书）';
      if (book.entries !== undefined && !Array.isArray(book.entries)) {
        errors.push('字段 data.character_book.entries 类型错误：期望数组');
      } else {
        const rawEntries = Array.isArray(book.entries) ? book.entries : [];
        const entries: WorldBookEntry[] = [];
        const idToIndices = new Map<string, number[]>();

        rawEntries.forEach((e: unknown, i: number) => {
          if (!isObj(e)) {
            errors.push(`字段 data.character_book.entries[${i}] 类型错误：期望对象`);
            return;
          }
          let id: string;
          if (typeof e.id === 'string') id = e.id;
          else if (typeof e.id === 'number') id = String(e.id);
          else {
            id = String(i);
            warnings.push(`entries[${i}] 缺少 id，已用数组下标补齐为 "${id}"`);
          }

          if (e.keys !== undefined && !Array.isArray(e.keys)) {
            errors.push(`字段 data.character_book.entries[${i}].keys 类型错误：期望字符串数组`);
          }
          const keysRaw = Array.isArray(e.keys) ? e.keys : [];
          const keys: string[] = [];
          keysRaw.forEach((k: unknown, ki: number) => {
            if (typeof k === 'string') keys.push(k);
            else errors.push(`字段 data.character_book.entries[${i}].keys[${ki}] 类型错误：期望字符串`);
          });

          if (e.content !== undefined && typeof e.content !== 'string') {
            errors.push(`字段 data.character_book.entries[${i}].content 类型错误：期望字符串`);
          }

          const name =
            (typeof e.name === 'string' && e.name) ||
            (typeof e.comment === 'string' && e.comment) ||
            `条目 ${i + 1}`;

          entries.push({
            id,
            name,
            keys,
            content: typeof e.content === 'string' ? e.content : '',
            enabled: e.enabled === undefined ? true : Boolean(e.enabled),
            constant: Boolean(e.constant),
            priority: typeof e.insertion_order === 'number' ? e.insertion_order : 0,
          });

          const list = idToIndices.get(id) ?? [];
          list.push(i);
          idToIndices.set(id, list);

          /**
           * 记录本次实际出现的、会被忽略的运行规则。
           *
           * 🔴 V2 的 `character_book.entries[]` 里这些字段【按规范是条目顶层字段】
           *    （`position` / `selective` / `secondary_keys` / `case_sensitive` …），
           *    SillyTavern 导出时才会额外镜像一份进 `extensions`。所以两处都要看：
           *    只看 `extensions` 会漏报"手写卡只写顶层字段"的情况，预览就不再如实。
           */
          for (const r of IGNORED_RULES) {
            if (isObj(e.extensions) && r in e.extensions) ignoredPresent.add(r);
            else if (r in e && e[r] !== undefined) ignoredPresent.add(r);
          }
          if (typeof e.extensions === 'object' && e.extensions !== null) ignoredPresent.add('extensions.*');
        });

        const dupIds = [...idToIndices.entries()].filter(([, idxs]) => idxs.length > 1);
        if (dupIds.length > 0) {
          const lines = rawText ? locateIdLines(rawText, dupIds.map(([id]) => id)) : new Map<string, number[]>();
          duplicates = dupIds.map(([id, indices]) => ({
            id,
            indices,
            lines: lines.get(id) ?? [],
          }));
          for (const d of duplicates) {
            const lineInfo = d.lines.length > 0 ? `（原文行号约 ${d.lines.join(', ')}）` : '（未能定位原文行号）';
            errors.push(
              `data.character_book.entries 存在重复 id："${d.id}"，出现在条目序号 ${d.indices.join(', ')}${lineInfo}`,
            );
          }
        }

        worldBook = {
          id: cryptoRandomId(),
          name: bookName,
          entries,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, duplicates };

  const card: CharacterCardLite = {
    id: cryptoRandomId(),
    name: (data.name as string).trim(),
    description: typeof data.description === 'string' ? data.description : '',
    firstMes: typeof firstMes === 'string' ? firstMes : '',
    raw,
    specVersion: typeof specVersion === 'string' ? specVersion : undefined,
  };

  return { ok: true, card, worldBook, warnings, ignoredPresent: [...ignoredPresent] };
}

/**
 * 导出：以导入时的 raw 为基底，把已编辑的可映射字段写回，其余字段与未知 extensions 原样保留。
 */
export function exportCharacterCard(card: CharacterCardLite, worldBook?: WorldBook): unknown {
  const base = isObj(card.raw) ? (JSON.parse(JSON.stringify(card.raw)) as Record<string, unknown>) : {};
  const data = isObj(base.data) ? (base.data as Record<string, unknown>) : {};
  base.spec = SUPPORTED_SPEC;
  base.spec_version = typeof card.specVersion === 'string' ? card.specVersion : '2.0';
  data.name = card.name;
  data.description = card.description;
  data.first_mes = card.firstMes;
  base.data = data;

  if (worldBook) {
    const book = isObj(data.character_book) ? (data.character_book as Record<string, unknown>) : {};
    book.name = worldBook.name;
    const prevEntries = Array.isArray(book.entries) ? (book.entries as unknown[]) : [];
    book.entries = worldBook.entries.map((e) => {
      const prev = prevEntries.find((p) => isObj(p) && String((p as Record<string, unknown>).id) === e.id);
      const out: Record<string, unknown> = isObj(prev) ? { ...(prev as Record<string, unknown>) } : {};
      out.id = e.id;
      out.keys = e.keys;
      out.content = e.content;
      out.name = e.name;
      out.enabled = e.enabled;
      out.constant = e.constant;
      out.insertion_order = e.priority;
      return out;
    });
    data.character_book = book;
  }

  return base;
}

/** 内部工具：判断给定 json 是否为 V2 形态（UI 选择文件后的一次粗判）。 */
export function looksLikeV2(raw: unknown): boolean {
  return isObj(raw) && raw.spec === SUPPORTED_SPEC;
}
