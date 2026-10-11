/**
 * token 估算（不引入 tokenizer 依赖）。
 *
 * 规则（README 已声明这是【估算】，不是精确分词）：
 *   estimate(text) = ceil(CJK 字符数 * 1 + 其他字符数 / 4)
 * 即中日韩字符按 1 token 粗估，其他字符按 4 字符 ≈ 1 token 粗估。
 *
 * 为什么用"字符类"而不是"字节"：模型对 CJK 的分词密度远高于拉丁字母，
 * 按同一套 4 字符 1 token 会严重低估中文上下文占用，导致 80% 提醒永远不出现。
 */

const CJK = /[\u2e80-\u2eff\u2f00-\u2fdf\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31bf\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

export function estimate(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** 世界书预算 = floor(contextLimit * worldBookBudgetPct / 100)。 */
export function worldBookBudget(contextLimit: number, pct: number): number {
  const limit = Number.isFinite(contextLimit) ? contextLimit : 0;
  const p = Number.isFinite(pct) ? pct : 0;
  return Math.max(0, Math.floor((limit * p) / 100));
}

/** 扫描深度钳制：范围 1–100；0 / 负数 / 非有限值 → 1，超过 100 → 100。 */
export function clampScanDepth(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const v = Math.floor(n);
  if (v < 1) return 1;
  if (v > 100) return 100;
  return v;
}

/** 是否达到"上下文快满"提醒阈值（整数百分比比较，不存在 0.8 这种小数口径）。 */
export function isOverWarnThreshold(used: number, limit: number, warnPct: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return (used * 100) / limit >= warnPct;
}
