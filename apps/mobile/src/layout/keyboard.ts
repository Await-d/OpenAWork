import { MIN_HOME_INDICATOR_INSET } from './metrics';

export type ComposerPlatform = 'ios' | 'android' | 'windows' | 'macos' | 'web';

/**
 * Bottom spacing for a chat composer dock.
 *
 * - Keyboard closed: clear the home indicator / gesture bar.
 * - Keyboard open:
 *   - iOS: lift by full keyboard height (window does not auto-resize).
 *   - Android with `softwareKeyboardLayoutMode: "resize"`: the window already
 *     shrinks for the keyboard, so only keep a small visual gap — do NOT add
 *     keyboard height again (that double-counts and launches the input too high).
 *
 * Keep this file free of `react-native` imports so unit tests can run in Node.
 */
export function resolveComposerBottomInset(input: {
  keyboardHeight: number;
  safeBottom: number;
  /** Visual gap above keyboard / home indicator. */
  gap?: number;
  /**
   * Runtime platform. Callers should pass `Platform.OS` from react-native.
   * Defaults to `ios` (manual keyboard height lift) which is the safer mobile default.
   */
  platform?: ComposerPlatform;
}): number {
  const gap = input.gap ?? 8;
  const platform = input.platform ?? 'ios';

  if (input.keyboardHeight > 0) {
    if (platform === 'android') {
      return gap;
    }
    return input.keyboardHeight + gap;
  }

  return Math.max(input.safeBottom, MIN_HOME_INDICATOR_INSET) + gap;
}
