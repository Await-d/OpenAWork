import { describe, expect, it } from 'vitest';
import {
  GUI_MAX_PIXELS_DOUBAO,
  GUI_MAX_PIXELS_V1_0,
  GUI_MAX_PIXELS_V1_5,
  computeScaleFactor,
  resolveMaxPixels,
  scaleScreenshotSize,
} from './screenshot-scaler.js';

describe('像素预算常量', () => {
  it('三个模型族常量正确', () => {
    expect(GUI_MAX_PIXELS_V1_0).toBe(2700 * 28 * 28);
    expect(GUI_MAX_PIXELS_DOUBAO).toBe(5120 * 28 * 28);
    expect(GUI_MAX_PIXELS_V1_5).toBe(16384 * 28 * 28);
    expect(GUI_MAX_PIXELS_V1_0).toBe(2116800);
  });

  it('resolveMaxPixels 按族返回对应预算', () => {
    expect(resolveMaxPixels('v1.0')).toBe(GUI_MAX_PIXELS_V1_0);
    expect(resolveMaxPixels('doubao')).toBe(GUI_MAX_PIXELS_DOUBAO);
    expect(resolveMaxPixels('v1.5')).toBe(GUI_MAX_PIXELS_V1_5);
  });
});

describe('computeScaleFactor', () => {
  it('预算内返回 1', () => {
    expect(computeScaleFactor({ width: 100, height: 100, maxPixels: 1_000_000 })).toBe(1);
    expect(computeScaleFactor({ width: 1000, height: 1000, maxPixels: 1_000_000 })).toBe(1);
  });

  it('超预算返回精确系数', () => {
    // 1000×1000 = 1e6，预算 250000 → sqrt(0.25) = 0.5
    expect(computeScaleFactor({ width: 1000, height: 1000, maxPixels: 250_000 })).toBeCloseTo(
      0.5,
      10,
    );
  });

  it('非法输入保守返回 1', () => {
    expect(computeScaleFactor({ width: 0, height: 100, maxPixels: 1000 })).toBe(1);
    expect(computeScaleFactor({ width: 100, height: Number.NaN, maxPixels: 1000 })).toBe(1);
    expect(computeScaleFactor({ width: 100, height: 100, maxPixels: 0 })).toBe(1);
  });
});

describe('scaleScreenshotSize', () => {
  it('预算内不缩放', () => {
    const result = scaleScreenshotSize({ width: 800, height: 600, maxPixels: 1_000_000 });
    expect(result).toEqual({ width: 800, height: 600, factor: 1, scaled: false });
  });

  it('超预算缩放且乘积不超预算', () => {
    const result = scaleScreenshotSize({ width: 1000, height: 1000, maxPixels: 250_000 });
    expect(result.scaled).toBe(true);
    expect(result.factor).toBeCloseTo(0.5, 10);
    expect(result.width).toBe(500);
    expect(result.height).toBe(500);
    expect(result.width * result.height).toBeLessThanOrEqual(250_000);
  });

  it('真实 V1.0 场景：4000×3000 缩放后不超预算', () => {
    const result = scaleScreenshotSize({
      width: 4000,
      height: 3000,
      maxPixels: GUI_MAX_PIXELS_V1_0,
    });
    expect(result.scaled).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(GUI_MAX_PIXELS_V1_0);
  });

  it('多组尺寸均保证乘积不超预算', () => {
    const budget = GUI_MAX_PIXELS_DOUBAO;
    const cases = [
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      { width: 2560, height: 1440 },
      { width: 8000, height: 1000 },
    ];
    for (const size of cases) {
      const result = scaleScreenshotSize({ ...size, maxPixels: budget });
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
      expect(result.width * result.height).toBeLessThanOrEqual(budget);
    }
  });
});
