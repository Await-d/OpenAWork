/**
 * T-23 回归：子代理工具的上游对齐。
 *
 * 上游 opencode 的工具名是 `subagent`，输入形状为
 * `{ agent, description, prompt, model, sessionID, background }`；
 * 本仓 canonical 工具名是 `task`，规范字段是
 * `subagent_type` / `run_in_background` / `session_id`。
 * 本文件锁定「名称别名 + 输入形状桥接」两侧的兼容行为。
 */
import { describe, expect, it } from 'vitest';
import {
  isEnabledToolName,
  normalizeToolNameForEnablement,
} from '../../routes/tool-name-compat.js';
import { taskToolDefinition } from '../../task/task-tools.js';
import { rewriteLegacyToolRequest } from '../../tools/legacy-tool-name-rewrite.js';

function parseTaskInput(input: unknown) {
  return taskToolDefinition.inputSchema.safeParse(input);
}

describe('subagent 为规范名，task 为运行期别名（不经 legacy 重写）', () => {
  it('启用门禁同时接受 subagent 与 task', () => {
    expect(isEnabledToolName('subagent', new Set(['subagent']))).toBe(true);
    expect(isEnabledToolName('task', new Set(['subagent']))).toBe(true);
    expect(isEnabledToolName('functions.task', new Set(['subagent']))).toBe(true);
  });

  it('归一化：subagent 保持规范名，task 归一为 subagent', () => {
    expect(normalizeToolNameForEnablement('subagent')).toBe('subagent');
    expect(normalizeToolNameForEnablement('task')).toBe('subagent');
    expect(normalizeToolNameForEnablement('functions.task')).toBe('subagent');
  });

  it('task 与 subagent 都**不**走 legacy 重写（由运行期 isTaskToolName 处理）', () => {
    // 回归守卫：把 task 放进 legacy 改名表会让沙箱派发改道、task 子会话不再创建。
    // 2026-09-22 起改名表已清空，这里同时守住「不要重新加回任何改名」。
    for (const toolName of ['task', 'subagent'] as const) {
      const result = rewriteLegacyToolRequest(toolName, { prompt: 'hi' });
      expect(result.toolName).toBe(toolName);
      expect(result.rewritten).toBe(false);
    }
  });
});

describe('subagent 输入形状桥接', () => {
  it('接受上游形状并归一化为本仓规范字段', () => {
    const parsed = parseTaskInput({
      agent: 'explore',
      prompt: '审计会话唤醒原语',
      background: true,
      sessionID: 'sess-child-1',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(`上游形状应通过校验：${parsed.error.message}`);
    }
    expect(parsed.data.subagent_type).toBe('explore');
    expect(parsed.data.run_in_background).toBe(true);
    expect(parsed.data.session_id).toBe('sess-child-1');
    expect(parsed.data.load_skills).toEqual([]);
  });

  it('上游形状省略 background 时保持默认 false', () => {
    const parsed = parseTaskInput({ agent: 'general', prompt: '任务' });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('应通过校验');
    }
    expect(parsed.data.run_in_background).toBe(false);
  });

  it('规范字段优先于同名上游别名', () => {
    const parsed = parseTaskInput({
      subagent_type: 'explore',
      agent: 'explore',
      prompt: '任务',
      run_in_background: false,
      background: true,
      session_id: 'canonical-sess',
      sessionID: 'alias-sess',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('应通过校验');
    }
    expect(parsed.data.session_id).toBe('canonical-sess');
    expect(parsed.data.run_in_background).toBe(false);
  });

  it('规范字段与上游别名冲突时拒绝（避免静默歧义）', () => {
    const parsed = parseTaskInput({
      subagent_type: 'explore',
      agent: 'general',
      prompt: '任务',
    });

    expect(parsed.success).toBe(false);
  });

  it('三种指定方式全缺失时仍然拒绝', () => {
    expect(parseTaskInput({ prompt: '任务' }).success).toBe(false);
  });

  it('category 与 subagent_type 互斥的既有约束保持不变', () => {
    expect(
      parseTaskInput({ category: 'quick', subagent_type: 'explore', prompt: '任务' }).success,
    ).toBe(false);
  });
});
