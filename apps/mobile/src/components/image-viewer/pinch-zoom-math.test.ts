import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_SCALE,
  DOUBLE_TAP_WINDOW_MS,
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  ZOOMED_TOLERANCE,
  ZOOM_STEP,
  clampTranslate,
  deriveZoomed,
  distanceBetween,
  focusPointZoom,
  midpoint,
  nextDoubleTapScale,
  scaleFromPinchDistance,
  type Point,
} from './pinch-zoom-math';
import {
  MAX_ZOOM_SCALE as MODEL_MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE as MODEL_MIN_ZOOM_SCALE,
  ZOOM_STEP as MODEL_ZOOM_STEP,
} from './lightbox-model';

/** 焦点缩放不变量：`c × s' + t' === f`（c 为焦点下方像素的局部坐标）。 */
function expectFocalPixelPinned(
  scale: number,
  nextScale: number,
  focal: Point,
  translate: Point,
): void {
  const nextTranslate = focusPointZoom({ scale, nextScale, focal, translate });
  const contentX = (focal.x - translate.x) / scale;
  const contentY = (focal.y - translate.y) / scale;
  expect(contentX * nextScale + nextTranslate.x).toBeCloseTo(focal.x, 10);
  expect(contentY * nextScale + nextTranslate.y).toBeCloseTo(focal.y, 10);
}

describe('常量', () => {
  it('缩放上下界与步长复用 lightbox-model 的同一份取值', () => {
    expect(MIN_ZOOM_SCALE).toBe(MODEL_MIN_ZOOM_SCALE);
    expect(MAX_ZOOM_SCALE).toBe(MODEL_MAX_ZOOM_SCALE);
    expect(ZOOM_STEP).toBe(MODEL_ZOOM_STEP);
    expect(MIN_ZOOM_SCALE).toBe(0.25);
    expect(MAX_ZOOM_SCALE).toBe(5);
    expect(ZOOM_STEP).toBe(0.25);
  });

  it('双击窗口与双击目标为约定取值', () => {
    expect(DOUBLE_TAP_WINDOW_MS).toBe(300);
    expect(DOUBLE_TAP_SCALE).toBe(2);
    expect(ZOOMED_TOLERANCE).toBe(0.01);
  });
});

