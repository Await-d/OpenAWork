/**
 * 回归：启用门禁（`isEnabledToolName`）必须与沙箱的前缀剥离保持一致，
 * 否则带 `functions.` 前缀的模型工具调用会在门禁处被判为「未启用」而永远
 * 到不了沙箱。覆盖三种情形：`functions.` 前缀、Claude 展示名、子代理运行期别名
 * （`task`），并锁定「归一化对其它任何名字都是恒等映射」。
 */
import { describe, expect, it } from 'vitest';
import { checkPrometheusToolGuard } from '../../app/prometheus-md-only.js';
import { checkAtlasGuard } from '../../session/atlas-guard.js';
import { appendTaskResumeInfo } from '../../task/task-resume-info.js';
import { isTaskToolName } from '../../task/task-tools.js';
import {
  isEnabledToolName,
  normalizeToolNameForEnablement,
} from '../../routes/tool-name-compat.js';

describe('tool name enablement normalization', () => {
  it('accepts a single leading functions. namespace prefix', () => {
    expect(isEnabledToolName('functions.bash', new Set(['bash']))).toBe(true);
    expect(isEnabledToolName('functions.Agent', new Set(['subagent']))).toBe(true);
  });

  it('keeps Claude presented names and the task alias working', () => {
    expect(isEnabledToolName('Bash', new Set(['bash']))).toBe(true);
    // Claude Code 呈报名 `Agent` 的 canonical 已收敛为 `subagent`（261102 T-18）。
    expect(isEnabledToolName('Agent', new Set(['subagent']))).toBe(true);
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
    expect(normalizeToolNameForEnablement('functions.Agent')).toBe('subagent');
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

/**
 * B-04（261102 批次 B / T-19）：三处曾按历史名枚举、缺规范名 `subagent` 的
 * 手写集合已统一改用 `isTaskToolName()`。此处逐处回归，防止再次漏判。
 */
describe('delegation tool sets cover the canonical subagent name (B-04)', () => {
  it('Prometheus 只读警告对 subagent 委派同样注入', () => {
    for (const toolName of ['subagent', 'task']) {
      expect(
        checkPrometheusToolGuard({
          agentId: 'prometheus',
          toolName,
          prompt: '子代理请协助调研',
          workspaceRoot: '/workspace',
        }).injectConsultWarning,
        toolName,
      ).toBe(true);
    }
  });

  it('resume 提示对 subagent 委派照常追加', () => {
    const output = 'sessionId: ses_abc123';
    const withHint = appendTaskResumeInfo('subagent', output);
    expect(withHint).toContain('to continue: delegate_task(session_id="ses_abc123"');
    // 历史别名保持同一行为
    expect(appendTaskResumeInfo('task', output)).toContain('to continue:');
    // 非委派工具不追加
    expect(appendTaskResumeInfo('read', output)).toBe(output);
  });

  it('规范名 subagent 与历史别名 task 同属委派工具', () => {
    // routes/stream.ts 的 taskToolUsedInTurn 置位判定、以及三处集合都以
    // isTaskToolName() 为唯一事实来源；直接锁定该谓词对规范名的识别。
    expect(isTaskToolName('subagent')).toBe(true);
    expect(isTaskToolName('task')).toBe(true);
    expect(isTaskToolName('call_omo_agent')).toBe(false);
    expect(isTaskToolName('read')).toBe(false);
  });
});
