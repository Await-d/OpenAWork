import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  publishDialogueModeSwitchFromReply,
  publishSessionDialogueModeSwitch,
  subscribeSessionDialogueModeSwitch,
} from './dialogue-mode-events.js';

const unsubscribers: Array<() => void> = [];

afterEach(() => {
  while (unsubscribers.length > 0) {
    unsubscribers.pop()?.();
  }
  vi.restoreAllMocks();
});

describe('dialogue-mode-events', () => {
  it('广播的模式切换会被订阅者收到（含来源）', () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeSessionDialogueModeSwitch(listener));

    publishSessionDialogueModeSwitch({
      dialogueMode: 'coding',
      sessionId: 'session-1',
      source: 'user',
    });

    expect(listener).toHaveBeenCalledWith({
      dialogueMode: 'coding',
      sessionId: 'session-1',
      source: 'user',
    });
  });

  it('sessionId 为空时不广播', () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeSessionDialogueModeSwitch(listener));

    publishSessionDialogueModeSwitch({
      dialogueMode: 'coding',
      sessionId: '   ',
      source: 'auto',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('publishDialogueModeSwitchFromReply 只在服务端回传模式时广播，来源为 auto', () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeSessionDialogueModeSwitch(listener));

    publishDialogueModeSwitchFromReply({ sessionId: 'session-1' });
    expect(listener).not.toHaveBeenCalled();

    publishDialogueModeSwitchFromReply({ dialogueMode: 'coding', sessionId: 'session-1' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      dialogueMode: 'coding',
      sessionId: 'session-1',
      source: 'auto',
    });
  });

  it('取消订阅后不再收到事件', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionDialogueModeSwitch(listener);

    unsubscribe();
    publishSessionDialogueModeSwitch({
      dialogueMode: 'programmer',
      sessionId: 'session-1',
      source: 'auto',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('忽略非法的 dialogueMode 载荷', () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeSessionDialogueModeSwitch(listener));

    window.dispatchEvent(
      new CustomEvent('openAwork:session-dialogue-mode-switch', {
        detail: { dialogueMode: 'unsupported', sessionId: 'session-1' },
      }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('未知来源按 auto 归一化', () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeSessionDialogueModeSwitch(listener));

    window.dispatchEvent(
      new CustomEvent('openAwork:session-dialogue-mode-switch', {
        detail: { dialogueMode: 'coding', sessionId: 'session-1', source: 'unknown' },
      }),
    );

    expect(listener).toHaveBeenCalledWith({
      dialogueMode: 'coding',
      sessionId: 'session-1',
      source: 'auto',
    });
  });
});
