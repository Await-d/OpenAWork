import { describe, expect, it } from 'vitest';
import {
  CONTEXT_MENU_VIEWPORT_MARGIN,
  resolveContextMenuPosition,
} from './context-menu-position.js';

const SIZE = { width: 200, height: 120 } as const;

describe('resolveContextMenuPosition', () => {
  it('光标落在安全区域时原样使用坐标', () => {
    expect(resolveContextMenuPosition(120, 160, SIZE)).toEqual({ left: 120, top: 160 });
  });

  it('靠近右侧与底部时回拉到视口内', () => {
    const position = resolveContextMenuPosition(
      window.innerWidth - 10,
      window.innerHeight - 10,
      SIZE,
    );

    expect(position.left).toBe(window.innerWidth - SIZE.width - CONTEXT_MENU_VIEWPORT_MARGIN);
    expect(position.top).toBe(window.innerHeight - SIZE.height - CONTEXT_MENU_VIEWPORT_MARGIN);
  });

  it('负坐标回拉到最小间距', () => {
    expect(resolveContextMenuPosition(-40, -40, SIZE)).toEqual({
      left: CONTEXT_MENU_VIEWPORT_MARGIN,
      top: CONTEXT_MENU_VIEWPORT_MARGIN,
    });
  });

  it('视口比菜单还小时不返回负值', () => {
    const oversized = { width: window.innerWidth + 400, height: window.innerHeight + 400 };

    const position = resolveContextMenuPosition(10, 10, oversized);

    expect(position.left).toBe(CONTEXT_MENU_VIEWPORT_MARGIN);
    expect(position.top).toBe(CONTEXT_MENU_VIEWPORT_MARGIN);
  });
});
