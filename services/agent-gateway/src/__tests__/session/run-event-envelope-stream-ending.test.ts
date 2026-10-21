/**
 * 回归：`/stream/attach` 的活订阅**不能**被非终态 error 事件收尾。
 *
 * 现场（单次 run 的持久化事件）：同一 clientRequestId 下出现 90 条
 * `TOOL_ERROR`（“Tool bash 的入参不是合法 JSON，已放弃本次调用”），run 一直在跑。
 * 旧实现用 `deriveRunEventBookend(event)?.terminal === true` 判断收尾，而任何
 * `error` 都被映射成 `run_failed`（terminal: true），于是每出现一条 `TOOL_ERROR`
 * 服务端就把 SSE 正常 EOF 掉；客户端收到的只是普通 error chunk（`TOOL_ERROR` 是
 * 明确登记的非终态码，只透传提示、不结算），只能把这次 EOF 判成「流式传输中连接
 * 中断」，随后重连——`/stream/active` 又始终报告活跃流，于是无限循环。
 *
 * 这组断言锁死两侧共用同一份名单后的语义：非终态 error 不结束订阅，其余终态语义
 * （done / 致命 error）保持不变。
 */

import { describe, expect, it } from 'vitest';

import { NON_TERMINAL_STREAM_ERROR_CODES } from '@openAwork/shared';

import {
  deriveRunEventBookend,
  isStreamEndingRunEvent,
  isTerminalRunEvent,
} from '../../session/run-event-envelope.js';

describe('isStreamEndingRunEvent', () => {
  it('非终态 error（TOOL_ERROR）不结束订阅，尽管 bookend 标记为终态', () => {
    const toolError = {
      type: 'error' as const,
      code: 'TOOL_ERROR',
      message: 'Tool bash 的入参不是合法 JSON，已放弃本次调用',
    };

    // 通用语义仍然认为它是 run_failed —— 这正是不能直接拿它判收尾的原因。
    expect(deriveRunEventBookend(toolError)?.terminal).toBe(true);
    expect(isTerminalRunEvent(toolError)).toBe(true);
    expect(isStreamEndingRunEvent(toolError)).toBe(false);
  });

  it('名单里的每一个错误码都不结束订阅', () => {
    for (const code of NON_TERMINAL_STREAM_ERROR_CODES) {
      expect(isStreamEndingRunEvent({ type: 'error', code, message: '流内非终态错误' })).toBe(
        false,
      );
    }
  });

  it('致命 error（终态）仍然结束订阅', () => {
    const fatal = {
      type: 'error' as const,
      code: 'UPSTREAM_STREAM_ERROR',
      message: '上游流式响应中断',
    };
    expect(isStreamEndingRunEvent(fatal)).toBe(true);
  });

  it('done 的完成 / 取消分支结束订阅', () => {
    expect(isStreamEndingRunEvent({ type: 'done', stopReason: 'end_turn' })).toBe(true);
    expect(isStreamEndingRunEvent({ type: 'done', stopReason: 'cancelled' })).toBe(true);
  });

  it('done 的工具交接 / 权限挂起分支不结束订阅', () => {
    expect(isStreamEndingRunEvent({ type: 'done', stopReason: 'tool_use' })).toBe(false);
    expect(isStreamEndingRunEvent({ type: 'done', stopReason: 'tool_permission' })).toBe(false);
  });

  it('交互挂起与普通增量事件不结束订阅', () => {
    expect(
      isStreamEndingRunEvent({
        type: 'permission_asked',
        requestId: 'perm-1',
        toolName: 'bash',
        scope: 'bash rm -rf',
        reason: '需要用户批准',
        riskLevel: 'high',
      }),
    ).toBe(false);
    expect(
      isStreamEndingRunEvent({
        type: 'question_asked',
        requestId: 'q-1',
        toolName: 'question',
        title: '选择实现方案',
      }),
    ).toBe(false);
    expect(isStreamEndingRunEvent({ type: 'text_delta', delta: '继续' })).toBe(false);
  });
});
