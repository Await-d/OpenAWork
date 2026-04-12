import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_MODE_OPTIONS,
  getDefaultAgentForDialogueMode,
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

  it('keeps UI-facing labels and descriptions for each mode', () => {
    expect(DIALOGUE_MODE_OPTIONS).toEqual([
      {
        value: 'clarify',
        label: '澄清',
        description:
          '渐进式需求澄清与方案设计，只读分析项目、交互式提问，产出方案后交由编程模式实现。',
      },
      {
        value: 'coding',
        label: '编程',
        description: '更偏直接产出代码、命令和最小可运行实现，减少铺垫。',
      },
      {
        value: 'programmer',
        label: '程序员',
        description: '以工程协作视角处理实现、修改、调试和验证。',
      },
    ]);
  });

  it('keeps current default agent routing', () => {
    expect(getDefaultAgentForDialogueMode('clarify')).toBeUndefined();
    expect(getDefaultAgentForDialogueMode('coding')).toBe('sisyphus-junior');
    expect(getDefaultAgentForDialogueMode('programmer')).toBe('hephaestus');
  });
});
