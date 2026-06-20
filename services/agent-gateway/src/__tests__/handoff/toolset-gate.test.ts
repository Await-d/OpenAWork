/**
 * Toolset 门控单测：层级权限控制的核心执行点。
 *
 * 覆盖：
 *   - filterToolsByAllowedSets：按类别过滤工具 + 始终放行的内部待办工具
 *   - extractToolsetsFromMetadata：从 session metadata 解析白名单
 *   - 'all' 不过滤
 *   - 层级白名单 ∩ 成员 toolsets 的交集语义（模拟 stream.ts 的门控逻辑）
 *   - 放宽后的层天花板（pm2 + lsp/review、executor + web、reviewer + shell/test）
 */

import { describe, expect, it } from 'vitest';
import {
  TOOLSET_TO_TOOL_NAMES,
  extractToolsetsFromMetadata,
  filterToolsByAllowedSets,
  isDynamicallyBoundTool,
} from '../../handoff/capability/toolset-gate.js';
import { LAYER_CAPABILITIES } from '../../handoff/capability/layer-capabilities.js';
import type { ToolsetCategory } from '../../handoff/capability/dispatch-package.js';

type Tool = { function: { name: string } };

const tool = (name: string): Tool => ({ function: { name } });

const ALL_TOOLS: Tool[] = [
  tool('read'),
  tool('write'),
  tool('edit'),
  tool('bash'),
  tool('websearch'),
  tool('webfetch'),
  tool('lsp_find_references'),
  tool('grep'),
  tool('AskUserQuestion'),
  tool('todoread'),
  tool('todowrite'),
  // 动态绑定的 MCP 扁平工具（应放行）
  tool('mcp__github__create_issue'),
  tool('mcp__websearch__web_search_exa'),
  // 不属于任何 toolset 的工具（应被过滤掉）
  tool('some_random_tool'),
];

function names(tools: Tool[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

describe('filterToolsByAllowedSets', () => {
  it('只放行白名单类别对应的工具 + 始终允许的内部待办工具', () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read']);
    const n = names(filtered);
    expect(n).toContain('read');
    expect(n).toContain('grep');
    expect(n).not.toContain('AskUserQuestion');
    expect(n).toContain('todoread');
    expect(n).not.toContain('write');
    expect(n).not.toContain('bash');
    expect(n).not.toContain('websearch');
    expect(n).not.toContain('some_random_tool');
  });

  it('动态绑定的 MCP 扁平工具（mcp__*）始终放行——不被层类别表二次拦截', () => {
    // 即便是最严的 read 白名单，MCP 工具也应直通（已在上游按 requestedMcpServers 授权）。
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read']);
    const n = names(filtered);
    expect(n).toContain('mcp__github__create_issue');
    expect(n).toContain('mcp__websearch__web_search_exa');
    // 但非 MCP 的未知工具仍被过滤。
    expect(n).not.toContain('some_random_tool');
  });

  it('isDynamicallyBoundTool 仅识别 mcp__ 前缀', () => {
    expect(isDynamicallyBoundTool('mcp__github__x')).toBe(true);
    expect(isDynamicallyBoundTool('read')).toBe(false);
    expect(isDynamicallyBoundTool('some_random_tool')).toBe(false);
  });

  it("'all' 类别不做任何过滤", () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['all']);
    expect(filtered.length).toBe(ALL_TOOLS.length);
  });

  it('团队层普通白名单不会把执行层选择题直接暴露给用户', () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read', 'write', 'shell']);
    expect(names(filtered)).not.toContain('AskUserQuestion');
  });

  it('多类别合并放行（read + write + shell）', () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read', 'write', 'shell']);
    const n = names(filtered);
    expect(n).toContain('read');
    expect(n).toContain('write');
    expect(n).toContain('edit');
    expect(n).toContain('bash');
    expect(n).not.toContain('websearch');
    expect(n).not.toContain('some_random_tool');
  });

  it('executor 放宽后含 web → websearch/webfetch 可见（规范工具名）', () => {
    const allowed = LAYER_CAPABILITIES.executor.allowedToolsetCategories as ToolsetCategory[];
    expect(allowed).toContain('web');
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, allowed);
    expect(names(filtered)).toContain('websearch');
  });

  it('reviewer 放宽后含 shell/test → bash 可见', () => {
    const allowed = LAYER_CAPABILITIES.reviewer.allowedToolsetCategories as ToolsetCategory[];
    expect(allowed).toContain('shell');
    expect(allowed).toContain('test');
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, allowed);
    expect(names(filtered)).toContain('bash');
  });
});

