// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { RightPanelTabId } from '../panels/right-panel-tabs.js';
import type { SubAgentRunItem } from '../panels/sub-agent-run-list.js';
import { useChildSessionSelection } from './use-child-session-selection.js';

function buildItem(
  sessionId: string,
  status: SubAgentRunItem['status'] = 'running',
): SubAgentRunItem {
  return {
    sessionId,
    shortSessionId: sessionId.slice(0, 8),
    status,
    taskLabel: sessionId,
    title: sessionId,
    messageCount: 0,
  };
}

interface RenderInput {
  currentSessionId: string | null;
  items: SubAgentRunItem[];
}

function renderSelection(initial: RenderInput) {
  const setRightOpen = vi.fn();
  const setReviewPanelOpened = vi.fn();
  const setSidePanelActiveTab = vi.fn();

  const hook = renderHook(
    ({ currentSessionId, items }: RenderInput) => {
      const [selectedChildSessionId, setSelectedChildSessionId] = useState<string | null>(null);
      const [rightTab, setRightTab] = useState<RightPanelTabId>('overview');

      const controller = useChildSessionSelection({
        currentSessionId,
        isFusionLayout: false,
        isMobileViewport: false,
        rightTab,
        selectedChildSessionId,
        setReviewPanelOpened,
        setRightOpen,
        setRightTab,
        setSelectedChildSessionId,
        setSidePanelActiveTab,
        subAgentRunItems: items,
      });

      return { controller, rightTab, selectedChildSessionId };
    },
    { initialProps: initial },
  );

  return { hook, setReviewPanelOpened, setRightOpen, setSidePanelActiveTab };
}

afterEach(() => {
  cleanup();
});

describe('useChildSessionSelection', () => {
  it('运行列表非空且无选中时自动选择 running 优先项', () => {
    const { hook } = renderSelection({
      currentSessionId: 's1',
      items: [buildItem('ses_done', 'completed'), buildItem('ses_run', 'running')],
    });

    expect(hook.result.current.selectedChildSessionId).toBe('ses_run');
  });

  it('点击任务卡片指向不在运行列表中的历史子会话时，选中与 agent tab 都保留', () => {
    const { hook, setRightOpen } = renderSelection({ currentSessionId: 's1', items: [] });

    act(() => {
      hook.result.current.controller.openChildSessionInspector('ses_history');
    });

    expect(hook.result.current.selectedChildSessionId).toBe('ses_history');
    expect(hook.result.current.rightTab).toBe('agent');
    expect(setRightOpen).toHaveBeenCalledWith(true);
  });

  it('显式选择不会被后续自动回填补掉', () => {
    const { hook } = renderSelection({ currentSessionId: 's1', items: [] });

    act(() => {
      hook.result.current.controller.openChildSessionInspector('ses_history');
    });

    act(() => {
      hook.rerender({ currentSessionId: 's1', items: [buildItem('ses_other', 'running')] });
    });

    expect(hook.result.current.selectedChildSessionId).toBe('ses_history');
  });

  it('运行列表中的显式选择保持不被兜底替换', () => {
    const { hook } = renderSelection({
      currentSessionId: 's1',
      items: [buildItem('ses_a'), buildItem('ses_b', 'completed')],
    });

    act(() => {
      hook.result.current.controller.selectChildSession('ses_b');
    });
    expect(hook.result.current.selectedChildSessionId).toBe('ses_b');
  });

  it('会话切换后清除显式保护，运行列表为空时选中被清空并回退 overview', () => {
    const { hook } = renderSelection({ currentSessionId: 's1', items: [] });

    act(() => {
      hook.result.current.controller.openChildSessionInspector('ses_history');
    });
    expect(hook.result.current.selectedChildSessionId).toBe('ses_history');

    act(() => {
      hook.rerender({ currentSessionId: 's2', items: [] });
    });

    expect(hook.result.current.selectedChildSessionId).toBeNull();
    expect(hook.result.current.rightTab).toBe('overview');
  });

  it('Alt+↓ 在子代理之间循环并打开预览', () => {
    const { hook, setRightOpen } = renderSelection({
      currentSessionId: 's1',
      items: [buildItem('ses_a'), buildItem('ses_b')],
    });

    act(() => {
      hook.result.current.controller.selectChildSession('ses_b');
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }));
    });

    expect(hook.result.current.selectedChildSessionId).toBe('ses_a');
    expect(setRightOpen).toHaveBeenCalledWith(true);
  });

  it('selectChildSession 只更新选中，不改变面板开合', () => {
    const { hook, setRightOpen, setReviewPanelOpened } = renderSelection({
      currentSessionId: 's1',
      items: [buildItem('ses_a')],
    });

    act(() => {
      hook.result.current.controller.selectChildSession('ses_a');
    });

    expect(hook.result.current.selectedChildSessionId).toBe('ses_a');
    expect(setRightOpen).not.toHaveBeenCalled();
    expect(setReviewPanelOpened).not.toHaveBeenCalled();
  });
});
