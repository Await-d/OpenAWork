import { describe, expect, it, vi } from 'vitest';
import {
  PromptOptimizerImpl,
  PromptOptimizerResultParseError,
  PromptOptimizerUpstreamError,
} from './prompt-optimizer.js';

describe('PromptOptimizerImpl', () => {
  it('从 markdown 包裹的响应中提取 JSON 并回填默认推荐项', async () => {
    const optimizer = new PromptOptimizerImpl(
      vi.fn(async () =>
        [
          '这里是优化结果：',
          '```json',
          JSON.stringify({
            candidates: [
              {
                text: '请以中文分步骤回答，并先列出假设条件。',
                improvements: ['增加步骤分解', '补充输出约束'],
              },
            ],
            rationale: '保留原意的同时增强了执行约束。',
          }),
          '```',
        ].join('\n'),
      ),
    );

    const result = await optimizer.optimize({
      originalPrompt: '帮我优化这个提示词',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: 'candidate-1',
      text: '请以中文分步骤回答，并先列出假设条件。',
      improvements: ['增加步骤分解', '补充输出约束'],
    });
    expect(result.recommended).toBe('candidate-1');
    expect(result.rationale).toBe('保留原意的同时增强了执行约束。');
  });

  it('候选缺少 id 或 improvements 时会自动归一化', async () => {
    const optimizer = new PromptOptimizerImpl(
      vi.fn(async () =>
        JSON.stringify({
          candidates: [
            {
              id: '',
              text: '版本一',
            },
            {
              id: 'candidate-2',
              text: '版本二',
              improvements: ['专业术语替换'],
            },
            {
              id: 'candidate-2',
              text: '版本三',
              improvements: [],
            },
          ],
          recommended: 'missing-id',
        }),
      ),
    );

    const result = await optimizer.optimize({
      originalPrompt: '优化它',
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'candidate-1',
      'candidate-2',
      'candidate-2-2',
    ]);
    expect(result.candidates[0]?.improvements).toEqual([]);
    expect(result.recommended).toBe('candidate-1');
  });

  it('忽略前置噪声对象并继续解析后续合法结果', async () => {
    const optimizer = new PromptOptimizerImpl(
      vi.fn(async () =>
        [
          '先给一个示例对象：{"draft":true}',
          '最终结果如下：',
          JSON.stringify({
            candidates: [
              {
                text: '最终版本',
                improvements: ['增强执行约束'],
              },
            ],
            rationale: '后一个对象才是合法结果。',
          }),
        ].join('\n'),
      ),
    );

    const result = await optimizer.optimize({
      originalPrompt: '忽略前置噪声',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.text).toBe('最终版本');
  });

  it('在没有 JSON 载荷时抛出稳定解析错误', async () => {
    const optimizer = new PromptOptimizerImpl(vi.fn(async () => '抱歉，我现在无法生成结果。'));

    await expect(
      optimizer.optimize({
        originalPrompt: '优化失败用例',
      }),
    ).rejects.toBeInstanceOf(PromptOptimizerResultParseError);
  });

  it('上游调用失败时抛出稳定上游错误', async () => {
    const optimizer = new PromptOptimizerImpl(
      vi.fn(async () => Promise.reject(new Error('401 secret'))),
    );

    await expect(
      optimizer.optimize({
        originalPrompt: '上游错误用例',
      }),
    ).rejects.toBeInstanceOf(PromptOptimizerUpstreamError);
  });
});
