import { describe, expect, it } from 'vitest';
import {
  buildUpstreamStreamSummaryLog,
  buildUserFacingStreamErrorMessage,
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
});
