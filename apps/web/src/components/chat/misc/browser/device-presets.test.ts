/**
 * 设备预设与缩放档位的契约测试。
 *
 * 钉住四件容易被后续改动悄悄破坏的事：自适应始终是默认项、移动端预设带真实 UA、
 * 固定预设的尺寸 / DPR / mobile 三项与约定一致、缩放步进不会越界。
 */

import { describe, expect, it } from 'vitest';

import {
  BROWSER_DEVICE_PRESETS,
  BROWSER_ZOOM_LEVELS,
  DEFAULT_DEVICE_PRESET_ID,
  resolveDevicePreset,
  stepBrowserZoom,
} from './device-presets.js';

describe('BROWSER_DEVICE_PRESETS', () => {
  it('包含约定的六个预设，且 id 唯一', () => {
    const ids = BROWSER_DEVICE_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual([
      'responsive',
      'phone-375',
      'phone-430',
      'tablet-768',
      'laptop-1280',
      'desktop-1920',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('手机 / 大屏手机是 mobile 且携带移动端 UA，其余预设不带 UA', () => {
    const mobilePresets = BROWSER_DEVICE_PRESETS.filter((preset) => preset.mobile);
    expect(mobilePresets.map((preset) => preset.id)).toEqual(['phone-375', 'phone-430']);

    for (const preset of mobilePresets) {
      expect(preset.userAgent).toBeDefined();
      expect(preset.userAgent).toMatch(/iPhone|Android/i);
    }

    const desktopPresets = BROWSER_DEVICE_PRESETS.filter((preset) => !preset.mobile);
    for (const preset of desktopPresets) {
      expect(preset.userAgent).toBeUndefined();
    }
  });

  it('固定预设的尺寸 / DPR 与约定一致，自适应尺寸恒为 0', () => {
    expect(resolveDevicePreset('phone-375')).toMatchObject({
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
    });
    expect(resolveDevicePreset('phone-430')).toMatchObject({
      width: 430,
      height: 932,
      deviceScaleFactor: 3,
    });
    expect(resolveDevicePreset('tablet-768')).toMatchObject({
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      mobile: false,
    });
    expect(resolveDevicePreset('laptop-1280')).toMatchObject({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    });
    expect(resolveDevicePreset('desktop-1920')).toMatchObject({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    const responsive = resolveDevicePreset('responsive');
    expect(responsive).not.toBeNull();
    expect(responsive?.width).toBe(0);
    expect(responsive?.height).toBe(0);
  });
});

describe('resolveDevicePreset', () => {
  it('默认预设解析为自适应（不锁定设备尺寸）', () => {
    const preset = resolveDevicePreset(DEFAULT_DEVICE_PRESET_ID);
    expect(preset).not.toBeNull();
    expect(preset?.width).toBe(0);
    expect(preset?.height).toBe(0);
  });

  it('未知 id 返回 null，由调用方回退到自适应', () => {
    expect(resolveDevicePreset('pixel-9-pro')).toBeNull();
    expect(resolveDevicePreset('')).toBeNull();
  });
});

describe('BROWSER_ZOOM_LEVELS / stepBrowserZoom', () => {
  it('档位按升序排列且包含 100%', () => {
    const levels = [...BROWSER_ZOOM_LEVELS];
    expect(levels).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(levels).toContain(1);
  });

  it('按方向取相邻档，端点不再越界', () => {
    expect(stepBrowserZoom(0.75, 'in')).toBe(1);
    expect(stepBrowserZoom(1, 'in')).toBe(1.25);
    expect(stepBrowserZoom(1, 'out')).toBe(0.75);
    expect(stepBrowserZoom(1.5, 'in')).toBe(1.5);
    expect(stepBrowserZoom(0.5, 'out')).toBe(0.5);
  });

  it('未知档位原样返回，避免把非法缩放传进 transform', () => {
    expect(stepBrowserZoom(2.5, 'in')).toBe(2.5);
    expect(stepBrowserZoom(Number.NaN, 'out')).toBe(Number.NaN);
  });
});