describe('extractToolsetsFromMetadata', () => {
  it('解析合法 toolsets 数组', () => {
    expect(extractToolsetsFromMetadata(JSON.stringify({ toolsets: ['read', 'write'] }))).toEqual([
      'read',
      'write',
    ]);
  });

  it('无 toolsets 字段返回 null（不做门控）', () => {
    expect(extractToolsetsFromMetadata(JSON.stringify({ other: 1 }))).toBeNull();
  });

  it('非法 JSON 返回 null', () => {
    expect(extractToolsetsFromMetadata('{bad json')).toBeNull();
  });

  it('toolsets 非数组返回 null', () => {
    expect(extractToolsetsFromMetadata(JSON.stringify({ toolsets: 'read' }))).toBeNull();
  });
});

describe('层级白名单 ∩ 成员 toolsets 交集语义（模拟 stream.ts 门控）', () => {
  // 复刻 stream.ts 的交集 + 必备并入逻辑：
  //   1. 成员 toolsets 与层白名单取交集；交集为空时退回层白名单
  //   2. 强制并入层 requiredToolsetCategories（必备集，成员配置不可砍掉）
  function resolveAllowedSets(
    layer: keyof typeof LAYER_CAPABILITIES,
    memberToolsets: string[] | null,
  ): string[] {
    let allowedSets = LAYER_CAPABILITIES[layer].allowedToolsetCategories as string[];
    if (memberToolsets && memberToolsets.length > 0 && !memberToolsets.includes('all')) {
      const layerSet = new Set(allowedSets);
      const intersect = memberToolsets.filter((t) => layerSet.has(t));
      if (intersect.length > 0) allowedSets = intersect;
    }
    const required = LAYER_CAPABILITIES[layer].requiredToolsetCategories as string[];
    if (required.length > 0) {
      const merged = new Set(allowedSets);
      for (const r of required) merged.add(r);
      allowedSets = Array.from(merged);
    }
    return allowedSets;
  }

  it('成员声明更严（reviewer 只 read）→ 收紧到 read', () => {
    expect(resolveAllowedSets('reviewer', ['read'])).toEqual(['read']);
  });

  it('成员声明的工具超出层天花板 → 交集只保留层内允许的（不越权）', () => {
    // reception 天花板 read/web；成员妄图要 shell → 交集只剩 read。
    expect(resolveAllowedSets('reception', ['read', 'shell'])).toEqual(['read']);
  });

  it('交集为空 → 退回层白名单（避免把工具全砍光跑不动）', () => {
    // pm1 天花板 read/write；成员只声明了 shell（层外）→ 交集空 → 退回层白名单（含必备）。
    const result = resolveAllowedSets('pm1', ['shell']);
    expect(result).toContain('read');
    expect(result).toContain('write');
  });

  it('无成员 toolsets → 使用完整层白名单（含必备）', () => {
    const result = resolveAllowedSets('executor', null);
    for (const cat of LAYER_CAPABILITIES.executor.allowedToolsetCategories) {
      expect(result).toContain(cat);
    }
  });

  it('成员 toolsets 含 all → 不收紧（用层白名单 + 必备并入）', () => {
    const result = resolveAllowedSets('executor', ['all']);
    for (const cat of LAYER_CAPABILITIES.executor.allowedToolsetCategories) {
      expect(result).toContain(cat);
    }
  });

  it('必备工具不可被成员配置砍掉：executor 成员只勾 read 时仍含 write/shell', () => {
    // executor 必备 ['read','write','shell']；成员仅勾 ['read'] 想限制自己，
    // 交集会得到 ['read']，但 required 强制并入 → 最终仍含 write/shell。
    const result = resolveAllowedSets('executor', ['read']);
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('shell');
  });

  it('必备工具不可被成员配置砍掉：pm1 成员只勾 read 时仍含 write', () => {
    const result = resolveAllowedSets('pm1', ['read']);
    expect(result).toContain('read');
    expect(result).toContain('write');
  });

  it('fail-closed：只读最小集 [read] 仍能产出可用工具（read/grep/glob…）', () => {
    // stream.ts 在层白名单异常为空 / 门控出错时退回 ['read']。验证这个兜底集
    // 能映射出一组安全的只读工具（不为空、不含写/执行类）。
    const readNames = TOOLSET_TO_TOOL_NAMES['read'];
    expect(readNames.length).toBeGreaterThan(0);
    expect(readNames).toContain('read');
    // 只读集里不应混入写 / 执行类工具。
    const writeOrShell = new Set([
      ...TOOLSET_TO_TOOL_NAMES['write'],
      ...TOOLSET_TO_TOOL_NAMES['shell'],
    ]);
    expect(readNames.some((n) => writeOrShell.has(n))).toBe(false);
  });
});

