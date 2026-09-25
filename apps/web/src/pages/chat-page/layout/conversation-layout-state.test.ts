import { describe, expect, it } from 'vitest';
import {
  resolveClassicConversationLayoutState,
  resolveFusionConversationLayoutState,
  resolveResponsiveContentMaxWidth,
} from './conversation-layout-state.js';

describe('resolveClassicConversationLayoutState', () => {
  it('在 Classic 下保持对话内容始终居中，即使编辑器已打开', () => {
    expect(
      resolveClassicConversationLayoutState({
        editorMode: true,
      }),
    ).toEqual({
      centerContent: true,
      contentMaxWidth: 720,
    });
  });
});

describe('resolveFusionConversationLayoutState', () => {
  it('在 Fusion 停靠侧栏打开时切到流式宽度并取消居中', () => {
    expect(
      resolveFusionConversationLayoutState({
        showDockedReviewPanel: true,
      }),
    ).toEqual({
      centerContent: false,
      contentMaxWidth: 'fluid',
    });
  });

  it('在 Fusion 未停靠侧栏时恢复 820px 居中宽度', () => {
    expect(
      resolveFusionConversationLayoutState({
        showDockedReviewPanel: false,
      }),
    ).toEqual({
      centerContent: true,
      contentMaxWidth: 820,
    });
  });
});

describe('resolveResponsiveContentMaxWidth', () => {
  it('基准宽度作下限、容器 88% 作中间值、基准 1.5 倍作上限', () => {
    expect(resolveResponsiveContentMaxWidth(1024)).toBe('clamp(1024px, 88%, 1536px)');
    expect(resolveResponsiveContentMaxWidth(820)).toBe('clamp(820px, 88%, 1230px)');
    expect(resolveResponsiveContentMaxWidth(720)).toBe('clamp(720px, 88%, 1080px)');
  });

  it('上限取整，不出现小数 px', () => {
    expect(resolveResponsiveContentMaxWidth(683)).toBe('clamp(683px, 88%, 1025px)');
  });
});
