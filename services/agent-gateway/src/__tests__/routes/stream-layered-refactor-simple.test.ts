/**
 * stream-layered-refactor-simple.test.ts — 分层重构集成测试（简化版）
 *
 * T-08: 建立测试用例
 *
 * 测试范围（仅测试纯函数，无 mock）：
 * - stream-auth.ts：JSON 解析
 * - stream-sse-encoder.ts：事件编码
 * - stream-error-handler.ts：错误处理
 */

import { describe, it, expect } from 'vitest';
import { parseSessionProviderSelection, parseStoredJson } from '../../routes/stream-auth.js';
import {
  createRunEventMeta,
  createUpstreamRouteChunk,
  createRouteOnlyUpstreamSummary,
  createStreamErrorEvent,
  createRunAcceptedEvent,
  type EventSequence,
} from '../../routes/stream-sse-encoder.js';
import {
  STREAM_ERROR_MESSAGES,
  TeamModelBindingUnavailableError,
  buildErrorContent,
  isTeamModelBindingUnavailable,
} from '../../routes/stream-error-handler.js';

// ─────────────────────────────────────────────────────────────────
// Test Suite: stream-auth.ts 纯函数测试
// ─────────────────────────────────────────────────────────────────

describe('stream-auth 纯函数', () => {
  describe('parseSessionProviderSelection', () => {
    it('应解析会话元数据中的 agentId', () => {
      const metadata = JSON.stringify({
        agentId: 'claude-agent',
        providerId: 'anthropic',
      });
      const result = parseSessionProviderSelection(metadata);
      expect(result.agentId).toBe('claude-agent');
      expect(result.providerId).toBe('anthropic');
    });

    it('应返回空对象当 metadata 为无效 JSON', () => {
      const result = parseSessionProviderSelection('invalid json');
      expect(result).toEqual({});
    });

    it('应从 channel 对象提取 providerId 作为后备', () => {
      const metadata = JSON.stringify({
        channel: {
          providerId: 'openai',
          model: 'gpt-4o',
        },
      });
      const result = parseSessionProviderSelection(metadata);
      expect(result.providerId).toBe('openai');
      expect(result.modelId).toBe('gpt-4o');
    });

    it('应处理空 channel 对象', () => {
      const metadata = JSON.stringify({
        channel: null,
        agentId: 'test-agent',
      });
      const result = parseSessionProviderSelection(metadata);
      expect(result.agentId).toBe('test-agent');
      expect(result.providerId).toBeUndefined();
    });

    it('应解析会话级 contextWindowOverride，并忽略非法取值', () => {
      const parsed = parseSessionProviderSelection(
        JSON.stringify({ contextWindowOverride: 400_000 }),
      );
      expect(parsed.contextWindowOverride).toBe(400_000);

      // 非正整数（含 null / 字符串 / 0 / 小数）一律视为「本会话未覆盖」。
      for (const invalid of [null, '400000', 0, -1, 1.5]) {
        expect(
          parseSessionProviderSelection(JSON.stringify({ contextWindowOverride: invalid }))
            .contextWindowOverride,
        ).toBeUndefined();
      }
    });
  });

  describe('parseStoredJson', () => {
    it('应正确解析有效的 JSON 字符串', () => {
      const json = JSON.stringify({ key: 'value' });
      const result = parseStoredJson<{ key: string }>(json);
      expect(result).toEqual({ key: 'value' });
    });

    it('应返回 undefined 当输入为 undefined', () => {
      const result = parseStoredJson(undefined);
      expect(result).toBeUndefined();
    });

    it('应返回 undefined 当 JSON 解析失败', () => {
      const result = parseStoredJson('not valid json');
      expect(result).toBeUndefined();
    });

    it('应处理空字符串', () => {
      const result = parseStoredJson('');
      expect(result).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Test Suite: stream-sse-encoder.ts 纯函数测试
// ─────────────────────────────────────────────────────────────────

describe('stream-sse-encoder 纯函数', () => {
  describe('createRunEventMeta', () => {
    it('应生成递增的 eventId', () => {
      const runId = 'run-123';
      const sequence: EventSequence = { value: 1 };

      const meta1 = createRunEventMeta(runId, sequence);
      const meta2 = createRunEventMeta(runId, sequence);

      expect(meta1.eventId).toBe('run-123:evt:1');
      expect(meta2.eventId).toBe('run-123:evt:2');
      expect(sequence.value).toBe(3);
    });

    it('应记录当前时间戳', () => {
      const runId = 'run-456';
      const sequence: EventSequence = { value: 1 };
      const beforeTime = Date.now();

      const meta = createRunEventMeta(runId, sequence);

      const afterTime = Date.now();
      expect(meta.occurredAt).toBeGreaterThanOrEqual(beforeTime);
      expect(meta.occurredAt).toBeLessThanOrEqual(afterTime);
    });

    it('应包含正确的 runId', () => {
      const runId = 'run-test';
      const sequence: EventSequence = { value: 1 };
      const meta = createRunEventMeta(runId, sequence);
      expect(meta.runId).toBe(runId);
    });
  });

  describe('createUpstreamRouteChunk', () => {
    it('应创建包含模型和提供商的路由事件', () => {
      const sequence: EventSequence = { value: 1 };
      const event = createUpstreamRouteChunk({
        modelId: 'gpt-4o',
        providerId: 'openai',
        runId: 'run-789',
        sequence,
        requestId: 'req-123',
      });

      expect(event.type).toBe('upstream_route');
      expect(event.modelId).toBe('gpt-4o');
      expect(event.providerId).toBe('openai');
      expect(event.requestId).toBe('req-123');
    });

    it('应处理缺失的可选字段', () => {
      const sequence: EventSequence = { value: 1 };
      const event = createUpstreamRouteChunk({
        modelId: 'gpt-4o',
        runId: 'run-minimal',
        sequence,
      });

      expect(event.type).toBe('upstream_route');
      expect(event.modelId).toBe('gpt-4o');
      expect(event.providerId).toBeUndefined();
    });
  });

  describe('createRouteOnlyUpstreamSummary', () => {
    it('应生成仅包含路由的摘要', () => {
      const summary = createRouteOnlyUpstreamSummary({
        modelId: 'gpt-4o',
        providerId: 'openai',
        stopReason: 'end_turn',
      });

      expect(summary.stopReason).toBe('end_turn');
      expect(summary.modelId).toBe('gpt-4o');
      expect(summary.providerId).toBe('openai');
      expect(summary.textDeltaCount).toBe(0);
    });

    it('应标记错误摘要的状态', () => {
      const summary = createRouteOnlyUpstreamSummary({
        stopReason: 'error',
      });

      expect(summary.stopReason).toBe('error');
      expect(summary.sawError).toBe(true);
      expect(summary.stalled).toBe(true);
    });
  });

  describe('createStreamErrorEvent', () => {
    it('应创建带错误码和消息的错误事件', () => {
      const event = createStreamErrorEvent({
        code: 'TEST_ERROR',
        message: '测试错误消息',
        runId: 'run-error',
      });

      expect(event.type).toBe('error');
      expect(event.code).toBe('TEST_ERROR');
      expect(event.message).toBe('测试错误消息');
      expect(event.runId).toBe('run-error');
    });

    it('应包含技术细节当提供时', () => {
      const event = createStreamErrorEvent({
        code: 'DETAILED_ERROR',
        message: '用户消息',
        runId: 'run-detail',
        technicalDetail: '技术细节信息',
      });

      expect(event.technicalDetail).toBe('技术细节信息');
    });

    it('应在技术细节为空时不包含', () => {
      const event = createStreamErrorEvent({
        code: 'NO_DETAIL',
        message: '消息',
        runId: 'run-no-detail',
        technicalDetail: '   ',
      });

      expect(event.technicalDetail).toBeUndefined();
    });
  });

  describe('createRunAcceptedEvent', () => {
    it('应创建受理事件，不包含序列号', () => {
      const event = createRunAcceptedEvent({
        runId: 'run-accepted',
        requestId: 'req-456',
      });

      expect(event.type).toBe('run_accepted');
      if (event.type !== 'run_accepted') {
        throw new Error('预期运行受理事件');
      }
      expect(event.runId).toBe('run-accepted');
      expect(event.requestId).toBe('req-456');
      expect(event.eventId).toContain('run-accepted:accepted');
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Test Suite: stream-error-handler.ts 纯函数测试
// ─────────────────────────────────────────────────────────────────

describe('stream-error-handler 纯函数', () => {
  describe('TeamModelBindingUnavailableError', () => {
    it('应创建具有正确错误码的自定义错误', () => {
      const error = new TeamModelBindingUnavailableError();

      expect(error.code).toBe('TEAM_MODEL_BINDING_UNAVAILABLE');
      expect(error.message).toBe(STREAM_ERROR_MESSAGES.teamModelBindingUnavailable);
    });

    it('isTeamModelBindingUnavailable 应识别该错误类型', () => {
      const error = new TeamModelBindingUnavailableError();
      expect(isTeamModelBindingUnavailable(error)).toBe(true);

      const otherError = new Error('其他错误');
      expect(isTeamModelBindingUnavailable(otherError)).toBe(false);
    });
  });

  describe('buildErrorContent', () => {
    it('应构建格式化的错误消息内容', () => {
      const content = buildErrorContent('ERROR_CODE', '错误描述');

      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: 'text', text: '[错误: ERROR_CODE] 错误描述' });
    });
  });

  describe('STREAM_ERROR_MESSAGES', () => {
    it('应包含所有必需的错误消息键', () => {
      expect(STREAM_ERROR_MESSAGES.inputImageMissingSource).toBeDefined();
      expect(STREAM_ERROR_MESSAGES.requestReplayFailed).toBeDefined();
      expect(STREAM_ERROR_MESSAGES.sessionAlreadyRunning).toBeDefined();
      expect(STREAM_ERROR_MESSAGES.teamModelBindingUnavailable).toBeDefined();
    });

    it('所有错误消息应为非空字符串', () => {
      Object.values(STREAM_ERROR_MESSAGES).forEach((message) => {
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Integration Tests: 模块间通信
// ─────────────────────────────────────────────────────────────────

describe('stream-layered-refactor-integration', () => {
  it('应完整流转：错误处理 → SSE 编码 → 事件', () => {
    // 使用 stream-error-handler 建立错误
    const errorContent = buildErrorContent('AUTH_FAILED', '未授权');
    expect(errorContent[0]?.type).toBe('text');

    // 使用 stream-sse-encoder 编码为事件
    const event = createStreamErrorEvent({
      code: 'AUTH_FAILED',
      message: '未授权',
      runId: 'run-integration',
    });

    expect(event.type).toBe('error');
    expect(event.code).toBe('AUTH_FAILED');
  });

  it('应支持完整的事件序列流转', () => {
    const sequence: EventSequence = { value: 1 };
    const accepted = createRunAcceptedEvent({ runId: 'run-sequence', requestId: 'req-sequence' });
    expect(accepted.type).toBe('run_accepted');

    // 2. 路由确定
    const routeEvent = createUpstreamRouteChunk({
      modelId: 'gpt-4o',
      providerId: 'openai',
      runId: 'run-sequence',
      sequence,
      requestId: 'req-sequence',
    });
    expect(routeEvent.type).toBe('upstream_route');

    // 3. 完成
    const doneEvent = {
      type: 'done' as const,
      stopReason: 'end_turn' as const,
      ...createRunEventMeta('run-sequence', sequence),
    };
    expect(doneEvent.eventId).toBe('run-sequence:evt:2');
  });

  it('应验证模块返回类型一致性', () => {
    // 验证错误分类和转换
    const teamError = new TeamModelBindingUnavailableError();
    expect(isTeamModelBindingUnavailable(teamError)).toBe(true);

    // 验证 SSE 事件类型
    const runMeta = createRunEventMeta('run-test', { value: 1 });
    expect(runMeta).toHaveProperty('eventId');
    expect(runMeta).toHaveProperty('runId');
    expect(runMeta).toHaveProperty('occurredAt');
  });
});
