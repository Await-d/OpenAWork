import { describe, expect, it } from 'vitest';
import { buildAssistantMetaItems } from './message-row.js';

describe('buildAssistantMetaItems', () => {
  it('在详细元信息全部关闭时保留简化后的回复提示', () => {
    const items = buildAssistantMetaItems({
      messageStatus: 'completed',
      presentationMode: 'chat',
      toolLabel: null,
      modifiedFileCount: 0,
      tokenCount: 128,
      usageDetails: {
        requestIndex: 3,
        totalTokens: 128,
        inputTokens: 64,
        outputTokens: 64,
        durationMs: 2400,
      },
      durationLabel: '2.4s',
      stopReasonLabel: '正常结束',
      showDuration: false,
      showStopReason: false,
      showTokenBreakdown: false,
      showEstimatedTokens: false,
      showRequestIndex: true,
      showToolCount: false,
    });

    expect(items).toEqual([{ label: '请求 3' }]);
  });

  it('错误消息即使隐藏详细项也保留可理解的异常提示', () => {
    const items = buildAssistantMetaItems({
      messageStatus: 'error',
      presentationMode: 'chat',
      toolLabel: null,
      modifiedFileCount: 0,
      tokenCount: 0,
      durationLabel: null,
      stopReasonLabel: null,
      showDuration: false,
      showStopReason: false,
      showTokenBreakdown: false,
      showEstimatedTokens: false,
      showRequestIndex: false,
      showToolCount: false,
    });

    expect(items).toEqual([{ label: '错误', tone: 'danger' }]);
  });

  it('停止消息即使关闭 stopReason 偏好也保留「已停止」提示', () => {
    const items = buildAssistantMetaItems({
      messageStatus: 'cancelled',
      presentationMode: 'chat',
      toolLabel: null,
      modifiedFileCount: 0,
      tokenCount: 0,
      durationLabel: null,
      stopReasonLabel: '已停止',
      showDuration: false,
      showStopReason: false,
      showTokenBreakdown: false,
      showEstimatedTokens: false,
      showRequestIndex: false,
      showToolCount: false,
    });

    expect(items).toEqual([{ label: '已停止', tone: 'accent' }]);
  });

  it('工具调用仍优先保留简化后的关键信号', () => {
    const items = buildAssistantMetaItems({
      messageStatus: 'completed',
      presentationMode: 'chat',
      toolLabel: '2 工具',
      modifiedFileCount: 0,
      tokenCount: 0,
      durationLabel: null,
      stopReasonLabel: null,
      showDuration: false,
      showStopReason: false,
      showTokenBreakdown: false,
      showEstimatedTokens: false,
      showRequestIndex: false,
      showToolCount: false,
    });

    expect(items).toEqual([{ label: '已执行工具', tone: 'accent' }]);
  });

  it('team 模式在没有额外元信息时不注入 chat 专属兜底文案', () => {
    const items = buildAssistantMetaItems({
      messageStatus: 'completed',
      presentationMode: 'team',
      toolLabel: null,
      modifiedFileCount: 0,
      tokenCount: 0,
      durationLabel: null,
      stopReasonLabel: null,
      showDuration: false,
      showStopReason: false,
      showTokenBreakdown: false,
      showEstimatedTokens: false,
      showRequestIndex: false,
      showToolCount: false,
    });

    expect(items).toEqual([]);
  });
});
