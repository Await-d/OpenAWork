import { describe, expect, it } from 'vitest';
import { isImeComposingKeyboardEvent } from './ime-composition.js';

function makeEvent(init: Partial<KeyboardEventInit> & { keyCode?: number } = {}) {
  const { keyCode = 0, ...rest } = init;
  return {
    nativeEvent: {
      isComposing: false,
      keyCode,
      ...rest,
    } as KeyboardEvent,
  };
}

describe('isImeComposingKeyboardEvent', () => {
  it('普通按键不判定为组合态', () => {
    expect(isImeComposingKeyboardEvent(makeEvent({ key: 'Enter' }))).toBe(false);
  });

  it('isComposing 为真时判定为组合态（Safari / Firefox 的候选词确认）', () => {
    expect(isImeComposingKeyboardEvent(makeEvent({ key: 'Enter', isComposing: true }))).toBe(true);
  });

  it('keyCode 为 229 时判定为组合态（Chromium 的处理中标记）', () => {
    expect(isImeComposingKeyboardEvent(makeEvent({ key: 'Process', keyCode: 229 }))).toBe(true);
  });
});
