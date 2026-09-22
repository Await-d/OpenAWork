import { describe, expect, it } from 'vitest';
import { GUI_ACTION_ALIASES, normalizeActionName } from './action-types.js';

describe('normalizeActionName', () => {
  it('至少 3 个别名归一到规范名', () => {
    expect(normalizeActionName('left_double')).toBe('double_click');
    expect(normalizeActionName('right_single')).toBe('right_click');
    expect(normalizeActionName('snapshot')).toBe('screenshot');
    expect(normalizeActionName('calluser')).toBe('call_user');
    expect(normalizeActionName('left_click_drag')).toBe('drag');
    expect(normalizeActionName('move_to')).toBe('mouse_move');
  });

  it('大小写不敏感且去除首尾空白', () => {
    expect(normalizeActionName('  LEFT_SINGLE  ')).toBe('click');
    expect(normalizeActionName('DoubleClick')).toBe('double_click');
    expect(normalizeActionName('OPEN_APP')).toBe('open_app');
  });

  it('规范名保持自身（恒等映射）', () => {
    expect(normalizeActionName('click')).toBe('click');
    expect(normalizeActionName('wait')).toBe('wait');
    expect(normalizeActionName('finished')).toBe('finished');
  });

  it('未知动作原样保留（小写化后）', () => {
    expect(normalizeActionName('some_unknown_action')).toBe('some_unknown_action');
    expect(normalizeActionName('  Custom_Action ')).toBe('custom_action');
  });

  it('别名表值均为规范动作名', () => {
    expect(GUI_ACTION_ALIASES['leftdouble']).toBe('double_click');
    expect(GUI_ACTION_ALIASES['takescreenshot']).toBe('screenshot');
    expect(Object.keys(GUI_ACTION_ALIASES).length).toBeGreaterThan(0);
  });
});
