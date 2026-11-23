import { describe, expect, it } from 'vitest';
import { isImeComposingKeyboardEvent, isImeComposingNativeEvent } from './ime-composition.js';

type KeyboardEventInitWithKeyCode = Partial<KeyboardEventInit> & { keyCode?: number };

function makeNativeEvent(init: KeyboardEventInitWithKeyCode = {}): KeyboardEvent {
  const { keyCode = 0, ...rest } = init;
  return {
    isComposing: false,
    keyCode,
    ...rest,
  } as KeyboardEvent;
}

function makeSyntheticEvent(init: KeyboardEventInitWithKeyCode = {}): {
  readonly nativeEvent: KeyboardEvent;
} {
  return { nativeEvent: makeNativeEvent(init) };
}

describe('isImeComposingKeyboardEvent', () => {
  it('普通按键不判定为组合态', () => {
    expect(isImeComposingKeyboardEvent(makeSyntheticEvent({ key: 'Enter' }))).toBe(false);
  });

  it('isComposing 为真时判定为组合态（Safari / Firefox 的候选词确认）', () => {
    expect(
      isImeComposingKeyboardEvent(makeSyntheticEvent({ key: 'Enter', isComposing: true })),
    ).toBe(true);
  });

  it('keyCode 为 229 时判定为组合态（Chromium 的处理中标记）', () => {
    expect(isImeComposingKeyboardEvent(makeSyntheticEvent({ key: 'Process', keyCode: 229 }))).toBe(
      true,
    );
  });
});

describe('isImeComposingNativeEvent', () => {
  it('普通按键不判定为组合态', () => {
    expect(isImeComposingNativeEvent(makeNativeEvent({ key: 'Enter' }))).toBe(false);
  });

  it('isComposing 为真时判定为组合态（Safari / Firefox 的候选词确认）', () => {
    expect(isImeComposingNativeEvent(makeNativeEvent({ key: 'Enter', isComposing: true }))).toBe(
      true,
    );
  });

  it('keyCode 为 229 时判定为组合态（Chromium 的处理中标记）', () => {
    expect(isImeComposingNativeEvent(makeNativeEvent({ key: 'Process', keyCode: 229 }))).toBe(true);
  });
});
