import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionMessageV2: vi.fn((input: { content: { text: string }[] }) => ({
    id: 'msg-new',
    ...input,
  })),
  getSessionMessageByRequestId: vi.fn(),
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessageV2,
  getSessionMessageByRequestId: mocks.getSessionMessageByRequestId,
}));

import {
  buildClientStreamErrorText,
  clientStreamErrorReportSchema,
  persistClientStreamErrorMessage,
} from '../../session/client-error-report.js';

const BASE_REPORT = {
  clientRequestId: 'req-1',
  code: 'SSE_ERROR',
  message: 'SSE 连接异常。',
};

beforeEach(() => {
  mocks.appendSessionMessageV2.mockClear();
  mocks.getSessionMessageByRequestId.mockReset();
  mocks.getSessionMessageByRequestId.mockReturnValue(null);
});

describe('buildClientStreamErrorText', () => {
  it('正文格式与网关侧 buildErrorContent 一致，前端解析器可直接还原错误卡片', () => {
    expect(buildClientStreamErrorText({ code: 'SSE_ERROR', message: 'SSE 连接异常。' })).toBe(
      '[错误: SSE_ERROR] SSE 连接异常。',
    );
  });

  it('技术详情追加在「技术详情：」之后', () => {
    expect(
      buildClientStreamErrorText({
        code: 'WS_CLOSED',
        message: 'WebSocket 连接已关闭。',
        technicalDetail: '连接在流式传输过程中中断。',
      }),
    ).toBe('[错误: WS_CLOSED] WebSocket 连接已关闭。\n\n技术详情：连接在流式传输过程中中断。');
  });

  it('技术详情与摘要重复时不重复追加', () => {
    expect(
      buildClientStreamErrorText({
        code: 'SSE_ERROR',
        message: 'SSE 连接异常。',
        technicalDetail: 'SSE 连接异常。',
      }),
    ).toBe('[错误: SSE_ERROR] SSE 连接异常。');
  });

  it('产出的正文能通过前端 looksLikeAssistantErrorContent 的前缀判定', () => {
    const text = buildClientStreamErrorText({ code: 'WS_INVALID_PAYLOAD', message: '解析失败。' });
    expect(/^\[错误:\s*[A-Za-z0-9_]+\]/.test(text)).toBe(true);
  });
});

describe('clientStreamErrorReportSchema', () => {
  it('拒绝无法通过前端前缀正则的错误码', () => {
    expect(
      clientStreamErrorReportSchema.safeParse({ ...BASE_REPORT, code: 'SSE-ERROR' }).success,
    ).toBe(false);
  });

  it('拒绝超长正文与技术详情', () => {
    expect(
      clientStreamErrorReportSchema.safeParse({ ...BASE_REPORT, message: 'x'.repeat(2_001) })
        .success,
    ).toBe(false);
    expect(
      clientStreamErrorReportSchema.safeParse({
        ...BASE_REPORT,
        technicalDetail: 'x'.repeat(4_001),
      }).success,
    ).toBe(false);
  });
});

describe('persistClientStreamErrorMessage', () => {
  it('没有既有消息时落库 assistant + status=error，并带上 clientRequestId', () => {
    const result = persistClientStreamErrorMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      report: { ...BASE_REPORT, technicalDetail: '连接在收到 SSE 响应前中断。' },
    });

    expect(result).toEqual({ outcome: 'persisted', messageId: 'msg-new' });
    expect(mocks.appendSessionMessageV2).toHaveBeenCalledTimes(1);
    expect(mocks.appendSessionMessageV2).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'req-1',
        content: [
          {
            type: 'text',
            text: '[错误: SSE_ERROR] SSE 连接异常。\n\n技术详情：连接在收到 SSE 响应前中断。',
          },
        ],
        role: 'assistant',
        sessionId: 'session-1',
        status: 'error',
        userId: 'user-1',
      }),
    );
  });

  it('网关侧已落库失败时幂等丢弃，不写第二条', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue({
      message: { id: 'msg-gateway' },
      status: 'error',
    });

    const result = persistClientStreamErrorMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      report: BASE_REPORT,
    });

    expect(result).toEqual({ outcome: 'deduplicated', messageId: 'msg-gateway' });
    expect(mocks.appendSessionMessageV2).not.toHaveBeenCalled();
  });

  it('该请求已成功完成时不把迟到的传输错误反写成失败', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue({
      message: { id: 'msg-final' },
      status: 'final',
    });

    const result = persistClientStreamErrorMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      report: BASE_REPORT,
    });

    expect(result).toEqual({ outcome: 'skipped_existing', messageId: 'msg-final' });
    expect(mocks.appendSessionMessageV2).not.toHaveBeenCalled();
  });

  it('幂等准入按 role=assistant + clientRequestId 查询', () => {
    persistClientStreamErrorMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      report: BASE_REPORT,
    });

    expect(mocks.getSessionMessageByRequestId).toHaveBeenCalledWith({
      clientRequestId: 'req-1',
      role: 'assistant',
      sessionId: 'session-1',
      userId: 'user-1',
    });
  });
});
