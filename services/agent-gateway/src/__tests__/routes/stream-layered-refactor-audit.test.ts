import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCategory,
  extractSafeErrorInfo,
  logExpectedError,
  logRecoverableToolError,
  logUnexpectedError,
  structuredLog,
} from '../../infra/error-handling.js';
import { logGatewayError, logGatewayInfo, logGatewayWarn } from '../../infra/gateway-logger.js';
import {
  recordStreamError,
  recordRouteResolutionError,
  extractErrorDiagnostics,
} from '../../routes/stream-error-handler.js';

const { writeAuditLog } = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock('../../infra/audit-log.js', () => ({ writeAuditLog }));
vi.mock(import('../../infra/gateway-logger.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  logGatewayError: vi.fn(),
  logGatewayWarn: vi.fn(),
  logGatewayInfo: vi.fn(),
}));

describe('网关结构化错误审计', () => {
  it('安全错误摘要对 Error 和非 Error 的凭据脱敏，同时保留诊断码', () => {
    const error = Object.assign(
      new Error('Authorization: Bearer exposed-token api_key=secret-value'),
      {
        code: 'ETIMEDOUT',
      },
    );
    expect(extractSafeErrorInfo(error)).toEqual({
      message: 'Authorization: Bearer [REDACTED] api_key=[REDACTED]',
      code: 'ETIMEDOUT',
    });
    expect(extractSafeErrorInfo('password=plain-secret').message).not.toContain('plain-secret');
  });

  it('未知错误的恶意 toString 不得中断摘要或诊断提取', () => {
    const error = {
      toString() {
        throw new Error('不得调用未知对象的转换方法');
      },
    };
    expect(() => extractSafeErrorInfo(error)).not.toThrow();
    expect(() => extractErrorDiagnostics(error)).not.toThrow();
    const recorded = recordStreamError({
      error,
      sessionId: 'unknown-session',
      userId: 'unknown-user',
      clientRequestId: 'unknown-request',
      transport: 'SSE',
    });
    expect(recorded.message).toBe('[Unknown error]');
    expect(() =>
      recordRouteResolutionError({
        error,
        sessionId: 'unknown-session',
        clientRequestId: 'unknown-request',
      }),
    ).not.toThrow();
    const codedError = Object.assign(new Error('连接失败'), { code: error });
    expect(() => extractSafeErrorInfo(codedError)).not.toThrow();
    expect(() =>
      logUnexpectedError(
        {} as FastifyInstance,
        { requestId: 'unknown-request' },
        '执行失败',
        error,
      ),
    ).not.toThrow();
  });

  it('HTTPS URL 仅保留定位信息，不输出 userinfo、签名或查询凭据', () => {
    const url =
      'https://url-user:url-password@example.com/api?sig=sign-secret&signature=signature-secret&custom=custom-secret#fragment-secret';
    const error = Object.assign(new Error(`连接失败 ${url}`), { code: 'ETIMEDOUT' });
    const info = extractSafeErrorInfo(error);
    expect(info.code).toBe('ETIMEDOUT');
    expect(info.message).toContain('https://example.com/api');
    structuredLog(
      {} as FastifyInstance,
      ErrorCategory.NETWORK_ERROR,
      { requestId: 'request-url', endpoint: url },
      `请求失败 ${url}`,
      true,
      { originalError: error, message: url },
    );
    const result = recordStreamError({
      error,
      sessionId: 'session-url',
      userId: 'user-url',
      clientRequestId: 'request-url',
      transport: 'SSE',
    });
    recordRouteResolutionError({ error, sessionId: 'session-url', clientRequestId: 'request-url' });
    const output = JSON.stringify([
      info,
      result,
      extractErrorDiagnostics(error),
      vi.mocked(logGatewayWarn).mock.calls.at(-1),
      vi.mocked(logGatewayError).mock.calls.at(-1),
      writeAuditLog.mock.calls.slice(-2),
    ]);
    for (const secret of [
      'url-user',
      'url-password',
      'sign-secret',
      'signature-secret',
      'custom-secret',
      'fragment-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('日志和审计保留可检索的标准字段且不传递原始凭据或 Error', () => {
    const error = new Error('Authorization: Bearer exposed-token');
    structuredLog(
      {} as FastifyInstance,
      ErrorCategory.NETWORK_ERROR,
      { sessionId: 'session-a', requestId: 'request-a', token: 'context-secret' },
      '连接失败 token=reason-secret',
      true,
      { originalError: error, message: 'api_key=metadata-secret', code: 'ETIMEDOUT' },
    );

    expect(logGatewayWarn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        category: 'network_error',
        context: { sessionId: 'session-a', requestId: 'request-a', token: '[REDACTED]' },
        recoverable: true,
        metadata: expect.objectContaining({ code: 'ETIMEDOUT' }),
      }),
    );
    for (const call of [
      vi.mocked(logGatewayWarn).mock.calls.at(-1),
      writeAuditLog.mock.calls.at(-1),
    ]) {
      const output = JSON.stringify(call);
      for (const secret of [
        'exposed-token',
        'context-secret',
        'reason-secret',
        'metadata-secret',
      ]) {
        expect(output).not.toContain(secret);
      }
    }
  });

  it('流式错误 helper 的日志首参数、堆栈和返回值均不泄露凭据', () => {
    const error = new Error('Authorization: Bearer exposed-token password=stack-secret');
    const result = recordStreamError({
      error,
      sessionId: 'session-a',
      userId: 'user-a',
      clientRequestId: 'request-a',
      transport: 'SSE',
    });
    const diagnostic = extractErrorDiagnostics(error);
    const output = JSON.stringify([
      result,
      diagnostic,
      vi.mocked(logGatewayError).mock.calls.at(-1),
      writeAuditLog.mock.calls.at(-1),
    ]);
    expect(output).not.toContain('exposed-token');
    expect(output).not.toContain('stack-secret');
    expect(result.stack).toContain('Error:');
  });

  it('错误记录交给既有审计存储，而不是成功完成 noop', () => {
    structuredLog(
      {} as FastifyInstance,
      ErrorCategory.NETWORK_ERROR,
      { sessionId: 'session-a', requestId: 'request-a', userId: 'user-a' },
      '上游连接超时',
      true,
      { message: 'timeout', code: 'ETIMEDOUT' },
    );

    expect(writeAuditLog).toHaveBeenCalledWith({
      sessionId: 'session-a',
      requestId: 'request-a',
      category: 'stream',
      sourceName: 'network_error',
      output: {
        message: '上游连接超时',
        code: 'ETIMEDOUT',
        detail: 'timeout',
        recoverable: true,
        context: { sessionId: 'session-a', requestId: 'request-a', userId: 'user-a' },
      },
    });
  });

  it('预留快捷入口（logExpectedError / logRecoverableToolError）仍按各自类别落结构化日志', () => {
    // 这三个 helper 当前生产引用为 0（保留的 staged API 面），但契约不能腐烂：
    // 它们是 structuredLog 的类别/可恢复性预设包装，一旦接线必须仍走同一路径。
    logExpectedError(
      {} as FastifyInstance,
      ErrorCategory.PERMISSION_DENIED,
      { sessionId: 'session-b', requestId: 'request-b' },
      '用户无权访问该会话',
    );
    expect(logGatewayInfo).toHaveBeenLastCalledWith(
      expect.stringContaining('[permission_denied]'),
      expect.objectContaining({
        category: 'permission_denied',
        recoverable: false,
      }),
    );

    logRecoverableToolError(
      {} as FastifyInstance,
      { sessionId: 'session-b', requestId: 'request-b', toolName: 'bash' },
      '工具执行超时，将重试',
      { attempt: 1, maxAttempts: 3 },
    );
    expect(logGatewayError).toHaveBeenLastCalledWith(
      expect.stringContaining('[tool_execution_failed]'),
      expect.objectContaining({
        category: 'tool_execution_failed',
        recoverable: true,
        context: expect.objectContaining({ toolName: 'bash' }),
      }),
    );
  });
});
