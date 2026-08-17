import { describe, expect, it } from 'vitest';
import {
  resolveClassicConversationLayoutState,
  resolveFusionConversationLayoutState,
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
