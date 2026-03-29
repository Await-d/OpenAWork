import { describe, expect, it, vi } from 'vitest';
import {
  NonInteractiveRunnerImpl,
  type ApprovalPromptContext,
  type ApprovalPromptResult,
} from '../cli/non-interactive.js';

describe('NonInteractiveRunnerImpl approval policies', () => {
  it('auto policy allows simulated tool usage', async () => {
    const runner = new NonInteractiveRunnerImpl();

    const result = await runner.run({
      prompt: '整理报告',
      allowedTools: ['web_search'],
      maxTurns: 2,
      quiet: true,
      approvalPolicy: 'auto',
    });

    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
  });

  it('prompt policy delegates approval to the provided prompter', async () => {
    const runner = new NonInteractiveRunnerImpl();
    const approvalPrompter: (context: ApprovalPromptContext) => Promise<ApprovalPromptResult> =
      vi.fn(async (): Promise<'approve'> => 'approve');

    const result = await runner.run({
      prompt: '整理报告',
      allowedTools: ['web_search'],
      maxTurns: 2,
      quiet: true,
      approvalPolicy: 'prompt',
      approvalPrompter,
    });

    expect(approvalPrompter).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'web_search', turn: 1 }),
    );
    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
  });

  it('deny policy blocks tool usage and returns an approval error', async () => {
    const runner = new NonInteractiveRunnerImpl();

    const result = await runner.run({
      prompt: '整理报告',
      allowedTools: ['web_search'],
      maxTurns: 2,
      quiet: true,
      approvalPolicy: 'deny',
    });

    expect(result.success).toBe(false);
    expect(result.toolCallCount).toBe(0);
    expect(result.error).toContain('deny');
  });
});
