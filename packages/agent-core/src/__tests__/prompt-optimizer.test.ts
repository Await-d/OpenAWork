import { describe, expect, it, vi } from 'vitest';
import { PromptOptimizerImpl, type PromptCandidate } from '../workflow/prompt-optimizer.js';

const sampleCandidates: PromptCandidate[] = [
  { id: '1', text: 'Write a concise summary', improvements: ['shorter', 'actionable'] },
  { id: '2', text: 'Summarize in 3 bullet points', improvements: ['structured', 'scannable'] },
  { id: '3', text: 'Give a one-sentence overview', improvements: ['brevity'] },
];

const sampleLLMResponse = JSON.stringify({
  candidates: sampleCandidates,
  recommended: '2',
  rationale: 'Structured bullets are easiest to scan.',
});

describe('PromptOptimizerImpl', () => {
  it('calls the LLM with the original prompt and returns structured candidates', async () => {
    const mockLLM = vi.fn(async () => sampleLLMResponse);
    const optimizer = new PromptOptimizerImpl(mockLLM);

    const result = await optimizer.optimize({ originalPrompt: 'Write a summary' });

    expect(mockLLM).toHaveBeenCalledOnce();
    const firstCallArgs = mockLLM.mock.calls.at(0);
    expect(firstCallArgs?.at(0)).toContain('Write a summary');
    expect(result.originalPrompt).toBe('Write a summary');
    expect(result.candidates).toHaveLength(3);
    expect(result.recommended).toBe('2');
    expect(result.rationale).toContain('bullet');
    expect(result.requestId).toBeTypeOf('string');
  });

  it('includes context and targetAudience in the meta-prompt', async () => {
    const mockLLM = vi.fn(async () => sampleLLMResponse);
    const optimizer = new PromptOptimizerImpl(mockLLM);

    await optimizer.optimize({
      originalPrompt: 'Explain the concept',
      context: 'Python tutorials',
      targetAudience: 'beginners',
    });

    const call = mockLLM.mock.calls.at(0)?.at(0) ?? '';
    expect(call).toContain('Python tutorials');
    expect(call).toContain('beginners');
  });

  it('throws when the LLM returns no JSON payload', async () => {
    const mockLLM = vi.fn(async () => 'No JSON here.');
    const optimizer = new PromptOptimizerImpl(mockLLM);

    await expect(optimizer.optimize({ originalPrompt: 'Test' })).rejects.toThrow('JSON payload');
  });

  it('caps candidateCount at 5', async () => {
    const mockLLM = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Generate 5');
      return sampleLLMResponse;
    });
    const optimizer = new PromptOptimizerImpl(mockLLM);

    await optimizer.optimize({ originalPrompt: 'Test', candidateCount: 99 });
  });
});
