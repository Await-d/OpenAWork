import { describe, expect, it, vi } from 'vitest';
import { TranslationWorkflowImpl, type TranslationTask } from '../workflow/translation-workflow.js';

function makeTask(id: string, content: string): TranslationTask {
  return {
    id,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    fileName: `${id}.txt`,
    content,
  };
}

describe('TranslationWorkflowImpl', () => {
  it('calls LLM with source/target language instruction and returns translated content', async () => {
    const mockLLM = vi.fn(async () => '你好，世界');
    const workflow = new TranslationWorkflowImpl(mockLLM);

    const result = await workflow.translate(makeTask('t1', 'Hello, world'));

    expect(mockLLM).toHaveBeenCalledOnce();
    expect(mockLLM.mock.calls.at(0)?.at(0)).toContain('English');
    expect(mockLLM.mock.calls.at(0)?.at(0)).toContain('Chinese');
    expect(result.translatedContent).toBe('你好，世界');
    expect(result.status).toBe('completed');
    expect(result.taskId).toBe('t1');
    expect(result.completedAt).toBeTypeOf('number');
  });

  it('batchTranslate resolves all tasks in parallel', async () => {
    let callCount = 0;
    const mockLLM = vi.fn(async () => {
      callCount += 1;
      return `译文 ${callCount}`;
    });
    const workflow = new TranslationWorkflowImpl(mockLLM);
    const tasks = [makeTask('a', 'Alpha'), makeTask('b', 'Beta'), makeTask('c', 'Gamma')];

    const results = await workflow.batchTranslate(tasks);

    expect(results).toHaveLength(3);
    expect(mockLLM).toHaveBeenCalledTimes(3);
    expect(results.every((result) => result.status === 'completed')).toBe(true);
  });

  it('trims whitespace from the LLM response', async () => {
    const mockLLM = vi.fn(async () => '  内容  \n');
    const workflow = new TranslationWorkflowImpl(mockLLM);
    const result = await workflow.translate(makeTask('t2', 'Content'));

    expect(result.translatedContent).toBe('内容');
  });
});
