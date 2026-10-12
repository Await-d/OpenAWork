import { describe, expect, it, vi } from 'vitest';
import { PromptEvaluationParseError, PromptEvaluationUpstreamError } from './prompt-evaluation.js';
import { PromptEvaluationServiceImpl } from './prompt-evaluation-service.js';

function makeLlm(payload: unknown) {
  const wrapped =
    typeof payload === 'string'
      ? payload
      : ['评估结果：', '```json', JSON.stringify(payload), '```'].join('\n');
  const fn = vi.fn(async (_prompt: string) => wrapped);
  return fn;
}

describe('PromptEvaluationServiceImpl', () => {
  it('prompt-only 评估：解析评分、维度与补丁计划', async () => {
    const service = new PromptEvaluationServiceImpl(
      makeLlm({
        score: {
          overall: 72,
          dimensions: [
            { key: 'clarity', label: '清晰度', score: 80 },
            { key: 'specificity', label: '具体性', score: 65 },
          ],
        },
        improvements: ['补充输出格式约束', '消除「尽快」这类模糊词'],
        summary: '提示词结构清晰但缺少输出格式约束。',
        patchPlan: [
          {
            op: 'replace',
            oldText: '请尽快回复',
            newText: '请在 3 句以内回答',
            instruction: '模糊词替换为可度量约束',
          },
        ],
        stopSignals: { stopRecommendation: 'continue', overfitRisk: 'low' },
      }),
    );

    const result = await service.evaluate({
      type: 'prompt-only',
      workspacePrompt: '你是一个写作助手。请尽快回复。',
    });

    expect(result.type).toBe('prompt-only');
    expect(result.score.overall).toBe(72);
    expect(result.score.dimensions).toHaveLength(2);
    expect(result.patchPlan).toHaveLength(1);
    expect(result.patchPlan[0]).toMatchObject({ op: 'replace', oldText: '请尽快回复' });
    expect(result.stopSignals).toEqual({
      stopRecommendation: 'continue',
      overfitRisk: 'low',
    });
    expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
  });

  it('compare 评估：快照与测试用例进入 prompt，正常返回', async () => {
    const llm = makeLlm({
      score: { overall: 60, dimensions: [{ key: 'quality', label: '输出质量', score: 70 }] },
      improvements: [],
      summary: '优化版略好于原始版。',
      patchPlan: [],
      stopSignals: { targetVsBaseline: 'improved', stopRecommendation: 'stop' },
    });
    const service = new PromptEvaluationServiceImpl(llm);

    const result = await service.evaluate({
      type: 'compare',
      workspacePrompt: '优化版提示词',
      referencePrompt: '原始版提示词',
      testCases: [
        { id: 'tc-1', input: { kind: 'text', label: '样例输入', content: '总结这段文字' } },
      ],
      snapshots: [
        {
          id: 's-a',
          label: 'A',
          testCaseId: 'tc-1',
          promptRef: { kind: 'original' },
          promptText: '原始版提示词',
          output: '原始输出',
        },
        {
          id: 's-b',
          label: 'B',
          testCaseId: 'tc-1',
          promptRef: { kind: 'workspace' },
          promptText: '优化版提示词',
          output: '优化输出',
        },
      ],
    });

    expect(result.type).toBe('compare');
    expect(result.stopSignals?.targetVsBaseline).toBe('improved');
    expect(result.stopSignals?.stopRecommendation).toBe('stop');

    const sentPrompt = llm.mock.calls[0]?.[0] ?? '';
    expect(sentPrompt).toContain('对比评估 (compare)');
    expect(sentPrompt).toContain('原始版提示词');
    expect(sentPrompt).toContain('Snapshot A');
    expect(sentPrompt).toContain('Snapshot B');
  });

  it('无有效信号时省略 stopSignals', async () => {
    const service = new PromptEvaluationServiceImpl(
      makeLlm({
        score: { overall: 50, dimensions: [] },
        improvements: [],
        summary: '中性结果。',
        patchPlan: [],
        stopSignals: {},
      }),
    );

    const result = await service.evaluate({
      type: 'prompt-only',
      workspacePrompt: '提示词',
    });

    expect(result.stopSignals).toBeUndefined();
  });

  it('忽略前置噪声对象并继续解析后续合法结果', async () => {
    const service = new PromptEvaluationServiceImpl(
      makeLlm(
        [
          '示例：{"draft":true}',
          '最终结果：',
          JSON.stringify({
            score: { overall: 60, dimensions: [] },
            improvements: [],
            summary: '后一个对象才是合法结果。',
            patchPlan: [],
          }),
        ].join('\n'),
      ),
    );

    const result = await service.evaluate({
      type: 'prompt-only',
      workspacePrompt: '提示词',
    });

    expect(result.summary).toBe('后一个对象才是合法结果。');
  });

  it('没有 JSON 载荷时抛出稳定解析错误', async () => {
    const service = new PromptEvaluationServiceImpl(makeLlm('抱歉，我无法评估。'));

    await expect(
      service.evaluate({ type: 'prompt-only', workspacePrompt: '提示词' }),
    ).rejects.toBeInstanceOf(PromptEvaluationParseError);
  });

  it('上游调用失败时抛出稳定上游错误', async () => {
    const service = new PromptEvaluationServiceImpl(
      vi.fn(async () => Promise.reject(new Error('401 secret'))),
    );

    await expect(
      service.evaluate({ type: 'prompt-only', workspacePrompt: '提示词' }),
    ).rejects.toBeInstanceOf(PromptEvaluationUpstreamError);
  });
});
