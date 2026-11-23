// @vitest-environment jsdom
/**
 * ChatPage 窗口级自定义事件订阅回归护栏（W-09）。
 *
 * 覆盖四个事件：`openAwork:open-templates` / `openAwork:export-chat` /
 * `openAwork:open-browser` / `openawork:composer:insert`。
 *
 * 本文件锁定三个此前无法静态证明的不变量：
 *  1. 订阅回调读取的是**最新** messages（经 `messagesRef`），而不是注册时的快照；
 *  2. 订阅**不依赖** messages：messages 引用变化时不得重复注册监听器；
 *  3. 卸载后事件不再触发（cleanup 完整、无泄漏）。
 *
 * 另覆盖 `open-browser` 必须使用**最新预览地址**（chat 侧语义），以及
 * `composer:insert` 的 append / replace 行为与聚焦时序。
 *
 * 以及页面级门控（R-04）：应用使用 keep-alive 式缓存路由（CachedRouteOutlet），
 * 非活动页面**保持挂载**，可同时存在多个 ChatPage 实例。四个 window 级事件必须
 * 只在**激活实例**上生效，否则多实例共存时 `export-chat` 会被各导出一次、
 * `composer:insert` 会把文本插入到非当前会话的输入框。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useChatPageWindowEvents } from './use-chat-page-window-events.js';

const mocks = vi.hoisted(() => ({
  downloadExport: vi.fn(),
  exportMessages: vi.fn((_messages: ChatMessage[], _format: string) => '# exported'),
  toast: vi.fn(),
}));

vi.mock('../../../components/chat/message/message-export.js', () => ({
  downloadExport: mocks.downloadExport,
  exportMessages: mocks.exportMessages,
}));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

function userMessage(id: string, content: string): ChatMessage {
  return { content, id, role: 'user' };
}

function renderEvents(initialMessages: ChatMessage[], isPageActive = true) {
  const setShowTemplatePanel = vi.fn();
  const setInput = vi.fn();
  const textarea = document.createElement('textarea');
  // 必须挂进文档：jsdom 里未连接的节点 focus() 不生效，聚焦断言会假阴性。
  document.body.appendChild(textarea);
  // ref 对象必须跨渲染稳定（真实场景里 ref 身份恒定）；每次渲染新建会让订阅
  // effect 因依赖变化而重装，掩盖「订阅不依赖 messages」这一待验证的不变量。
  const messagesRef = { current: initialMessages };
  const openBrowserPreviewRef = { current: vi.fn() };
  const textareaRef = { current: textarea };

  const view = renderHook(
    ({ messages, active }: { messages: ChatMessage[]; active: boolean }) => {
      messagesRef.current = messages;
      return useChatPageWindowEvents({
        isPageActive: active,
        messagesRef,
        openBrowserPreviewRef,
        setInput,
        setShowTemplatePanel,
        textareaRef,
      });
    },
    { initialProps: { messages: initialMessages, active: isPageActive } },
  );

  return { ...view, messagesRef, openBrowserPreviewRef, setInput, setShowTemplatePanel, textarea };
}

/** 让 rAF 落地（composer:insert 的聚焦在下一帧）。 */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

beforeEach(() => {
  mocks.downloadExport.mockClear();
  mocks.exportMessages.mockClear();
  mocks.toast.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('useChatPageWindowEvents', () => {
  it('export-chat 使用最新 messages，而不是注册时的快照', async () => {
    const first = [userMessage('m1', '第一版内容')];
    const second = [userMessage('m1', '第一版内容'), userMessage('m2', '第二版内容')];
    const { rerender } = renderEvents(first);

    // 在不重新订阅的前提下更新 messages 引用。
    rerender({ messages: second, active: true });

    act(() => {
      window.dispatchEvent(new Event('openAwork:export-chat'));
    });

    expect(mocks.exportMessages).toHaveBeenCalledTimes(1);
    expect(mocks.exportMessages.mock.calls[0]?.[0]).toEqual(second);
    expect(mocks.downloadExport).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('对话已导出为 Markdown', 'success');
  });

  it('messages 引用变化时不重复注册监听器', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const first = [userMessage('m1', 'a')];
    const { rerender } = renderEvents(first);

    const countFor = (spy: typeof addSpy, name: string) =>
      spy.mock.calls.filter((call) => call[0] === name).length;

    const exportAddsAfterMount = countFor(addSpy, 'openAwork:export-chat');
    const insertAddsAfterMount = countFor(addSpy, 'openawork:composer:insert');

    rerender({ messages: [userMessage('m1', 'a'), userMessage('m2', 'b')], active: true });
    rerender({ messages: [userMessage('m3', 'c')], active: true });

    expect(countFor(addSpy, 'openAwork:export-chat')).toBe(exportAddsAfterMount);
    expect(countFor(addSpy, 'openawork:composer:insert')).toBe(insertAddsAfterMount);
    // 未变化 ⇒ 不应发生任何 remove 重装。
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('卸载后四个事件都不再触发（cleanup 完整）', () => {
    const { unmount, openBrowserPreviewRef, setInput, setShowTemplatePanel } = renderEvents([]);

    unmount();

    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
      window.dispatchEvent(new Event('openAwork:export-chat'));
      window.dispatchEvent(new Event('openAwork:open-browser'));
      window.dispatchEvent(new CustomEvent('openawork:composer:insert', { detail: { text: 'x' } }));
    });

    expect(setShowTemplatePanel).not.toHaveBeenCalled();
    expect(mocks.exportMessages).not.toHaveBeenCalled();
    expect(openBrowserPreviewRef.current).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
  });

  it('open-templates 打开模板面板', () => {
    const { setShowTemplatePanel } = renderEvents([]);
    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
    });
    expect(setShowTemplatePanel).toHaveBeenCalledWith(true);
  });

  it('open-browser 使用最新预览地址（ref 刷新后立刻生效）', () => {
    const { openBrowserPreviewRef } = renderEvents([]);
    const latest = vi.fn();
    openBrowserPreviewRef.current = latest;

    act(() => {
      window.dispatchEvent(new Event('openAwork:open-browser'));
    });

    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('composer:insert append 到非空输入（trimEnd + 换行），并聚焦到底部', async () => {
    const { setInput, textarea } = renderEvents([]);
    textarea.value = '已有内容';

    act(() => {
      window.dispatchEvent(
        new CustomEvent('openawork:composer:insert', { detail: { text: '插入文本' } }),
      );
    });

    const updater = setInput.mock.calls[0]?.[0] as (prev: string) => string;
    expect(updater('已有内容')).toBe('已有内容\n插入文本');

    await flushFrame();
    expect(document.activeElement).toBe(textarea);
  });

  it('composer:insert 空输入时不加前导换行', () => {
    const { setInput } = renderEvents([]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('openawork:composer:insert', { detail: { text: '唯一内容' } }),
      );
    });
    const updater = setInput.mock.calls[0]?.[0] as (prev: string) => string;
    expect(updater('   ')).toBe('唯一内容');
  });

  it('composer:insert replace 直接覆盖输入', () => {
    const { setInput } = renderEvents([]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('openawork:composer:insert', {
          detail: { mode: 'replace', text: '替换内容' },
        }),
      );
    });
    const updater = setInput.mock.calls[0]?.[0] as (prev: string) => string;
    expect(updater('旧内容')).toBe('替换内容');
  });

  it('composer:insert 空文本不触发任何状态更新', () => {
    const { setInput } = renderEvents([]);
    act(() => {
      window.dispatchEvent(new CustomEvent('openawork:composer:insert', { detail: { text: '' } }));
    });
    expect(setInput).not.toHaveBeenCalled();
  });
});