describe('scaleFromPinchDistance（距离比缩放）', () => {
  it('距离不变时保持起始比例', () => {
    expect(scaleFromPinchDistance(120, 120, 1)).toBe(1);
    expect(scaleFromPinchDistance(120, 120, 2.5)).toBe(2.5);
  });

  it('距离翻倍 → 比例翻倍（区间内）', () => {
    expect(scaleFromPinchDistance(100, 200, 1)).toBe(2);
    expect(scaleFromPinchDistance(50, 75, 2)).toBe(3);
  });

  it('距离减半 → 比例减半（区间内）', () => {
    expect(scaleFromPinchDistance(200, 100, 2)).toBe(1);
  });

  it('越过上界时 clamp 到 MAX_ZOOM_SCALE', () => {
    expect(scaleFromPinchDistance(10, 10_000, 1)).toBe(MAX_ZOOM_SCALE);
    expect(scaleFromPinchDistance(100, 200, 4)).toBe(MAX_ZOOM_SCALE);
  });

  it('越过下界时 clamp 到 MIN_ZOOM_SCALE', () => {
    expect(scaleFromPinchDistance(10_000, 1, 1)).toBe(MIN_ZOOM_SCALE);
    expect(scaleFromPinchDistance(100, 1, 0.5)).toBe(MIN_ZOOM_SCALE);
  });

  it('startDistance === 0 时安全回退到 startScale', () => {
    expect(scaleFromPinchDistance(0, 250, 1.75)).toBe(1.75);
  });

  it('startDistance 为负数时安全回退到 startScale', () => {
    expect(scaleFromPinchDistance(-40, 250, 1.75)).toBe(1.75);
  });

  it('startDistance 非有限（NaN / Infinity）时安全回退到 startScale', () => {
    expect(scaleFromPinchDistance(Number.NaN, 250, 1.75)).toBe(1.75);
    expect(scaleFromPinchDistance(Number.POSITIVE_INFINITY, 250, 1.75)).toBe(1.75);
  });

  it('currentDistance 非有限时安全回退到 startScale', () => {
    expect(scaleFromPinchDistance(100, Number.NaN, 1.75)).toBe(1.75);
    expect(scaleFromPinchDistance(100, Number.POSITIVE_INFINITY, 1.75)).toBe(1.75);
  });

  it('startScale 非有限时以 1× 为基线', () => {
    expect(scaleFromPinchDistance(100, 200, Number.NaN)).toBe(2);
    expect(scaleFromPinchDistance(100, 200, Number.POSITIVE_INFINITY)).toBe(2);
    expect(scaleFromPinchDistance(0, 200, Number.NaN)).toBe(1);
  });

  it('自定义区间生效', () => {
    expect(scaleFromPinchDistance(100, 200, 1, 1, 1.5)).toBe(1.5);
    expect(scaleFromPinchDistance(100, 50, 1.5, 1.5, 1.9)).toBe(1.5);
    expect(scaleFromPinchDistance(100, 100, 1.2, 1.5, 1.9)).toBe(1.5);
  });

  it('min > max 时自动交换（不产生空区间）', () => {
    expect(scaleFromPinchDistance(100, 400, 1, 5, 2)).toBe(5);
    expect(scaleFromPinchDistance(100, 1, 3, 5, 2)).toBe(2);
    expect(scaleFromPinchDistance(100, 100, 3, 5, 2)).toBe(3);
  });

  it('区间非法值回退到正式上下界', () => {
    expect(scaleFromPinchDistance(10, 100_000, 1, Number.NaN, Number.NaN)).toBe(MAX_ZOOM_SCALE);
    expect(scaleFromPinchDistance(100_000, 1, 1, Number.NaN, Number.NaN)).toBe(MIN_ZOOM_SCALE);
  });

  it('距离单调递增 → 比例非递减（不漂移）', () => {
    let previous = scaleFromPinchDistance(100, 10, 1);
    for (let distance = 20; distance <= 600; distance += 20) {
      const current = scaleFromPinchDistance(100, distance, 1);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('focusPointZoom（焦点缩放）', () => {
  it('比例不变时位移不变', () => {
    expect(
      focusPointZoom({
        scale: 2,
        nextScale: 2,
        focal: { x: 33, y: -18 },
        translate: { x: 7, y: 9 },
      }),
    ).toEqual({ x: 7, y: 9 });
  });

  it('1× → 2× 且位移为 0 时，焦点坐标按 −f 平移', () => {
    expect(
      focusPointZoom({
        scale: 1,
        nextScale: 2,
        focal: { x: 100, y: 50 },
        translate: { x: 0, y: 0 },
      }),
    ).toEqual({ x: -100, y: -50 });
  });

  it('焦点处像素保持不动（不变量，多组数值）', () => {
    expectFocalPixelPinned(1, 2, { x: 100, y: 50 }, { x: 0, y: 0 });
    expectFocalPixelPinned(2, 3.5, { x: 25, y: -8 }, { x: -30, y: 12 });
    expectFocalPixelPinned(5, 2.5, { x: -140, y: 96 }, { x: 40, y: -60 });
    expectFocalPixelPinned(0.5, 1.25, { x: 12, y: 12 }, { x: 3, y: -4 });
  });

  it('倍数比例（s → 2s）时位移正好放大到两倍（含已有位移）', () => {
    expect(
      focusPointZoom({
        scale: 1.5,
        nextScale: 3,
        focal: { x: 60, y: 0 },
        translate: { x: 10, y: 0 },
      }),
    ).toEqual({ x: -40, y: 0 });
  });

  it('焦点或位移含非有限分量时按 0 归一', () => {
    expect(
      focusPointZoom({
        scale: 1,
        nextScale: 2,
        focal: { x: Number.NaN, y: 40 },
        translate: { x: Number.POSITIVE_INFINITY, y: 0 },
      }),
    ).toEqual({ x: 0, y: -40 });
  });

  it('比例非法（NaN / Infinity / <= 0）时原样返回位移', () => {
    const translate = { x: 5, y: -6 };
    expect(
      focusPointZoom({ scale: Number.NaN, nextScale: 2, focal: { x: 1, y: 1 }, translate }),
    ).toEqual(translate);
    expect(focusPointZoom({ scale: 0, nextScale: 2, focal: { x: 1, y: 1 }, translate })).toEqual(
      translate,
    );
    expect(focusPointZoom({ scale: -1, nextScale: 2, focal: { x: 1, y: 1 }, translate })).toEqual(
      translate,
    );
    expect(
      focusPointZoom({ scale: 1, nextScale: Number.NaN, focal: { x: 1, y: 1 }, translate }),
    ).toEqual(translate);
    expect(focusPointZoom({ scale: 1, nextScale: 0, focal: { x: 1, y: 1 }, translate })).toEqual(
      translate,
    );
  });
});

describe('clampTranslate（平移夹取）', () => {
  const contentSize = { width: 100, height: 100 };

  it('内容等于视口时位移恒为 0', () => {
    expect(
      clampTranslate({
        translate: { x: 30, y: -30 },
        contentSize,
        viewportSize: contentSize,
        scale: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('内容小于视口时位移恒为 0（防图飘走）', () => {
    expect(
      clampTranslate({
        translate: { x: 80, y: -80 },
        contentSize,
        viewportSize: { width: 320, height: 480 },
        scale: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      clampTranslate({
        translate: { x: 80, y: -80 },
        contentSize,
        viewportSize: { width: 200, height: 200 },
        scale: 2,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('区间内位移原样保留', () => {
    expect(
      clampTranslate({
        translate: { x: 10, y: -30 },
        contentSize,
        viewportSize: contentSize,
        scale: 2,
      }),
    ).toEqual({ x: 10, y: -30 });
  });

  it('超出部分夹到 ±(内容 × scale − 视口) / 2', () => {
    expect(
      clampTranslate({
        translate: { x: 80, y: -20 },
        contentSize,
        viewportSize: contentSize,
        scale: 2,
      }),
    ).toEqual({ x: 50, y: -20 });
    expect(
      clampTranslate({
        translate: { x: -999, y: 999 },
        contentSize,
        viewportSize: contentSize,
        scale: 2,
      }),
    ).toEqual({ x: -50, y: 50 });
  });

  it('双轴独立：一个轴夹取、另一个轴判零', () => {
    expect(
      clampTranslate({
        translate: { x: 80, y: 40 },
        contentSize,
        viewportSize: { width: 100, height: 200 },
        scale: 2,
      }),
    ).toEqual({ x: 50, y: 0 });
  });

  it('位移含非有限分量时按 0 归一后再夹取', () => {
    expect(
      clampTranslate({
        translate: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        contentSize,
        viewportSize: contentSize,
        scale: 2,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('尺寸非法（0 / 负数 / 非有限）时返回零位移', () => {
    expect(
      clampTranslate({
        translate: { x: 50, y: 50 },
        contentSize: { width: 0, height: -10 },
        viewportSize: { width: 100, height: 100 },
        scale: 3,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      clampTranslate({
        translate: { x: 50, y: 50 },
        contentSize: { width: Number.NaN, height: 100 },
        viewportSize: { width: 100, height: Number.POSITIVE_INFINITY },
        scale: 3,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('scale 非法（NaN / <= 0）时返回零位移', () => {
    expect(
      clampTranslate({
        translate: { x: 50, y: 50 },
        contentSize,
        viewportSize: contentSize,
        scale: Number.NaN,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      clampTranslate({
        translate: { x: 50, y: 50 },
        contentSize,
        viewportSize: contentSize,
        scale: 0,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('nextDoubleTapScale（1 ↔ 2 切换）', () => {
  it('1× 双击放大到 2×，2× 双击回到 1×', () => {
    expect(nextDoubleTapScale(1)).toBe(2);
    expect(nextDoubleTapScale(2)).toBe(1);
  });

  it('缩放到其它倍数时双击一律回到 1×', () => {
    expect(nextDoubleTapScale(5)).toBe(1);
    expect(nextDoubleTapScale(1.5)).toBe(1);
  });

  it('缩放到 1× 以下时双击放大到 2×', () => {
    expect(nextDoubleTapScale(0.5)).toBe(2);
    expect(nextDoubleTapScale(0.25)).toBe(2);
  });

  it('非有限值按「未放大」处理', () => {
    expect(nextDoubleTapScale(Number.NaN)).toBe(2);
    expect(nextDoubleTapScale(Number.POSITIVE_INFINITY)).toBe(2);
    expect(nextDoubleTapScale(Number.NEGATIVE_INFINITY)).toBe(2);
  });

  it('默认严格按 scale > 1 判定，传容差后可覆盖回弹带', () => {
    expect(nextDoubleTapScale(1.0001)).toBe(1);
    expect(nextDoubleTapScale(1.0001, ZOOMED_TOLERANCE)).toBe(2);
    expect(nextDoubleTapScale(1.02, ZOOMED_TOLERANCE)).toBe(1);
    expect(nextDoubleTapScale(1.005, 0.01)).toBe(2);
    expect(nextDoubleTapScale(1.005, Number.NaN)).toBe(1);
  });
});

describe('deriveZoomed（含容差的门控派生）', () => {
  it('1× 恒为 false', () => {
    expect(deriveZoomed(1)).toBe(false);
  });

  it('回弹带（|scale − 1| ≤ 容差）为 false', () => {
    expect(deriveZoomed(1.0001)).toBe(false);
    expect(deriveZoomed(0.99)).toBe(false);
    expect(deriveZoomed(1.005)).toBe(false);
    expect(deriveZoomed(0.995)).toBe(false);
  });

  it('超过容差为 true', () => {
    expect(deriveZoomed(1.02)).toBe(true);
    expect(deriveZoomed(0.9)).toBe(true);
    expect(deriveZoomed(5)).toBe(true);
    expect(deriveZoomed(0.25)).toBe(true);
  });

  it('自定义容差生效', () => {
    expect(deriveZoomed(1.02, 0.05)).toBe(false);
    expect(deriveZoomed(1.06, 0.05)).toBe(true);
    expect(deriveZoomed(1.02, 0)).toBe(true);
  });

  it('容差非法（负数 / 非有限）时回退默认容差', () => {
    expect(deriveZoomed(1.0001, -1)).toBe(false);
    expect(deriveZoomed(1.02, Number.NaN)).toBe(true);
    expect(deriveZoomed(1.0001, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('非有限 scale 一律 false（fail-open，不锁死翻页）', () => {
    expect(deriveZoomed(Number.NaN)).toBe(false);
    expect(deriveZoomed(Number.POSITIVE_INFINITY)).toBe(false);
    expect(deriveZoomed(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('distanceBetween / midpoint（双指几何）', () => {
  it('距离按勾股定理计算', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceBetween({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
  });

  it('同一点距离为 0', () => {
    expect(distanceBetween({ x: 12, y: -8 }, { x: 12, y: -8 })).toBe(0);
  });

  it('距离含非有限分量时按 0 归一，绝不返回 NaN', () => {
    expect(distanceBetween({ x: Number.NaN, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceBetween({ x: Number.POSITIVE_INFINITY, y: Number.NaN }, { x: 0, y: 0 })).toBe(0);
  });

  it('中点按分量取平均', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    expect(midpoint({ x: -10, y: 5 }, { x: 10, y: -5 })).toEqual({ x: 0, y: 0 });
  });

  it('中点含非有限分量时按 0 归一', () => {
    expect(midpoint({ x: Number.NaN, y: 4 }, { x: 2, y: 0 })).toEqual({ x: 1, y: 2 });
  });
});