describe('TOOLSET_TO_TOOL_NAMES 完整性', () => {
  it('每个 dispatch toolset 类别都有映射（all 除外可为空）', () => {
    for (const [category, toolNames] of Object.entries(TOOLSET_TO_TOOL_NAMES)) {
      if (category === 'all') continue;
      expect(toolNames.length).toBeGreaterThan(0);
    }
  });

  it('web 类别用规范工具名 websearch/webfetch（而非已废弃的 web_search）', () => {
    // 回归：早期写成 'web_search' 与任何已注册工具都对不上，会被静默过滤，
    // 导致 reception/executor 选了 web 却拿不到联网能力。
    expect(TOOLSET_TO_TOOL_NAMES['web']).toContain('websearch');
    expect(TOOLSET_TO_TOOL_NAMES['web']).toContain('webfetch');
    expect(TOOLSET_TO_TOOL_NAMES['web']).not.toContain('web_search');
  });
});

describe('LAYER_CAPABILITIES 必备/允许 工具集不变量', () => {
  it('每层 requiredToolsetCategories 都是 allowedToolsetCategories 的子集', () => {
    for (const [layer, caps] of Object.entries(LAYER_CAPABILITIES)) {
      const allowed = new Set(caps.allowedToolsetCategories);
      for (const required of caps.requiredToolsetCategories) {
        expect(allowed.has(required), `${layer} 必备 ${required} 必须在允许集里`).toBe(true);
      }
    }
  });

  it('五个工作层都有非空必备工具集（避免完全无底线）', () => {
    expect(LAYER_CAPABILITIES.reception.requiredToolsetCategories.length).toBeGreaterThan(0);
    expect(LAYER_CAPABILITIES.pm1.requiredToolsetCategories.length).toBeGreaterThan(0);
    expect(LAYER_CAPABILITIES.pm2.requiredToolsetCategories.length).toBeGreaterThan(0);
    expect(LAYER_CAPABILITIES.executor.requiredToolsetCategories.length).toBeGreaterThan(0);
    expect(LAYER_CAPABILITIES.reviewer.requiredToolsetCategories.length).toBeGreaterThan(0);
  });

  it('executor 必备含 read/write/shell（交付代码三大件）', () => {
    expect(LAYER_CAPABILITIES.executor.requiredToolsetCategories).toEqual(
      expect.arrayContaining(['read', 'write', 'shell']),
    );
  });

  it('pm1 必备含 read/write（写 spec/plan/tasks 必需）', () => {
    expect(LAYER_CAPABILITIES.pm1.requiredToolsetCategories).toEqual(
      expect.arrayContaining(['read', 'write']),
    );
  });
});
