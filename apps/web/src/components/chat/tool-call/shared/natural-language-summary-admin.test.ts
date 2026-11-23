import { describe, expect, it } from 'vitest';

import { naturalLanguageSummary } from './natural-language-summary.js';

const ADMIN_TOOL_NAMES = [
  'mcp_manage_servers',
  'memory_manage',
  'skill_manage',
  'plugin_manage',
  'schedule_manage',
  'agent_manage',
  'team_workspace_manage',
] as const;

const COMMON_ACTIONS = ['list', 'add', 'update', 'remove', 'enable', 'disable'] as const;

/**
 * 管理类 / models / mcp_list_tools 的摘要。
 *
 * 这组断言守的是两条容易翻车的路径：
 * 1. 漏文案 → 通用回退把 `memory_manage` 这样的英文工具名直接展示给用户；
 * 2. `mcp_manage_servers` / `mcp_list_tools` 以 `mcp_` 开头 → 被 MCP 前缀分支吃成
 *    「调用了 MCP 工具」，可它们并不是 MCP 通道调用，而是本机管理工具。
 */
describe('naturalLanguageSummary — 管理类工具', () => {
  it('按 action 给出具体动作', () => {
    expect(naturalLanguageSummary('mcp_manage_servers', { action: 'list' })).toBe(
      '已列举了 MCP 服务器',
    );
    expect(naturalLanguageSummary('memory_manage', { action: 'update' })).toBe('已更新了记忆');
    expect(naturalLanguageSummary('skill_manage', { action: 'install' })).toBe('已安装了技能');
    expect(naturalLanguageSummary('plugin_manage', { action: 'disable' })).toBe('已停用了插件');
    expect(naturalLanguageSummary('schedule_manage', { action: 'run' })).toBe('已运行了定时任务');
    expect(naturalLanguageSummary('agent_manage', { action: 'create' })).toBe('已创建了子代理');
    expect(naturalLanguageSummary('team_workspace_manage', { action: 'delete' })).toBe(
      '已删除了团队工作区',
    );
  });

  it('mcp_manage_servers 不再被 mcp_ 前缀分支吃掉', () => {
    const summary = naturalLanguageSummary('mcp_manage_servers', { action: 'list' });

    expect(summary).not.toBe('调用了 MCP 工具');
    expect(summary).toContain('MCP 服务器');
  });

  it('mcp_list_tools 有自己的文案，不受管理类分支影响', () => {
    expect(naturalLanguageSummary('mcp_list_tools', {})).toBe('已列举了 MCP 工具');
  });

  it('真正的 MCP 通道调用维持原口径（没被误伤）', () => {
    expect(naturalLanguageSummary('mcp_call', {})).toBe('调用了 MCP 工具');
    expect(naturalLanguageSummary('mcp__lsp__diagnostics', {})).toBe('已执行了语言服务操作');
  });

  it('缺 action 时给中性文案，不回退到英文工具名', () => {
    const summary = naturalLanguageSummary('skill_manage', {});

    expect(summary).toBe('已执行了技能操作');
    expect(summary).not.toContain('skill_manage');
  });

  it('任意 action × 任意管理工具的文案都不含工具名（不留英文）', () => {
    for (const name of ADMIN_TOOL_NAMES) {
      for (const action of [...COMMON_ACTIONS, 'search', 'install', 'history', 'source_add']) {
        const summary = naturalLanguageSummary(name, { action });
        expect(summary).not.toContain(name);
        // 工具名一定带下划线，用它当「英文工具名泄漏」的判据（`MCP` 这类缩写是合法的）。
        expect(summary).not.toContain('_');
      }
    }
  });
});

describe('naturalLanguageSummary — models', () => {
  it('给出中文文案而不是英文工具名', () => {
    expect(naturalLanguageSummary('models', { query: 'claude' })).toBe('已搜索了可用模型');
  });
});
