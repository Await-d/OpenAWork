// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ canManageSessionEntries: true }));

const sendMessageMock = vi.hoisted(() =>
  vi.fn(async (_payload: { content: string; type: string; sessionId?: string }) => true),
);

// 与 TasksTab.test.tsx 同一口径：整块替身 reference view data，只暴露被测输入框
// 依赖的字段（`sendMessage` 是留言提交的唯一出口）。
vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    activeSharedSession: null,
    busy: false,
    canManageSessionEntries: state.canManageSessionEntries,
    createSharedSessionComment: async () => true,
    error: null,
    feedback: null,
    messageCards: [],
    reviewBusy: false,
    selectedSharedSession: null,
    sendMessage: sendMessageMock,
    sharedSessionLoading: false,
  }),
}));

import { MessagesTab } from './MessagesTab.js';

beforeEach(() => {
  cleanup();
  sendMessageMock.mockReset();
  sendMessageMock.mockResolvedValue(true);
  state.canManageSessionEntries = true;
});

afterEach(() => {
  cleanup();
  sendMessageMock.mockReset();
});

function renderBroadcastInput(): HTMLTextAreaElement {
  render(<MessagesTab />);
  return screen.getByLabelText('留言内容') as HTMLTextAreaElement;
}

describe('MessagesTab 工作区留言输入法组合态', () => {
  it('组合态按 Enter 不提交留言，半成品文本留在输入框', () => {
    const textarea = renderBroadcastInput();

    fireEvent.change(textarea, { target: { value: 'liuyan' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    // 这次 Enter 属于输入法候选窗口：既不能提交，也不能把半成品发出去
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe('liuyan');
  });

  it('普通 Enter 提交留言并清空输入框', async () => {
    const textarea = renderBroadcastInput();

    fireEvent.change(textarea, { target: { value: '今天评审完成' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ content: '今天评审完成', type: 'update' }),
    );
    await waitFor(() => expect(textarea.value).toBe(''));
  });
});
