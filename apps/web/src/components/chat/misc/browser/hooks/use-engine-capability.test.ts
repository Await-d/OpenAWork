// @vitest-environment jsdom
/**
 * 引擎能力矩阵覆盖。
 *
 * 这里钉住几件容易悄悄坏掉的事：同源判定（决定 iframe 能否执行脚本）、实时引擎
 * 「可用」与「可实时画面（screencast，仅 Chromium）」的区分、Tauri 原生 webview 的
 * 只显示语义，以及截图 / 实时预览的可用性必须如实出现在 capabilities 与
 * limitations 里。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { computeEngineCapability, useEngineCapability } from './use-engine-capability.js';

const APP_ORIGIN = 'http://localhost:5173';

afterEach(() => {
  cleanup();
});

describe('computeEngineCapability', () => {
  it('同源 iframe 可读 DOM 与执行脚本', () => {
    const capability = computeEngineCapability('iframe', `${APP_ORIGIN}/foo`, APP_ORIGIN);

    expect(capability).toEqual({
      engine: 'iframe',
      sameOrigin: true,
      domEval: true,
      screenshot: false,
      liveView: false,
      limitations: ['当前引擎不支持截图', '实时 CDP 调试尚未接入'],
    });
  });

  it('跨域 iframe 无法读 DOM，并给出中文限制说明', () => {
    const capability = computeEngineCapability('iframe', 'https://other.example/x', APP_ORIGIN);

    expect(capability.sameOrigin).toBe(false);
    expect(capability.domEval).toBe(false);
    expect(capability.limitations).toContain('跨域页面无法读取 DOM');
  });

  it('tauri-webview 即使同源也不支持 DOM 求值', () => {
    const capability = computeEngineCapability('tauri-webview', APP_ORIGIN, APP_ORIGIN);

    expect(capability.sameOrigin).toBe(true);
    expect(capability.domEval).toBe(false);
    expect(capability.limitations).toContain('当前引擎（tauri-webview）不支持 DOM 求值');
  });

  it('url 为 null 时视为非同源且不抛异常', () => {
    const capability = computeEngineCapability('iframe', null, APP_ORIGIN);

    expect(capability.sameOrigin).toBe(false);
    expect(capability.domEval).toBe(false);
    expect(capability.limitations).toContain('跨域页面无法读取 DOM');
  });

  it('非法 url 按非同源处理', () => {
    const capability = computeEngineCapability('iframe', 'http://', APP_ORIGIN);

    expect(capability.sameOrigin).toBe(false);
    expect(capability.domEval).toBe(false);
  });

  it('相对路径按当前源解析为同源', () => {
    const capability = computeEngineCapability('iframe', '/foo/bar', APP_ORIGIN);

    expect(capability.sameOrigin).toBe(true);
    expect(capability.domEval).toBe(true);
  });

  it('appOrigin 为空时视为非同源', () => {
    const capability = computeEngineCapability('iframe', APP_ORIGIN, '');

    expect(capability.sameOrigin).toBe(false);
    expect(capability.domEval).toBe(false);
  });

  it('实时不可用时，任何引擎 / 同源组合下截图与实时预览都不可用', () => {
    for (const engine of ['iframe', 'tauri-webview'] as const) {
      for (const url of [APP_ORIGIN, 'https://other.example/x', null]) {
        const capability = computeEngineCapability(engine, url, APP_ORIGIN);

        expect(capability.screenshot).toBe(false);
        expect(capability.liveView).toBe(false);
        expect(capability.limitations).toContain('当前引擎不支持截图');
        expect(capability.limitations).toContain('实时 CDP 调试尚未接入');
      }
    }
  });

  it('实时引擎可用 + Chromium：跨域同样可读 DOM 并解锁截图 / 实时视图', () => {
    const capability = computeEngineCapability(
      'iframe',
      'https://other.example/x',
      APP_ORIGIN,
      true,
      true,
    );

    expect(capability.sameOrigin).toBe(false);
    expect(capability.domEval).toBe(true);
    expect(capability.screenshot).toBe(true);
    expect(capability.liveView).toBe(true);
    expect(capability.limitations).toEqual([]);
  });

  it('实时引擎可用但非 Chromium（无 screencast）：可截图 / 读 DOM，liveView 仍为 false', () => {
    const capability = computeEngineCapability(
      'iframe',
      'https://other.example/x',
      APP_ORIGIN,
      true,
      false,
    );

    expect(capability.domEval).toBe(true);
    expect(capability.screenshot).toBe(true);
    expect(capability.liveView).toBe(false);
    expect(capability.limitations).toEqual([
      '当前实时引擎不支持 screencast（仅 Chromium 可实时预览）',
    ]);
  });

  it('liveScreencast 缺省与 liveAvailable 相同（等价于 Chromium 的既有语义）', () => {
    const capability = computeEngineCapability(
      'iframe',
      'https://other.example/x',
      APP_ORIGIN,
      true,
    );

    expect(capability.liveView).toBe(true);
    expect(capability.limitations).toEqual([]);
  });

  it('Tauri 原生 webview 只显示：即使探测到实时引擎也不可读 DOM / 截图 / 实时预览', () => {
    const capability = computeEngineCapability('tauri-webview', APP_ORIGIN, APP_ORIGIN, true, true);

    expect(capability.sameOrigin).toBe(true);
    expect(capability.domEval).toBe(false);
    expect(capability.screenshot).toBe(false);
    expect(capability.liveView).toBe(false);
    expect(capability.limitations).toContain('当前引擎（tauri-webview）不支持 DOM 求值');
    expect(capability.limitations).toContain('当前引擎不支持截图');
    expect(capability.limitations).toContain('实时 CDP 调试尚未接入');
  });
});

describe('useEngineCapability', () => {
  it('读取 window.location.origin 判定同源', () => {
    const { result } = renderHook(() =>
      useEngineCapability({ engine: 'iframe', url: window.location.origin }),
    );

    expect(result.current.sameOrigin).toBe(true);
    expect(result.current.domEval).toBe(true);
  });

  it('tauri-webview 下虽同源但 domEval 为 false', () => {
    const { result } = renderHook(() =>
      useEngineCapability({ engine: 'tauri-webview', url: window.location.origin }),
    );

    expect(result.current.engine).toBe('tauri-webview');
    expect(result.current.sameOrigin).toBe(true);
    expect(result.current.domEval).toBe(false);
  });

  it('liveAvailable / liveScreencast 透传到能力矩阵', () => {
    const { result } = renderHook(() =>
      useEngineCapability({
        engine: 'iframe',
        url: 'https://other.example/x',
        liveAvailable: true,
        liveScreencast: true,
      }),
    );

    expect(result.current.liveView).toBe(true);
    expect(result.current.screenshot).toBe(true);
    expect(result.current.domEval).toBe(true);
  });

  it('非 Chromium 实时引擎下 liveView 为 false', () => {
    const { result } = renderHook(() =>
      useEngineCapability({
        engine: 'iframe',
        url: 'https://other.example/x',
        liveAvailable: true,
        liveScreencast: false,
      }),
    );

    expect(result.current.liveView).toBe(false);
    expect(result.current.screenshot).toBe(true);
    expect(result.current.domEval).toBe(true);
  });

  it('Tauri 原生 webview 下 liveAvailable 也不解锁实时能力', () => {
    const { result } = renderHook(() =>
      useEngineCapability({
        engine: 'tauri-webview',
        url: window.location.origin,
        liveAvailable: true,
        liveScreencast: true,
      }),
    );

    expect(result.current.domEval).toBe(false);
    expect(result.current.screenshot).toBe(false);
    expect(result.current.liveView).toBe(false);
  });
});
