/**
 * 回归：启用门禁（`isEnabledToolName`）必须与沙箱的 legacy 改写保持一致，
 * 否则带 `functions.` 前缀的模型工具调用会在门禁处被判为「未启用」而永远
 * 到不了沙箱改写。覆盖三种情形：`functions.` 前缀、裸 legacy 别名、Claude 展示名。
 */
import { describe, expect, it } from 'vitest';
import { checkPrometheusToolGuard } from '../../app/prometheus-md-only.js';
import { checkAtlasGuard } from '../../session/atlas-guard.js';
import {
  isEnabledToolName,
  normalizeToolNameForEnablement,
} from '../../routes/tool-name-compat.js';

describe('tool name enablement normalization', () => {
  it('accepts a single leading functions. namespace prefix', () => {
    expect(isEnabledToolName('functions.bash', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('functions.execute_shell', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('functions.Agent', new Set(['call_omo_agent']))).toBe(true);
  });

  it('keeps bare legacy aliases and Claude presented names working', () => {
    expect(isEnabledToolName('execute_shell', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('Bash', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('workspace_read_file', new Set(['read']))).toBe(true);
    expect(isEnabledToolName('Agent', new Set(['call_omo_agent']))).toBe(true);
  });

  it('strips only one prefix and still rejects unknown names', () => {
    expect(isEnabledToolName('functions.functions.bash', new Set(['bash']))).toBe(false);
    expect(isEnabledToolName('functions.unknown_tool', new Set(['bash']))).toBe(false);
  });

  it('normalizes prefixed names to their canonical form', () => {
    expect(normalizeToolNameForEnablement('functions.execute_shell')).toBe('bash');
    expect(normalizeToolNameForEnablement('functions.Agent')).toBe('call_omo_agent');
    expect(normalizeToolNameForEnablement('bash')).toBe('bash');
  });
});

describe('canonical name feeds the pre-dispatch guards', () => {
  it('Prometheus write guard applies to a namespaced write call', () => {
    const canonical = normalizeToolNameForEnablement('functions.write');
    expect(canonical).toBe('write');

    expect(
      checkPrometheusToolGuard({
        agentId: 'prometheus',
        toolName: canonical,
        filePath: '/workspace/src/app.ts',
        workspaceRoot: '/workspace',
      }).blocked,
    ).toBe(true);

    // The raw namespaced name would have slipped past the guard.
    expect(
      checkPrometheusToolGuard({
        agentId: 'prometheus',
        toolName: 'functions.write',
        filePath: '/workspace/src/app.ts',
        workspaceRoot: '/workspace',
      }).blocked,
    ).toBe(false);
  });

  it('atlas guard recognizes namespaced write / delegation calls', () => {
    expect(
      checkAtlasGuard({
        agentId: 'atlas',
        toolName: normalizeToolNameForEnablement('functions.write'),
        filePath: '/workspace/src/app.ts',
      }).injectDelegationWarning,
    ).toBe(true);

    expect(
      checkAtlasGuard({
        agentId: 'atlas',
        toolName: normalizeToolNameForEnablement('functions.task'),
        prompt: 'do the thing',
      }).injectSingleTaskDirective,
    ).toBe(true);
  });
});
