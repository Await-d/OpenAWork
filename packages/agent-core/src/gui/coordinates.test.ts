import { describe, expect, it } from 'vitest';
import {
  GUI_DEFAULT_FACTOR,
  GUI_IMAGE_FACTOR,
  boxCenter,
  boxToPixelCenter,
  clampRatio,
  normalizedToRatio,
  pointToPixel,
  ratioToPixel,
} from './coordinates.js';
import type { GuiBox } from './coordinates.js';

describe('coordinates 常量', () => {
  it('默认归一化分母为 1000，图像因子为 28', () => {
    expect(GUI_DEFAULT_FACTOR).toBe(1000);
    expect(GUI_IMAGE_FACTOR).toBe(28);
  });
});

describe('clampRatio', () => {
  it('包内数值原样返回，越界收敛到 [0, 1]', () => {
    expect(clampRatio(0)).toBe(0);
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(1)).toBe(1);
    expect(clampRatio(1.5)).toBe(1);
    expect(clampRatio(-0.2)).toBe(0);
  });

  it('非有限数返回 0', () => {
    expect(clampRatio(Number.NaN)).toBe(0);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampRatio(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('normalizedToRatio', () => {
  it('0~1 视为已是比例', () => {
    expect(normalizedToRatio(0)).toBe(0);
    expect(normalizedToRatio(0.25)).toBe(0.25);
    expect(normalizedToRatio(1)).toBe(1);
  });

  it('0~1000 归一化整数按 factor 换算', () => {
    expect(normalizedToRatio(500)).toBe(0.5);
    expect(normalizedToRatio(1000)).toBe(1);
    expect(normalizedToRatio(1)).toBe(1);
  });

  it('factor=28 场景：0~28 归一化整数', () => {
    expect(normalizedToRatio(14, 28)).toBe(0.5);
    expect(normalizedToRatio(28, 28)).toBe(1);
    expect(normalizedToRatio(7, 28)).toBe(0.25);
  });

  it('大于 factor 视为已按 28 预缩放的图像像素', () => {
    // 100 > 28 → 100 / 28 / 28
    expect(normalizedToRatio(100, 28)).toBeCloseTo(100 / 28 / 28, 10);
    // 2000 > 1000 → 2000 / 28 / 1000
    expect(normalizedToRatio(2000)).toBeCloseTo(2000 / 28 / 1000, 10);
  });

  it('越界 / 非有限数被收敛', () => {
    expect(normalizedToRatio(-5)).toBe(0);
    expect(normalizedToRatio(Number.NaN)).toBe(0);
    expect(normalizedToRatio(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizedToRatio(1e9)).toBeLessThanOrEqual(1);
  });

  it('factor 非法时回退默认分母', () => {
    expect(normalizedToRatio(500, 0)).toBe(0.5);
    expect(normalizedToRatio(500, Number.NaN)).toBe(0.5);
  });
});

describe('ratioToPixel', () => {
  it('比例 × 逻辑尺寸', () => {
    expect(ratioToPixel({ x: 0.5, y: 0.5 }, { width: 1000, height: 800 })).toEqual({
      x: 500,
      y: 400,
    });
  });

  it('dpr=2 时除以 dpr 还原逻辑坐标', () => {
    expect(ratioToPixel({ x: 0.5, y: 0.5 }, { width: 1000, height: 800 }, 2)).toEqual({
      x: 250,
      y: 200,
    });
  });

  it('非法 dpr 回退为 1', () => {
    expect(ratioToPixel({ x: 0.5, y: 0.5 }, { width: 100, height: 100 }, 0)).toEqual({
      x: 50,
      y: 50,
    });
  });
});

describe('boxCenter', () => {
  it('返回矩形中心', () => {
    expect(boxCenter([0, 0, 10, 20])).toEqual({ x: 5, y: 10 });
  });

  it('退化框 / 反向框抛错', () => {
    expect(() => boxCenter([5, 5, 5, 10])).toThrow();
    expect(() => boxCenter([10, 0, 0, 10])).toThrow();
    expect(() => boxCenter([0, 10, 10, 0])).toThrow();
  });

  it('含非有限数抛错', () => {
    const bad = [Number.NaN, 0, 10, 10] as unknown as GuiBox;
    expect(() => boxCenter(bad)).toThrow();
  });
});

describe('boxToPixelCenter', () => {
  it('0~1000 box → 逻辑像素中心', () => {
    expect(boxToPixelCenter([100, 200, 300, 400], { width: 1000, height: 1000 })).toEqual({
      x: 200,
      y: 300,
    });
  });

  it('factor=28 box → 逻辑像素中心', () => {
    expect(boxToPixelCenter([7, 7, 21, 21], { width: 28, height: 28 }, { factor: 28 })).toEqual({
      x: 14,
      y: 14,
    });
  });

  it('dpr=2 时还原为逻辑坐标', () => {
    expect(
      boxToPixelCenter([100, 200, 300, 400], { width: 1000, height: 1000 }, { dpr: 2 }),
    ).toEqual({ x: 100, y: 150 });
  });
});

describe('pointToPixel', () => {
  it('0~1 比例点 → 像素点', () => {
    expect(pointToPixel({ x: 0.5, y: 0.25 }, { width: 800, height: 400 })).toEqual({
      x: 400,
      y: 100,
    });
  });

  it('factor=28 点 → 像素点', () => {
    expect(pointToPixel({ x: 14, y: 14 }, { width: 28, height: 28 }, { factor: 28 })).toEqual({
      x: 14,
      y: 14,
    });
  });

  it('dpr=2 点 → 逻辑像素点', () => {
    expect(pointToPixel({ x: 0.5, y: 0.5 }, { width: 1000, height: 800 }, { dpr: 2 })).toEqual({
      x: 250,
      y: 200,
    });
  });
});
