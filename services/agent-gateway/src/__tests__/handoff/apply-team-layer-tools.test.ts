/**
 * apply-team-layer-tools · 团队层工具门控共享逻辑测试。
 *
 * 重点验证：stream.ts 与 stream-runtime.ts 现在共用同一套门控，executor 等后台执行层
 * 能拿到内置指令 + 必备工具 + MCP 直通，不再因「指令未注入」无法工作。
 */

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

import { describe, expect, it } from 'vitest';
import {
  applyTeamLayerToolGate,
  appendTeamDynamicInstructionBlocks,
  isTeamRoleLayer,
} from '../../handoff/capability/apply-team-layer-tools.js';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';

function tool(name: string): GatewayToolDefinition {
  return { type: 'function', function: { name, description: '', parameters: {} } } as never;
}

const META = JSON.stringify({});

describe('isTeamRoleLayer', () => {
  it('识别五层，拒绝其它', () => {
    for (const l of ['reception', 'pm1', 'pm2', 'executor', 'reviewer']) {
      expect(isTeamRoleLayer(l)).toBe(true);
    }
    expect(isTeamRoleLayer('user')).toBe(false);
    expect(isTeamRoleLayer(null)).toBe(false);
    expect(isTeamRoleLayer('chat')).toBe(false);
  });
});

describe('applyTeamLayerToolGate', () => {
  it('非团队层原样返回（chat session 不门控）', async () => {
    const tools = [tool('read'), tool('write'), tool('bash'), tool('some_random')];
    const out = await applyTeamLayerToolGate({
      roleLayer: null,
      metadataJson: META,
      filteredTools: tools,
    });
    expect(out).toBe(tools);
  });

  it('executor 注入内置指令（submit_patch / submit_execution_result / mark_completed 等）', async () => {
    const tools = [tool('read'), tool('write'), tool('bash')];
    const out = await applyTeamLayerToolGate({
      roleLayer: 'executor',
      metadataJson: META,
      filteredTools: tools,
    });
    const names = out.map((t) => t.function.name);
    expect(names).toContain('submit_patch');
    expect(names).toContain('submit_execution_result');
    expect(names).toContain('report_progress');
    expect(names).toContain('mark_completed');
    expect(names).toContain('mark_failed');
  });

  it('executor 必备工具（read/write/bash）保留，越层与直接问用户工具被过滤', async () => {
    const tools = [
      tool('read'),
      tool('write'),
      tool('bash'),
      tool('AskUserQuestion'),
      tool('some_random'),
    ];
    const out = await applyTeamLayerToolGate({
      roleLayer: 'executor',
      metadataJson: META,
      filteredTools: tools,
    });
    const names = out.map((t) => t.function.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('bash');
    expect(names).not.toContain('AskUserQuestion');
    expect(names).not.toContain('some_random');
  });

  it('MCP 扁平工具直通（不被层类别表拦截）', async () => {
    const tools = [tool('read'), tool('mcp__github__create_issue')];
    const out = await applyTeamLayerToolGate({
      roleLayer: 'reviewer',
      metadataJson: META,
      filteredTools: tools,
    });
    expect(out.map((t) => t.function.name)).toContain('mcp__github__create_issue');
  });

  it('reception 注入 reply_direct / route_to_orchestrate', async () => {
    const out = await applyTeamLayerToolGate({
      roleLayer: 'reception',
      metadataJson: META,
      filteredTools: [tool('read')],
    });
    const names = out.map((t) => t.function.name);
    expect(names).toContain('reply_direct');
    expect(names).toContain('route_to_orchestrate');
    expect(names).toContain('request_user_input');
    expect(names).not.toContain('AskUserQuestion');
  });
});

describe('appendTeamDynamicInstructionBlocks', () => {
  it('团队层追加 available-tools 清单（含 MCP 分组）', () => {
    const out = appendTeamDynamicInstructionBlocks({
      stableBlock: '<base/>',
      roleLayer: 'executor',
      teamRosterManifest: null,
      enabledToolNames: new Set(['read', 'write', 'mcp__github__x']),
    });
    expect(out).toContain('available-tools');
    expect(out).toContain('- read');
    expect(out).toContain('- mcp__github__x');
    expect(out).toContain('MCP 工具');
  });

  it('有 roster-manifest 时追加 roster 段', () => {
    const out = appendTeamDynamicInstructionBlocks({
      stableBlock: '',
      roleLayer: 'pm2',
      teamRosterManifest: '当前编制：前端×1 后端×1',
      enabledToolNames: new Set(['read']),
    });
    expect(out).toContain('roster-manifest');
    expect(out).toContain('当前编制');
  });

  it('非团队层不追加 available-tools（仅 roster 若有）', () => {
    const out = appendTeamDynamicInstructionBlocks({
      stableBlock: '<base/>',
      roleLayer: null,
      teamRosterManifest: null,
      enabledToolNames: new Set(['read']),
    });
    expect(out).not.toContain('available-tools');
    expect(out).toBe('<base/>');
  });
});
