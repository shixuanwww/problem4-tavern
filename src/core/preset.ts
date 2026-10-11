import type { Preset, PresetModule } from './types.ts';

/**
 * 预设导入 / 校验 —— 纯函数。
 *
 * 🔴 "新预设符合已有格式时，不修改业务代码即可使用" ⇒ 模块必须【数据驱动】：
 *    本项目代码里不存在任何硬编码的模块名（如"人设""越狱"）；
 *    渲染、启停、排序、参与编排全部由 modules 数组驱动。
 */

export const PRESET_FORMAT = 'st-lite';
export const PRESET_VERSION = '1.0';
export const SUPPORTED_PRESET_VERSIONS = ['1.0'];

const ROLES = ['system', 'user', 'assistant'];
const POSITIONS = ['system', 'postHistory'];

export interface PresetParseOk {
  ok: true;
  preset: Preset;
}
export interface PresetParseErr {
  ok: false;
  errors: string[];
}
export type PresetParseResult = PresetParseOk | PresetParseErr;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parsePreset(input: unknown): PresetParseResult {
  const errors: string[] = [];

  if (!isObj(input)) return { ok: false, errors: ['预设顶层必须是 JSON 对象'] };

  if (input.format !== PRESET_FORMAT) {
    errors.push(`字段 format 不匹配：期望 "${PRESET_FORMAT}"，实际 ${JSON.stringify(input.format ?? null)}`);
  }
  if (typeof input.formatVersion !== 'string' || !SUPPORTED_PRESET_VERSIONS.includes(input.formatVersion)) {
    errors.push(
      `不支持的 formatVersion：${JSON.stringify(input.formatVersion ?? null)}（支持 ${SUPPORTED_PRESET_VERSIONS.join(' / ')}）`,
    );
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    errors.push('字段 id 类型错误：期望非空字符串');
  }
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    errors.push('字段 name 类型错误：期望非空字符串');
  }
  if (!Array.isArray(input.modules)) {
    errors.push('字段 modules 类型错误：期望数组');
  }

  const modules: PresetModule[] = [];
  if (Array.isArray(input.modules)) {
    input.modules.forEach((m: unknown, i: number) => {
      if (!isObj(m)) {
        errors.push(`字段 modules[${i}] 类型错误：期望对象`);
        return;
      }
      if (typeof m.id !== 'string' || m.id.trim() === '') errors.push(`字段 modules[${i}].id 类型错误：期望非空字符串`);
      if (typeof m.name !== 'string' || m.name.trim() === '') errors.push(`字段 modules[${i}].name 类型错误：期望非空字符串`);
      if (typeof m.role !== 'string' || !ROLES.includes(m.role)) {
        errors.push(`字段 modules[${i}].role 取值非法：期望 ${ROLES.join(' / ')}`);
      }
      if (typeof m.content !== 'string') errors.push(`字段 modules[${i}].content 类型错误：期望字符串`);
      if (typeof m.enabled !== 'boolean') errors.push(`字段 modules[${i}].enabled 类型错误：期望布尔值`);
      if (typeof m.order !== 'number' || !Number.isFinite(m.order)) {
        errors.push(`字段 modules[${i}].order 类型错误：期望数字`);
      }
      if (typeof m.position !== 'string' || !POSITIONS.includes(m.position)) {
        errors.push(`字段 modules[${i}].position 取值非法：期望 ${POSITIONS.join(' / ')}`);
      }
      modules.push({
        id: typeof m.id === 'string' ? m.id : `m${i}`,
        name: typeof m.name === 'string' ? m.name : `模块 ${i + 1}`,
        role: (typeof m.role === 'string' && ROLES.includes(m.role) ? m.role : 'system') as PresetModule['role'],
        content: typeof m.content === 'string' ? m.content : '',
        enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
        order: typeof m.order === 'number' ? m.order : 0,
        position: (typeof m.position === 'string' && POSITIONS.includes(m.position)
          ? m.position
          : 'system') as PresetModule['position'],
        template: m.template === true,
      });
    });
  }

  const cc = input.contextConfig;
  const contextConfig = {
    contextLimit: 32768,
    scanDepth: 4,
    worldBookBudgetPct: 25,
    contextWarnPct: 80,
  };
  if (cc === undefined) {
    // contextConfig 可缺省，缺省即用默认；不算错误，但会在 UI 里提示
  } else if (!isObj(cc)) {
    errors.push('字段 contextConfig 类型错误：期望对象');
  } else {
    const fields: (keyof typeof contextConfig)[] = ['contextLimit', 'scanDepth', 'worldBookBudgetPct', 'contextWarnPct'];
    for (const f of fields) {
      if (cc[f] === undefined) continue;
      if (typeof cc[f] !== 'number' || !Number.isFinite(cc[f])) {
        errors.push(`字段 contextConfig.${f} 类型错误：期望数字`);
      } else {
        contextConfig[f] = cc[f] as number;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    preset: {
      id: input.id as string,
      format: PRESET_FORMAT,
      formatVersion: input.formatVersion as string,
      name: input.name as string,
      modules,
      contextConfig,
      raw: input,
    },
  };
}

export function serializePreset(preset: Preset): unknown {
  return {
    format: PRESET_FORMAT,
    formatVersion: preset.formatVersion,
    id: preset.id,
    name: preset.name,
    modules: preset.modules,
    contextConfig: preset.contextConfig,
  };
}
