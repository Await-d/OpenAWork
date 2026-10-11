import { describe, expect, it } from 'vitest';
import {
  resolveClassicConversationLayoutState,
  resolveFusionConversationLayoutState,
  resolveResponsiveContentMaxWidth,
  SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT,
} from './conversation-layout-state.js';

describe('resolveClassicConversationLayoutState', () => {
  it('Classic 下内容始终居中,按容器占比自适应', () => {
    expect(resolveClassicConversationLayoutState()).toEqual({
      centerContent: true,
      contentMaxWidth: 'centered',
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

  it('在 Fusion 未停靠侧栏时保持居中,按容器占比自适应', () => {
    expect(
      resolveFusionConversationLayoutState({
        showDockedReviewPanel: false,
      }),
    ).toEqual({
      centerContent: true,
      contentMaxWidth: 'centered',
    });
  });
});

describe('resolveResponsiveContentMaxWidth', () => {
  it('默认按容器 72% 自适应并保底 420px,不设上限', () => {
    expect(resolveResponsiveContentMaxWidth()).toBe('max(72%, 420px)');
  });

  it('split 布局用 96% 占比,尽量吃满容器给左右分列留出行宽', () => {
    expect(resolveResponsiveContentMaxWidth(SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT)).toBe(
      'max(96%, 420px)',
    );
  });
});