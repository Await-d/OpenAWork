import { describe, expect, it } from 'vitest';
import { ALLOW_BY_DEFAULT_TOOL_NAMES, TOOL_TO_PERMISSION_CATEGORY } from '@openAwork/agent-core';
import { TOOL_WHITELIST } from '../../tools/tool-sandbox.js';

describe('默认放行工具清单与沙箱静态白名单的一致性', () => {
  it('ALLOW_BY_DEFAULT_TOOL_NAMES 中的每个名字都必须是运行时真实存在的工具', () => {
    // 防漂移不变量：清单里一旦出现拼写错误、改名残留或已删除的工具名，该条目就是
    // 无声失效的死条目；更糟的是工具改名后旧名残留在清单里，会谎报覆盖范围。
    // 沙箱静态白名单（TOOL_WHITELIST）是网关运行时工具名的唯一事实来源，故以此校验。
    const staleAllowEntries = [...ALLOW_BY_DEFAULT_TOOL_NAMES].filter(
      (toolName) => !TOOL_WHITELIST.has(toolName),
    );

    expect(staleAllowEntries).toEqual([]);
  });

  it('沙箱白名单中的工具必须已分类：映射权限类别或显式默认放行', () => {
    // 白名单里的工具若既无权限类别映射、也不在默认放行清单，会静默回退到 custom
    // （fail-closed 后为 ask）——与 fail-open 修复前的漏注册是同一类覆盖缺口。
    const unclassifiedTools = [...TOOL_WHITELIST].filter(
      (toolName) =>
        TOOL_TO_PERMISSION_CATEGORY[toolName] === undefined &&
        !ALLOW_BY_DEFAULT_TOOL_NAMES.has(toolName),
    );

    expect(unclassifiedTools).toEqual([]);
  });
});
