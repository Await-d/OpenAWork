/**
 * 回归：启用门禁（`isEnabledToolName`）必须与沙箱的前缀剥离保持一致，
 * 否则带 `functions.` 前缀的模型工具调用会在门禁处被判为「未启用」而永远
 * 到不了沙箱。覆盖三种情形：`functions.` 前缀、Claude 展示名、子代理运行期别名
 * （`task`），并锁定「归一化对其它任何名字都是恒等映射」。
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
    expect(isEnabledToolName('functions.Agent', new Set(['call_omo_agent']))).toBe(true);
  });

  it('keeps Claude presented names and the task alias working', () => {
    expect(isEnabledToolName('Bash', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('Agent', new Set(['call_omo_agent']))).toBe(true);
    expect(isEnabledToolName('task', new Set(['subagent']))).toBe(true);
  });

  it('归一化是恒等映射（仅展示名与 task 运行期别名例外）', () => {
    // 硬约定：除 `functions.` 前缀、Claude 展示名、`task` 运行期别名外，任何名字
    // 都必须原样返回——不存在「旧名 → 规范名」的表。
    const names = [
      'read',
      'list',
      'glob',
      'grep',
      'write',
      'edit',
      'multi_edit',
      'patch',
      'bash',
      'websearch',
      'unknown_tool',
    ];
    for (const name of names) {
      expect(normalizeToolNameForEnablement(name), name).toBe(name);
    }
  });

  it('strips only one prefix and still rejects unknown names', () => {
    expect(isEnabledToolName('functions.functions.bash', new Set(['bash']))).toBe(false);
    expect(isEnabledToolName('functions.unknown_tool', new Set(['bash']))).toBe(false);
  });

  it('normalizes prefixed names to their canonical form', () => {
    expect(normalizeToolNameForEnablement('functions.bash')).toBe('bash');
    expect(normalizeToolNameForEnablement('functions.Agent')).toBe('call_omo_agent');
    expect(normalizeToolNameForEnablement('task')).toBe('subagent');
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
