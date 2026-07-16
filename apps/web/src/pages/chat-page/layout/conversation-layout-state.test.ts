import { describe, expect, it } from 'vitest';
import { resolveConversationLayoutState } from './conversation-layout-state.js';

describe('resolveConversationLayoutState', () => {
  it('在 Classic 下保持对话内容始终居中，即使编辑器已打开', () => {
    expect(
      resolveConversationLayoutState({
        editorMode: true,
        isFusionLayout: false,
        showDockedReviewPanel: false,
      }),
    ).toEqual({
      centerContent: true,
      contentMaxWidth: 720,
    });
  });

  it('在 Fusion 停靠侧栏打开时切到流式宽度并取消居中', () => {
    expect(
      resolveConversationLayoutState({
        editorMode: false,
        isFusionLayout: true,
        showDockedReviewPanel: true,
      }),
    ).toEqual({
      centerContent: false,
      contentMaxWidth: 'fluid',
    });
  });

  it('在 Fusion 未停靠侧栏时恢复 720px 居中宽度', () => {
    expect(
      resolveConversationLayoutState({
        editorMode: false,
        isFusionLayout: true,
        showDockedReviewPanel: false,
      }),
    ).toEqual({
      centerContent: true,
      contentMaxWidth: 720,
    });
  });
});
