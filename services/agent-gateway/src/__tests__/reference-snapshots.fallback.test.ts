import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('reference snapshot fallbacks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses frozen agent/category/model data when reference files are unavailable', async () => {
    vi.doMock('../agent-reference-parser.js', () => ({
      readReferenceFile: () => undefined,
      extractBlockDescription: () => undefined,
      extractInlinePrompt: () => undefined,
      extractNamedTemplate: () => undefined,
      extractPromptVariable: () => undefined,
      extractQuotedDescription: () => undefined,
      extractReturnedTemplate: () => undefined,
    }));

    const [agentSnapshot, categorySnapshot, modelSnapshot] = await Promise.all([
      import('../agent-reference-snapshot.js'),
      import('../task-category-reference-snapshot.js'),
      import('../task-model-reference-snapshot.js'),
    ]);

    expect(agentSnapshot.BUILTIN_AGENT_REFERENCE_SNAPSHOT['oracle']?.systemPrompt).toContain(
      'Provide skeptical architectural review',
    );
    expect(categorySnapshot.getTaskCategoryPromptAppend('deep')).toContain('AUTONOMOUS');
    expect(modelSnapshot.getReferenceAgentModelEntries('oracle')[0]).toMatchObject({
      modelId: 'gpt-5.4',
    });
  });
});
