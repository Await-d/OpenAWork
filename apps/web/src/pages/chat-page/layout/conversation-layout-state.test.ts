import { describe, expect, it } from 'vitest';
import {
  resolveClassicConversationLayoutState,
  resolveFusionConversationLayoutState,
  resolveResponsiveContentMaxWidth,
  SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT,
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
  it('窄/中屏按容器 80% 收窄，超宽屏放宽到基准 1.6 倍', () => {
    expect(resolveResponsiveContentMaxWidth(1024)).toBe('min(1638px, max(80%, 420px))');
    expect(resolveResponsiveContentMaxWidth(820)).toBe('min(1312px, max(80%, 420px))');
    expect(resolveResponsiveContentMaxWidth(720)).toBe('min(1152px, max(80%, 420px))');
  });

  it('上限取整，不出现小数 px', () => {
    expect(resolveResponsiveContentMaxWidth(683)).toBe('min(1093px, max(80%, 420px))');
  });

  it('基准抬高后收敛到 1800px 硬顶，不再无限放大', () => {
    expect(resolveResponsiveContentMaxWidth(1536)).toBe('min(1800px, max(80%, 420px))');
  });

  it('split 布局用 96% 占比，尽量吃满容器给左右分列留出行宽', () => {
    expect(resolveResponsiveContentMaxWidth(1536, SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT)).toBe(
      'min(1800px, max(96%, 420px))',
    );
  });
});
