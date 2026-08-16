import { describe, expect, it } from 'vitest';
import {
  buildUpstreamStreamSummaryLog,
  buildUserFacingStreamErrorMessage,
  toUpstreamStreamSummary,
} from '../../routes/stream-model-round.js';

describe('buildUserFacingStreamErrorMessage', () => {
  it('优先使用上游分类后的用户态消息', () => {
    expect(
      buildUserFacingStreamErrorMessage({
        classificationMessage: 'Provider is overloaded',
        fallbackMessage: 'socket hang up',
      }),
    ).toBe('模型服务当前负载过高，请稍后重试。');
  });

  it('会把限流类英文分类消息映射为中文', () => {
    expect(
      buildUserFacingStreamErrorMessage({
        classificationMessage: 'Rate Limited',
        fallbackMessage: '429',
      }),
    ).toBe('请求过于频繁，请稍后重试。');
    expect(
      buildUserFacingStreamErrorMessage({
        classificationMessage: 'Too Many Requests',
        fallbackMessage: '429',
      }),
    ).toBe('请求过于频繁，请稍后重试。');
  });

  it('分类消息缺失时回退到统一中文兜底，不直接暴露技术细节', () => {
    expect(
      buildUserFacingStreamErrorMessage({
        fallbackMessage: 'socket hang up',
      }),
    ).toBe('流式响应处理中断，请稍后重试。');
  });
});

describe('buildUpstreamStreamSummaryLog', () => {
  it('为取消场景输出统一的流摘要结构', () => {
    expect(
      buildUpstreamStreamSummaryLog({
        model: 'gpt-test',
        round: 2,
        upstreamProtocol: 'responses',
        stopReason: 'cancelled',
        diagnostics: {
          textDeltaCount: 3,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: false,
          stalled: false,
        },
      }),
    ).toEqual({
      input: {
        model: 'gpt-test',
        round: 2,
        upstreamProtocol: 'responses',
      },
      output: {
        stopReason: 'cancelled',
        textDeltaCount: 3,
        reasoningDeltaCount: 1,
        toolCallDeltaCount: 0,
        sawDone: false,
        sawError: false,
        stalled: false,
      },
      isError: false,
    });
  });

  it('流摘要即使 stopReason=error 也不应单独生成诊断错误', () => {
    expect(
      buildUpstreamStreamSummaryLog({
        model: 'gpt-test',
        round: 1,
        upstreamProtocol: 'responses',
        stopReason: 'cancelled',
        diagnostics: {
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: false,
          stalled: false,
        },
      }).isError,
    ).toBe(false);

    expect(
      buildUpstreamStreamSummaryLog({
        model: 'gpt-test',
        round: 1,
        upstreamProtocol: 'responses',
        stopReason: 'error',
        diagnostics: {
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: true,
          stalled: false,
        },
      }).isError,
    ).toBe(false);
  });
});

describe('toUpstreamStreamSummary', () => {
  it('把实际上游模型与 provider 一起带回前端', () => {
    expect(
      toUpstreamStreamSummary(
        'end_turn',
        {
          textDeltaCount: 2,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 0,
          sawDone: true,
          sawError: false,
          stalled: false,
          openaiServiceTier: 'priority',
        },
        {
          model: 'gpt-5.4',
          providerId: 'openai-fast',
          providerType: 'openai',
        },
      ),
    ).toEqual({
      stopReason: 'end_turn',
      textDeltaCount: 2,
      reasoningDeltaCount: 1,
      toolCallDeltaCount: 0,
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
      openaiServiceTier: 'priority',
      sawDone: true,
      sawError: false,
      stalled: false,
    });
  });
});
