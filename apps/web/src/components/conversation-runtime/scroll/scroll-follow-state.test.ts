import { describe, expect, it } from 'vitest';
import {
  isProgrammaticPosition,
  resolveFollowInterrupted,
  resolveKeyboardIntent,
  resolveTouchIntent,
  resolveWheelIntent,
  SCROLL_TOUCH_INTENT_THRESHOLD_PX,
} from './scroll-follow-state.js';
import { resolveLatestScrollTop } from './scroll-alignment.js';
import {
  CHAT_LATEST_EDGE_TOLERANCE_PX,
  CHAT_TRUE_BOTTOM_TOLERANCE_PX,
} from './scroll-constants.js';

describe('resolveWheelIntent', () => {
  it('向上滚动（deltaY < 0）判定为 leave-latest', () => {
    expect(resolveWheelIntent({ deltaY: -1 })).toBe('leave-latest');
    expect(resolveWheelIntent({ deltaY: -240 })).toBe('leave-latest');
  });

  it('向下滚动（deltaY > 0）判定为 seek-latest', () => {
    expect(resolveWheelIntent({ deltaY: 1 })).toBe('seek-latest');
    expect(resolveWheelIntent({ deltaY: 240 })).toBe('seek-latest');
  });

  it('deltaY 为 0 时不构成意图', () => {
    expect(resolveWheelIntent({ deltaY: 0 })).toBeNull();
  });
});

describe('resolveTouchIntent', () => {
  it('手指向下超过阈值（内容朝更早）判定为 leave-latest', () => {
    expect(resolveTouchIntent({ startY: 100, currentY: 109, thresholdPx: 8 })).toBe('leave-latest');
  });

  it('手指向上超过阈值（内容朝更新）判定为 seek-latest', () => {
    expect(resolveTouchIntent({ startY: 100, currentY: 91, thresholdPx: 8 })).toBe('seek-latest');
  });

  it('位移未超过阈值时不算意图（点击 / 抖动）', () => {
    expect(resolveTouchIntent({ startY: 100, currentY: 108, thresholdPx: 8 })).toBeNull();
    expect(resolveTouchIntent({ startY: 100, currentY: 92, thresholdPx: 8 })).toBeNull();
    expect(resolveTouchIntent({ startY: 100, currentY: 100, thresholdPx: 8 })).toBeNull();
  });

  it('默认阈值常量为 8px', () => {
    expect(SCROLL_TOUCH_INTENT_THRESHOLD_PX).toBe(8);
  });
});

describe('resolveKeyboardIntent', () => {
  it('ArrowUp / PageUp / Home 判定为 leave-latest', () => {
    expect(resolveKeyboardIntent({ key: 'ArrowUp', shiftKey: false })).toBe('leave-latest');
    expect(resolveKeyboardIntent({ key: 'PageUp', shiftKey: false })).toBe('leave-latest');
    expect(resolveKeyboardIntent({ key: 'Home', shiftKey: false })).toBe('leave-latest');
  });

  it('ArrowDown / PageDown / End / Space 判定为 seek-latest', () => {
    expect(resolveKeyboardIntent({ key: 'ArrowDown', shiftKey: false })).toBe('seek-latest');
    expect(resolveKeyboardIntent({ key: 'PageDown', shiftKey: false })).toBe('seek-latest');
    expect(resolveKeyboardIntent({ key: 'End', shiftKey: false })).toBe('seek-latest');
    expect(resolveKeyboardIntent({ key: ' ', shiftKey: false })).toBe('seek-latest');
  });

  it('Shift+Space 判定为 leave-latest（反向翻页）', () => {
    expect(resolveKeyboardIntent({ key: ' ', shiftKey: true })).toBe('leave-latest');
  });

  it('其他按键不构成意图（例如输入框里的普通字符键）', () => {
    expect(resolveKeyboardIntent({ key: 'a', shiftKey: false })).toBeNull();
    expect(resolveKeyboardIntent({ key: 'Enter', shiftKey: false })).toBeNull();
    expect(resolveKeyboardIntent({ key: 'Escape', shiftKey: false })).toBeNull();
  });
});

