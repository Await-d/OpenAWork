import { describe, expect, it } from 'vitest';
import {
  buildDialogueModePrompt,
  DIALOGUE_MODE_OPTIONS,
  type DialogueModeOption,
} from './dialogue-mode.js';

describe('dialogue-mode', () => {
  it('exposes the three requested dialogue modes in order', () => {
    expect(DIALOGUE_MODE_OPTIONS.map((option: DialogueModeOption) => option.label)).toEqual([
      '澄清',
      '编程',
      '程序员',
    ]);
  });

  it('adds concrete behavior prompts for clarify, coding, and programmer modes', () => {
    expect(buildDialogueModePrompt('clarify')).toContain('先澄清');
    expect(buildDialogueModePrompt('coding')).toContain('编程');
    expect(buildDialogueModePrompt('programmer')).toContain('程序员');
  });
});
