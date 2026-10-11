/**
 * {{变量}} 模板展开（等级 4，但预设模块的 template 开关会用到，故一并实现）。
 *
 * 支持语法（README 声明）：
 *   {{name}}                          —— 简单变量替换
 *   {{#if name < 20}}...{{/if}}       —— 单层条件块，支持 < > <= >= == !=
 *   {{#if flag}}...{{/if}}            —— 布尔判断（'' / '0' / 'false' 视为假）
 *
 * 变量缺失时的处理：**保留原样 {{name}}**，并把它记进 `missing` 数组供 UI 告警。
 * 条件块里变量缺失 ⇒ 条件判为假，同样记入 missing。
 * 不做嵌套 if、不做表达式求值、不做函数调用（"无需完整实现 EJS"）。
 */

export interface ExpandResult {
  text: string;
  missing: string[];
}

const IF_BLOCK = /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/;
const VAR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const CMP = /^([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|==|!=|<|>)\s*(.+)$/;

function truthy(v: string): boolean {
  return !(v === '' || v === '0' || v.toLowerCase() === 'false');
}

function evalCondition(expr: string, vars: Record<string, string>, missing: Set<string>): boolean {
  const m = CMP.exec(expr.trim());
  if (!m) {
    const name = expr.trim();
    const v = vars[name];
    if (v === undefined) {
      missing.add(name);
      return false;
    }
    return truthy(v);
  }
  const name = m[1];
  const op = m[2];
  const rhs = m[3].trim();
  const lv = vars[name];
  if (lv === undefined) {
    missing.add(name);
    return false;
  }
  const ln = Number(lv);
  const rn = Number(rhs);
  if (Number.isFinite(ln) && Number.isFinite(rn)) {
    if (op === '<') return ln < rn;
    if (op === '>') return ln > rn;
    if (op === '<=') return ln <= rn;
    if (op === '>=') return ln >= rn;
    if (op === '==') return ln === rn;
    if (op === '!=') return ln !== rn;
  }
  const rr = rhs.replace(/^["']|["']$/g, '');
  if (op === '==') return lv === rr;
  if (op === '!=') return lv !== rr;
  return false;
}

export function expandTemplate(text: string, vars: Record<string, string>): ExpandResult {
  const missing = new Set<string>();
  let out = text;

  // 反复收敛最内层 if 块（支持同层多个 if，不支持嵌套 if）
  for (let guard = 0; guard < 100; guard += 1) {
    const m = IF_BLOCK.exec(out);
    if (!m) break;
    const keep = evalCondition(m[1], vars, missing);
    out = out.slice(0, m.index) + (keep ? m[2] : '') + out.slice(m.index + m[0].length);
  }

  out = out.replace(VAR, (full, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    missing.add(name);
    return full;
  });

  return { text: out, missing: [...missing] };
}