/**
 * R-04 页面级监听门控：CachedRouteOutlet 的 keep-alive 让非活动页面保持挂载，
 * 于是多个 ChatPage 实例可同时存在。四个 window 级事件必须只在**激活实例**上生效。
 */
describe('useChatPageWindowEvents 页面激活门控', () => {
  const inactiveMessages = [userMessage('inactive', '非活动实例')];
  const activeMessages = [userMessage('active', '活动实例')];

  it('两实例共存时 export-chat 只由激活实例响应（恰好一次，且用激活实例的 messages）', () => {
    const inactive = renderEvents(inactiveMessages, false);
    const active = renderEvents(activeMessages, true);

    act(() => {
      window.dispatchEvent(new Event('openAwork:export-chat'));
    });

    expect(mocks.exportMessages).toHaveBeenCalledTimes(1);
    expect(mocks.exportMessages.mock.calls[0]?.[0]).toEqual(activeMessages);
    expect(mocks.downloadExport).toHaveBeenCalledTimes(1);
    // 非活动实例不得响应。
    expect(inactive.setInput).not.toHaveBeenCalled();
    expect(active.messagesRef.current).toBe(activeMessages);
    expect(inactive.messagesRef.current).toBe(inactiveMessages);
  });

  it('两实例共存时 composer:insert 只写入激活实例的输入框', () => {
    const inactive = renderEvents(inactiveMessages, false);
    const active = renderEvents(activeMessages, true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('openawork:composer:insert', { detail: { text: '插入文本' } }),
      );
    });

    expect(active.setInput).toHaveBeenCalledTimes(1);
    expect(inactive.setInput).not.toHaveBeenCalled();
  });

  it('两实例共存时 open-templates / open-browser 只作用于激活实例', () => {
    const inactive = renderEvents(inactiveMessages, false);
    const active = renderEvents(activeMessages, true);

    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
      window.dispatchEvent(new Event('openAwork:open-browser'));
    });

    expect(active.setShowTemplatePanel).toHaveBeenCalledWith(true);
    expect(active.openBrowserPreviewRef.current).toHaveBeenCalledTimes(1);
    expect(inactive.setShowTemplatePanel).not.toHaveBeenCalled();
    expect(inactive.openBrowserPreviewRef.current).not.toHaveBeenCalled();
  });

  it('失活后监听被清理，重新激活后恢复响应', () => {
    const { rerender, setShowTemplatePanel, openBrowserPreviewRef, setInput } = renderEvents(
      activeMessages,
      true,
    );

    rerender({ messages: activeMessages, active: false });
    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
      window.dispatchEvent(new Event('openAwork:export-chat'));
      window.dispatchEvent(new Event('openAwork:open-browser'));
      window.dispatchEvent(new CustomEvent('openawork:composer:insert', { detail: { text: 'x' } }));
    });

    expect(setShowTemplatePanel).not.toHaveBeenCalled();
    expect(mocks.exportMessages).not.toHaveBeenCalled();
    expect(openBrowserPreviewRef.current).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();

    rerender({ messages: activeMessages, active: true });
    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
    });
    expect(setShowTemplatePanel).toHaveBeenCalledWith(true);

    // 重新激活后仍只注册一份监听器。
    rerender({ messages: activeMessages, active: false });
    setShowTemplatePanel.mockClear();
    act(() => {
      window.dispatchEvent(new Event('openAwork:open-templates'));
    });
    expect(setShowTemplatePanel).not.toHaveBeenCalled();
  });
});
