import { describe, expect, it } from 'vitest';
import {
  GUI_DEFAULT_ACTION_SPACES,
  GUI_DEFAULT_SYSTEM_PROMPT,
  GUI_INTERNAL_ACTIONS,
  GUI_MAX_IMAGE_LENGTH,
  GUI_MAX_LOOP_COUNT,
  GUI_WAIT_MS_DEFAULT,
  buildGuiSystemPrompt,
  buildGuiUserPrompt,
} from './constants.js';

describe('GUI Agent 常量', () => {
  it('最大循环步数为上游源码实测值 100', () => {
    expect(GUI_MAX_LOOP_COUNT).toBe(100);
  });

  it('截图滑动窗口为 5', () => {
    expect(GUI_MAX_IMAGE_LENGTH).toBe(5);
  });

  it('wait() 默认等待 5000ms', () => {
    expect(GUI_WAIT_MS_DEFAULT).toBe(5000);
  });

  it('内部动作清单完整', () => {
    expect([...GUI_INTERNAL_ACTIONS]).toEqual(['call_user', 'max_loop', 'error_env', 'finished']);
  });
});

describe('GUI_DEFAULT_ACTION_SPACES', () => {
  it('包含桌面控制真正支持的关键动作', () => {
    const names = [
      'click',
      'left_double',
      'right_single',
      'drag',
      'hotkey',
      'type',
      'scroll',
      'wait',
      'finished',
      'call_user',
    ];
    for (const name of names) {
      expect(GUI_DEFAULT_ACTION_SPACES).toContain(`${name}(`);
    }
  });

  it('坐标格式使用 0–1000 归一化的 [x1, y1, x2, y2]', () => {
    expect(GUI_DEFAULT_ACTION_SPACES).toContain('[x1, y1, x2, y2]');
    expect(GUI_DEFAULT_ACTION_SPACES).toContain('end_box');
  });
});

describe('buildGuiSystemPrompt', () => {
  it('默认包含动作空间与 0-1000 归一化说明', () => {
    const prompt = buildGuiSystemPrompt();
    expect(prompt).toContain(GUI_DEFAULT_ACTION_SPACES);
    expect(prompt).toContain('0-1000');
    expect(prompt).toContain('## User Instruction');
  });

  it('默认 System Prompt 与无参构造一致', () => {
    expect(GUI_DEFAULT_SYSTEM_PROMPT).toBe(buildGuiSystemPrompt());
  });

  it('支持自定义动作空间', () => {
    const prompt = buildGuiSystemPrompt({ actionSpaces: 'custom_action()' });
    expect(prompt).toContain('custom_action()');
    expect(prompt).not.toContain(GUI_DEFAULT_ACTION_SPACES);
  });

  it('extraNote 作为额外约束追加到 Note 段', () => {
    const prompt = buildGuiSystemPrompt({ extraNote: '不要关闭系统设置窗口' });
    expect(prompt).toContain('- 不要关闭系统设置窗口');
    expect(prompt).toContain('- Coordinates are in a 0-1000');
  });

  it('空 extraNote 不留多余空行', () => {
    expect(buildGuiSystemPrompt({ extraNote: '   ' })).toBe(buildGuiSystemPrompt());
  });
});

describe('buildGuiUserPrompt', () => {
  it('去除首尾空白', () => {
    expect(buildGuiUserPrompt('  打开设置  ')).toBe('打开设置');
  });

  it('空指令回退为非空占位文本', () => {
    expect(buildGuiUserPrompt('   ').length).toBeGreaterThan(0);
  });
});
