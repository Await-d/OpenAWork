// @vitest-environment jsdom
/**
 * 粘贴保护阈值判定 + 终端偏好持久化。
 *
 * 关注三件事：字符/换行阈值的边界语义、摘要预览的可读性、
 * localStorage 不可用时偏好退化成默认值而不是抛错。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PASTE_CONFIRM_CHAR_THRESHOLD,
  PASTE_CONFIRM_LINE_THRESHOLD,
  evaluatePasteGuard,
  summarizePastedText,
} from './terminal-paste-guard.js';
import {
  TERMINAL_PREFERENCE_KEYS,
  readTerminalPreference,
  writeTerminalPreference,
} from './terminal-preferences.js';

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

describe('evaluatePasteGuard', () => {
  it('短单行文本不触发确认', () => {
    const decision = evaluatePasteGuard('ls -la\n');
    expect(decision.needsConfirm).toBe(false);
    expect(decision.summary.chars).toBe(7);
    expect(decision.summary.lines).toBe(1);
  });

  it('恰好等于字符阈值不触发，超过 1 个字符即触发', () => {
    const atLimit = 'a'.repeat(PASTE_CONFIRM_CHAR_THRESHOLD);
    const overLimit = `${atLimit}a`;

    expect(evaluatePasteGuard(atLimit).needsConfirm).toBe(false);
    expect(evaluatePasteGuard(overLimit).needsConfirm).toBe(true);
  });

  it('换行达到阈值即触发（多行粘贴风险最高）', () => {
    const below = 'echo 1\necho 2\necho 3\necho 4\n';
    const atThreshold = `${below}echo 5\n`;

    expect(evaluatePasteGuard(below).needsConfirm).toBe(false);
    expect(evaluatePasteGuard(below).summary.lines).toBe(PASTE_CONFIRM_LINE_THRESHOLD - 1);
    expect(evaluatePasteGuard(atThreshold).needsConfirm).toBe(true);
  });

  it('\\r\\n 与裸 \\r 都按一个换行计数（xterm 粘贴用 CR 结尾）', () => {
    expect(summarizePastedText('a\r\nb\rc\nd').lines).toBe(3);
  });

  it('支持注入阈值，便于按终端场景调整', () => {
    expect(evaluatePasteGuard('abcdef', { chars: 3 }).needsConfirm).toBe(true);
    expect(evaluatePasteGuard('a\nb\nc', { lines: 99 }).needsConfirm).toBe(false);
  });

  it('摘要预览截断并可视化换行，保留计数', () => {
    const long = `first line\n${'x'.repeat(200)}`;
    const summary = summarizePastedText(long);

    expect(summary.preview.startsWith('first line⏎')).toBe(true);
    expect(summary.preview.length).toBeLessThanOrEqual(81);
    expect(summary.preview.endsWith('…')).toBe(true);
    expect(summary.chars).toBe(long.length);
  });
});

describe('terminal preferences', () => {
  it('默认关闭，写入后可读回', () => {
    expect(readTerminalPreference('pasteGuardDisabled')).toBe(false);
    expect(readTerminalPreference('copyOnSelect')).toBe(false);

    writeTerminalPreference('pasteGuardDisabled', true);
    writeTerminalPreference('copyOnSelect', true);

    expect(globalThis.localStorage.getItem(TERMINAL_PREFERENCE_KEYS.pasteGuardDisabled)).toBe('1');
    expect(readTerminalPreference('pasteGuardDisabled')).toBe(true);
    expect(readTerminalPreference('copyOnSelect')).toBe(true);

    writeTerminalPreference('copyOnSelect', false);
    expect(readTerminalPreference('copyOnSelect')).toBe(false);
  });

  it('localStorage 不可用时读写都不抛错', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => writeTerminalPreference('pasteGuardDisabled', true)).not.toThrow();
    expect(readTerminalPreference('pasteGuardDisabled')).toBe(false);
  });
});