describe('resolveFollowInterrupted', () => {
  it('leave-latest 意图永远优先（即使位置裁决说仍在 latest 边缘）', () => {
    expect(resolveFollowInterrupted({ intent: 'leave-latest', interrupted: false })).toBe(true);
    expect(resolveFollowInterrupted({ intent: 'leave-latest', interrupted: true })).toBe(true);
    expect(
      resolveFollowInterrupted({
        intent: 'leave-latest',
        interrupted: false,
        position: { atLatestEdge: true, atTrueBottom: true, programmatic: true },
      }),
    ).toBe(true);
  });

  it('seek-latest 意图不改变跟随状态（位置裁决交给位置路径）', () => {
    expect(resolveFollowInterrupted({ intent: 'seek-latest', interrupted: false })).toBe(false);
    expect(resolveFollowInterrupted({ intent: 'seek-latest', interrupted: true })).toBe(true);
  });

  it('无位置裁决时保持原值', () => {
    expect(resolveFollowInterrupted({ intent: null, interrupted: false })).toBe(false);
    expect(resolveFollowInterrupted({ intent: null, interrupted: true })).toBe(true);
  });

  it('程序化落点仍在 latest 边缘内 ⇒ 恢复 / 保持跟随（内容增长不误判）', () => {
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: true,
        position: { atLatestEdge: true, atTrueBottom: false, programmatic: true },
      }),
    ).toBe(false);
  });

  it('程序化落点离开 latest 边缘 ⇒ 保持原状态（只有内容 / 布局在动）', () => {
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: false,
        position: { atLatestEdge: false, atTrueBottom: false, programmatic: true },
      }),
    ).toBe(false);
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: true,
        position: { atLatestEdge: false, atTrueBottom: false, programmatic: true },
      }),
    ).toBe(true);
  });

  it('非程序化位置回到真正底部 ⇒ 恢复跟随', () => {
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: true,
        position: { atLatestEdge: false, atTrueBottom: true, programmatic: false },
      }),
    ).toBe(false);
  });

  it('非程序化位置未到真正底部 ⇒ 挂起（spacer 区内哪怕算 latest 边缘也挂起）', () => {
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: false,
        position: { atLatestEdge: true, atTrueBottom: false, programmatic: false },
      }),
    ).toBe(true);
    expect(
      resolveFollowInterrupted({
        intent: null,
        interrupted: false,
        position: { atLatestEdge: false, atTrueBottom: false, programmatic: false },
      }),
    ).toBe(true);
  });
});

describe('isProgrammaticPosition', () => {
  it('从未程序化滚动过（null 落点）时，任何位置都判定为外部滚动', () => {
    expect(isProgrammaticPosition({ programmaticScrollTop: null, scrollTop: 0 })).toBe(false);
    expect(isProgrammaticPosition({ programmaticScrollTop: null, scrollTop: 680 })).toBe(false);
  });

  it('scrollTop 与记录落点一致（或落在 0.5px 容差内）时判定为程序化位置', () => {
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 680 })).toBe(true);
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 680.5 })).toBe(true);
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 679.5 })).toBe(true);
  });

  it('scrollTop 偏离记录落点超过 0.5px 时判定为外部滚动', () => {
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 679.4 })).toBe(false);
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 680.6 })).toBe(false);
    expect(isProgrammaticPosition({ programmaticScrollTop: 680, scrollTop: 520 })).toBe(false);
  });

  it('内容增长期间 scrollTop 不变 ⇒ 仍是程序化位置（不误判为用户离开）', () => {
    // 记录落点 800，内容在下方增长了 120px，但浏览器保持 scrollTop 不动。
    expect(isProgrammaticPosition({ programmaticScrollTop: 800, scrollTop: 800 })).toBe(true);
  });
});

describe('滚动容差不变量', () => {
  it('真正底部容差必须小于 spacer 高度下限，否则一个滚轮刻度会落在恢复窗口内', () => {
    expect(CHAT_TRUE_BOTTOM_TOLERANCE_PX).toBeLessThan(80);
  });

  it('宽松锚点边缘容差不得比严格真底容差更紧', () => {
    expect(CHAT_LATEST_EDGE_TOLERANCE_PX).toBeGreaterThanOrEqual(CHAT_TRUE_BOTTOM_TOLERANCE_PX);
  });
});

describe('resolveLatestScrollTop（center 对齐是保留的公开能力）', () => {
  const geometry = {
    anchorHeight: 120,
    anchorTop: 300,
    centerMarginPx: 32,
    clientHeight: 400,
    maxScrollTop: 2000,
  };

  it('latest-edge 落点就是绝对底部', () => {
    expect(resolveLatestScrollTop({ ...geometry, align: 'latest-edge' })).toBe(2000);
  });

  it('center 落点合法且与 latest-edge 不同（该分支必须真实可用，不是静默死代码）', () => {
    const center = resolveLatestScrollTop({ ...geometry, align: 'center' });
    expect(center).toBeGreaterThanOrEqual(0);
    expect(center).toBeLessThanOrEqual(geometry.maxScrollTop);
    expect(center).not.toBe(geometry.maxScrollTop);
  });
});
