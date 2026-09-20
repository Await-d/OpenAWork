/**
 * 回归：子代理（task）把服务端拼装的完整 system prompt 走 `streamRequestSchema`
 * （runSessionInBackground）。该上限必须容得下远超旧 4000 字符的委派提示词，
 * 否则子任务会以 `too_big` Zod 错误失败。
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS,
  modelRequestSchema,
} from '../../provider/model-router.js';
import { streamRequestSchema } from '../../routes/stream.js';

function buildDelegatedStyleSystemPrompt(): string {
  return [
    'You are a delegated child agent.',
    'Delegation contract:\n- keep the scope narrow.',
    `Requested skills:\n<skill_content name="frontend">${'f'.repeat(4500)}</skill_content>`,
    'Completion requirements:\n- finish with a concise final summary.',
  ].join('\n\n');
}

describe('stream request systemPrompt limit', () => {
  it('accepts a delegated system prompt well beyond the legacy 4000-char cap', () => {
    const systemPrompt = buildDelegatedStyleSystemPrompt();
    expect(systemPrompt.length).toBeGreaterThan(4000);

    const parsed = streamRequestSchema.parse({
      clientRequestId: 'req-system-prompt-delegated',
      message: 'hello',
      systemPrompt,
    });

    expect(parsed.systemPrompt).toBe(systemPrompt);
  });

  it('keeps the same limit on the base model request schema', () => {
    const systemPrompt = 'x'.repeat(6000);

    expect(modelRequestSchema.parse({ systemPrompt }).systemPrompt).toBe(systemPrompt);
  });

  it('still rejects prompts above the aligned cap', () => {
    const result = streamRequestSchema.safeParse({
      clientRequestId: 'req-system-prompt-overflow',
      message: 'hello',
      systemPrompt: 'x'.repeat(MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS + 1),
    });

    expect(result.success).toBe(false);
  });
});
