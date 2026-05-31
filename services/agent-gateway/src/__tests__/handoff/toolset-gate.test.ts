/**
 * Toolset 门控单测：层级权限控制的核心执行点。
 *
 * 覆盖：
 *   - filterToolsByAllowedSets：按类别过滤工具 + 始终放行的基础工具
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
  tool('web_search'),
  tool('lsp_find_references'),
  tool('grep'),
  // 基础工具（不受门控影响）
  tool('AskUserQuestion'),
  tool('todo_read'),
  tool('todo_write'),
  // 不属于任何 toolset 的工具（应被过滤掉）
  tool('some_random_tool'),
];

function names(tools: Tool[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

describe('filterToolsByAllowedSets', () => {
  it('只放行白名单类别对应的工具 + 始终允许的基础工具', () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read']);
    const n = names(filtered);
    // read 类别含 read/grep；基础工具恒在；random/write/bash 被过滤。
    expect(n).toContain('read');
    expect(n).toContain('grep');
    expect(n).toContain('AskUserQuestion');
    expect(n).toContain('todo_read');
    expect(n).not.toContain('write');
    expect(n).not.toContain('bash');
    expect(n).not.toContain('web_search');
    expect(n).not.toContain('some_random_tool');
  });

  it("'all' 类别不做任何过滤", () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['all']);
    expect(filtered.length).toBe(ALL_TOOLS.length);
  });

  it('多类别合并放行（read + write + shell）', () => {
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, ['read', 'write', 'shell']);
    const n = names(filtered);
    expect(n).toContain('read');
    expect(n).toContain('write');
    expect(n).toContain('edit');
    expect(n).toContain('bash');
    expect(n).not.toContain('web_search');
    expect(n).not.toContain('some_random_tool');
  });

  it('executor 放宽后含 web → web_search 可见', () => {
    const allowed = LAYER_CAPABILITIES.executor.allowedToolsetCategories as ToolsetCategory[];
    expect(allowed).toContain('web');
    const filtered = filterToolsByAllowedSets(ALL_TOOLS, allowed);
    expect(names(filtered)).toContain('web_search');
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
  // 复刻 stream.ts 的交集逻辑：成员 toolsets 与层白名单取交集；交集为空时退回层白名单。
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
    // pm1 天花板 read/write；成员只声明了 shell（层外）→ 交集空 → 退回层白名单。
    expect(resolveAllowedSets('pm1', ['shell'])).toEqual(['read', 'write']);
  });

  it('无成员 toolsets → 使用完整层白名单', () => {
    expect(resolveAllowedSets('executor', null)).toEqual(
      LAYER_CAPABILITIES.executor.allowedToolsetCategories as string[],
    );
  });

  it('成员 toolsets 含 all → 不收紧（用层白名单）', () => {
    expect(resolveAllowedSets('executor', ['all'])).toEqual(
      LAYER_CAPABILITIES.executor.allowedToolsetCategories as string[],
    );
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
});
