import { describe, expect, it } from 'vitest';
import { resolveComposerBottomInset } from './keyboard';

describe('resolveComposerBottomInset', () => {
  it('键盘收起时保留 home indicator + gap', () => {
    expect(
      resolveComposerBottomInset({
        keyboardHeight: 0,
        safeBottom: 34,
        gap: 8,
        platform: 'ios',
      }),
    ).toBe(42);
    expect(
      resolveComposerBottomInset({
        keyboardHeight: 0,
        safeBottom: 0,
        gap: 8,
        platform: 'android',
      }),
    ).toBe(16);
  });

  it('iOS 键盘弹出时用键盘高度 + gap，不再叠加 safeBottom', () => {
    expect(
      resolveComposerBottomInset({
        keyboardHeight: 336,
        safeBottom: 34,
        gap: 8,
        platform: 'ios',
      }),
    ).toBe(344);
  });

  it('Android resize 模式下键盘弹出只保留 gap（窗口已自动收缩）', () => {
    expect(
      resolveComposerBottomInset({
        keyboardHeight: 300,
        safeBottom: 34,
        gap: 8,
        platform: 'android',
      }),
    ).toBe(8);
  });
});
