// @vitest-environment jsdom
/**
 * 预览快捷键的安全边界与动作分发。
 *
 * 钉住四件容易悄悄坏掉的事：
 * 1. 每个组合键只触发自己的动作，且在被接管时阻止默认行为；
 * 2. 预览 `hidden` 时**完全不注册**监听（组件常驻挂载，不能只靠卸载清理）；
 * 3. 焦点不在预览内 / 正在 `input` / `textarea` / `contenteditable` 中打字时
 *    一律放行，绝不劫持浏览器原生快捷键；
 * 4. 修饰键组合精确匹配（`Ctrl/⌘+Shift+R` ≠ `Ctrl/⌘+R`），卸载时清理监听。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type RefObject } from 'react';

import { BROWSER_DEVICE_PRESETS, DEFAULT_DEVICE_PRESET_ID } from '../device-presets.js';
import {
  BROWSER_PREVIEW_SHORTCUTS,
  browserPreviewShortcutTitle,
  isPreviewSurfaceFocused,
  isTypingTarget,
  matchBrowserPreviewShortcut,
  useBrowserPreviewShortcuts,
} from './use-browser-preview-shortcuts.js';
import { useBrowserPreviewShortcutsWiring } from './use-browser-preview-shortcuts-wiring.js';

type Combo = KeyboardEventInit & { key: string };

/** 与描述符登记一致的全量组合键（含一个刻意多出来的 `Cmd+Shift+R` 变体）。 */
const ALL_COMBOS: readonly Combo[] = [
  { key: 'r', ctrlKey: true },
  { key: 'R', metaKey: true, shiftKey: true },
  { key: 'j', ctrlKey: true, shiftKey: true },
  { key: '=', ctrlKey: true },
  { key: '+', ctrlKey: true, shiftKey: true },
  { key: '-', ctrlKey: true },
  { key: '0', ctrlKey: true },
  { key: 'd', metaKey: true, shiftKey: true },
];

function createSurface(): {
  surface: HTMLDivElement;
  surfaceRef: RefObject<HTMLElement | null>;
} {
  const surface = document.createElement('div');
  surface.tabIndex = 0;
  document.body.appendChild(surface);
  surface.focus();
  return { surface, surfaceRef: { current: surface } };
}

function createSpies() {
  return {
    reload: vi.fn(),
    toggleConsole: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    cycleDevicePreset: vi.fn(),
  };
}

type Spies = ReturnType<typeof createSpies>;

/** 在目标上派发一次真实 `keydown`；返回事件以便断言 `defaultPrevented`。 */
function press(target: Element | Window, combo: Combo): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...combo });
  target.dispatchEvent(event);
  return event;
}

function expectNoActionFired(actions: Spies): void {
  for (const [name, spy] of Object.entries(actions)) {
    expect(spy, `${name} 不应被触发`).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useBrowserPreviewShortcuts', () => {
  it('预览可见且表面持焦时，每个快捷键精确触发对应动作并阻止默认行为', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    const cases: ReadonlyArray<readonly [keyof Spies, Combo]> = [
      ['reload', { key: 'r', metaKey: true }],
      ['toggleConsole', { key: 'J', ctrlKey: true, shiftKey: true }],
      ['zoomIn', { key: '=', ctrlKey: true }],
      ['zoomIn', { key: '+', ctrlKey: true, shiftKey: true }],
      ['zoomOut', { key: '-', ctrlKey: true }],
      ['zoomReset', { key: '0', ctrlKey: true }],
      ['cycleDevicePreset', { key: 'd', metaKey: true, shiftKey: true }],
    ];

    for (const [name, combo] of cases) {
      const event = press(surface, combo);
      expect(event.defaultPrevented, `${name} 应接管并阻止默认行为`).toBe(true);
    }

    expect(actions.reload).toHaveBeenCalledTimes(1);
    expect(actions.toggleConsole).toHaveBeenCalledTimes(1);
    expect(actions.zoomIn).toHaveBeenCalledTimes(2);
    expect(actions.zoomOut).toHaveBeenCalledTimes(1);
    expect(actions.zoomReset).toHaveBeenCalledTimes(1);
    expect(actions.cycleDevicePreset).toHaveBeenCalledTimes(1);
  });

  it('预览 hidden 时不注册 keydown 监听，所有快捷键保持惰性', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    const addListener = vi.spyOn(window, 'addEventListener');
    renderHook(() => useBrowserPreviewShortcuts({ hidden: true, surfaceRef, ...actions }));

    const keydownRegistrations = addListener.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownRegistrations).toHaveLength(0);

    for (const combo of ALL_COMBOS) {
      expect(press(surface, combo).defaultPrevented).toBe(false);
    }
    expectNoActionFired(actions);
  });

  it('焦点在预览之外（地址栏 / 页面其他元素）时不接管任何快捷键', () => {
    const actions = createSpies();
    const { surfaceRef } = createSurface();
    const outside = document.createElement('button');
    outside.type = 'button';
    document.body.appendChild(outside);
    outside.focus();

    expect(document.activeElement).toBe(outside);
    expect(isPreviewSurfaceFocused(surfaceRef.current)).toBe(false);

    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    for (const combo of ALL_COMBOS) {
      expect(press(outside, combo).defaultPrevented).toBe(false);
    }
    expectNoActionFired(actions);
  });

  it('在 input / textarea / contenteditable 中打字时不触发任何快捷键', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    // 故意放进预览容器内：输入豁免必须优先于焦点作用域。
    surface.append(input, textarea, editable);

    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    for (const target of [input, textarea, editable]) {
      target.focus();
      expect(isPreviewSurfaceFocused(surfaceRef.current)).toBe(true);
      for (const combo of ALL_COMBOS) {
        expect(press(target, combo).defaultPrevented).toBe(false);
      }
    }
    expectNoActionFired(actions);
  });

  it('修饰键组合精确匹配：Ctrl/⌘+Shift+R 不会触发普通刷新，Ctrl+J 也不会开关控制台', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    expect(press(surface, { key: 'R', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(press(surface, { key: 'R', metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(press(surface, { key: 'j', ctrlKey: true }).defaultPrevented).toBe(false);

    expectNoActionFired(actions);
  });

  it('带 Alt 的修饰键组合不被接管', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    expect(press(surface, { key: 'r', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(
      press(surface, { key: 'j', ctrlKey: true, altKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(false);

    expectNoActionFired(actions);
  });

  it('长按重复事件（repeat）只保留首次，不连发动作', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    renderHook(() => useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }));

    press(surface, { key: 'r', ctrlKey: true });
    press(surface, { key: 'r', ctrlKey: true, repeat: true });
    press(surface, { key: 'r', ctrlKey: true, repeat: true });

    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it('卸载时移除 window keydown 监听，之后按键不再触发动作', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = renderHook(() =>
      useBrowserPreviewShortcuts({ hidden: false, surfaceRef, ...actions }),
    );

    press(surface, { key: 'r', ctrlKey: true });
    expect(actions.reload).toHaveBeenCalledTimes(1);

    view.unmount();

    const keydownRemovals = removeListener.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownRemovals).toHaveLength(1);
    expect(keydownRemovals[0]?.[2]).toEqual({ capture: true });

    expect(press(surface, { key: 'r', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it('hidden 从 false 切到 true 时移除监听，切回可见后重新生效', () => {
    const actions = createSpies();
    const { surface, surfaceRef } = createSurface();
    const { rerender } = renderHook(
      ({ hidden }: { hidden: boolean }) =>
        useBrowserPreviewShortcuts({ hidden, surfaceRef, ...actions }),
      { initialProps: { hidden: false } },
    );

    press(surface, { key: 'j', ctrlKey: true, shiftKey: true });
    expect(actions.toggleConsole).toHaveBeenCalledTimes(1);

    rerender({ hidden: true });
    expect(press(surface, { key: 'j', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(actions.toggleConsole).toHaveBeenCalledTimes(1);

    rerender({ hidden: false });
    press(surface, { key: 'j', ctrlKey: true, shiftKey: true });
    expect(actions.toggleConsole).toHaveBeenCalledTimes(2);
  });

  it('active 只包含已接线的动作：未接线时既不提示也不拦截', () => {
    const { surface, surfaceRef } = createSurface();
    const reload = vi.fn();
    const toggleConsole = vi.fn();
    const { result, rerender } = renderHook(
      ({ wireDeviceActions }: { wireDeviceActions: boolean }) =>
        useBrowserPreviewShortcuts({
          hidden: false,
          surfaceRef,
          reload,
          toggleConsole,
          ...(wireDeviceActions
            ? { zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn(), cycleDevicePreset: vi.fn() }
            : {}),
        }),
      { initialProps: { wireDeviceActions: false } },
    );

    expect(result.current.active.map((shortcut) => shortcut.id)).toEqual([
      'reload',
      'toggleConsole',
    ]);
    // 设备动作未接线：组合键不拦截，原生缩放仍然可用。
    expect(press(surface, { key: '0', ctrlKey: true }).defaultPrevented).toBe(false);

    rerender({ wireDeviceActions: true });

    expect(result.current.active.map((shortcut) => shortcut.id)).toEqual([
      'reload',
      'toggleConsole',
      'zoomIn',
      'zoomOut',
      'zoomReset',
      'cycleDevicePreset',
    ]);
    expect(press(surface, { key: '0', ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('匹配表与描述符同源：每个登记组合键都命中自身动作，未登记组合为 null', () => {
    for (const shortcut of BROWSER_PREVIEW_SHORTCUTS) {
      for (const binding of shortcut.bindings) {
        expect(
          matchBrowserPreviewShortcut({
            key: binding.key,
            ctrlKey: true,
            metaKey: false,
            altKey: false,
            shiftKey: binding.shift,
          }),
          `${shortcut.id} / ${binding.key}`,
        ).toBe(shortcut.id);
      }
    }

    expect(
      matchBrowserPreviewShortcut({
        key: 'r',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(
      matchBrowserPreviewShortcut({
        key: 'R',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBeNull();
    expect(
      matchBrowserPreviewShortcut({
        key: 'j',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(
      matchBrowserPreviewShortcut({
        key: 'r',
        ctrlKey: false,
        metaKey: true,
        altKey: true,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it('isTypingTarget 只把真正可编辑的目标判定为输入，contenteditable="false" 除外', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const notEditable = document.createElement('div');
    notEditable.setAttribute('contenteditable', 'false');
    const plain = document.createElement('div');

    for (const target of [input, textarea, select, editable]) {
      expect(isTypingTarget(target), target.tagName).toBe(true);
    }
    for (const target of [notEditable, plain, null]) {
      expect(isTypingTarget(target)).toBe(false);
    }
  });
});

interface WiringHarnessOptions {
  hidden: boolean;
  devicePreviewEnabled: boolean;
  surfaceRef: RefObject<HTMLElement | null>;
}

/** 用真实 state 复刻 `BuiltInBrowser` 的接线：快捷键必须驱动既有状态，而不是平行副本。 */
function useWiringHarness({ hidden, devicePreviewEnabled, surfaceRef }: WiringHarnessOptions) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [devicePresetId, setDevicePresetId] = useState<string>(DEFAULT_DEVICE_PRESET_ID);
  const wiring = useBrowserPreviewShortcutsWiring({
    hidden,
    surfaceRef,
    devicePreviewEnabled,
    setRefreshKey,
    setConsoleOpen,
    setZoom,
    setDevicePresetId,
  });
  return { wiring, refreshKey, consoleOpen, zoom, devicePresetId };
}

describe('useBrowserPreviewShortcutsWiring', () => {
  it('六个快捷键分别驱动既有的刷新 / 控制台 / 缩放 / 设备预设状态', () => {
    const { surface, surfaceRef } = createSurface();
    const { result } = renderHook(() =>
      useWiringHarness({ hidden: false, devicePreviewEnabled: true, surfaceRef }),
    );

    act(() => {
      press(surface, { key: 'r', ctrlKey: true });
    });
    expect(result.current.refreshKey).toBe(1);

    act(() => {
      press(surface, { key: 'j', ctrlKey: true, shiftKey: true });
    });
    expect(result.current.consoleOpen).toBe(true);

    act(() => {
      press(surface, { key: '=', ctrlKey: true });
    });
    expect(result.current.zoom).toBe(1.25);
    act(() => {
      press(surface, { key: '=', ctrlKey: true });
    });
    expect(result.current.zoom).toBe(1.5);
    act(() => {
      press(surface, { key: '=', ctrlKey: true });
    });
    // 已到最高档：停在端点，不会越界。
    expect(result.current.zoom).toBe(1.5);

    act(() => {
      press(surface, { key: '0', ctrlKey: true });
    });
    expect(result.current.zoom).toBe(1);

    act(() => {
      press(surface, { key: '-', ctrlKey: true });
    });
    expect(result.current.zoom).toBe(0.75);

    act(() => {
      press(surface, { key: 'd', metaKey: true, shiftKey: true });
    });
    expect(result.current.devicePresetId).toBe(BROWSER_DEVICE_PRESETS[1]?.id);
  });

  it('设备预设循环切换：末位回到自适应预设，不越界', () => {
    const { surface, surfaceRef } = createSurface();
    const { result } = renderHook(() =>
      useWiringHarness({ hidden: false, devicePreviewEnabled: true, surfaceRef }),
    );

    const visited: string[] = [result.current.devicePresetId];
    for (let index = 0; index < BROWSER_DEVICE_PRESETS.length; index += 1) {
      act(() => {
        press(surface, { key: 'D', metaKey: true, shiftKey: true });
      });
      visited.push(result.current.devicePresetId);
    }

    expect(visited).toEqual([
      ...BROWSER_DEVICE_PRESETS.map((preset) => preset.id),
      DEFAULT_DEVICE_PRESET_ID,
    ]);
  });

  it('hidden 时六个动作全部惰性：任一状态都不改变', () => {
    const { surface, surfaceRef } = createSurface();
    const { result } = renderHook(() =>
      useWiringHarness({ hidden: true, devicePreviewEnabled: true, surfaceRef }),
    );

    for (const combo of ALL_COMBOS) {
      act(() => {
        press(surface, combo);
      });
    }

    expect(result.current.refreshKey).toBe(0);
    expect(result.current.consoleOpen).toBe(false);
    expect(result.current.zoom).toBe(1);
    expect(result.current.devicePresetId).toBe(DEFAULT_DEVICE_PRESET_ID);
  });

  it('devicePreviewEnabled=false（Tauri）时不接线设备动作：不拦截也不出现在提示列表', () => {
    const { surface, surfaceRef } = createSurface();
    const { result } = renderHook(() =>
      useWiringHarness({ hidden: false, devicePreviewEnabled: false, surfaceRef }),
    );

    expect(result.current.wiring.active.map((shortcut) => shortcut.id)).toEqual([
      'reload',
      'toggleConsole',
    ]);

    const deviceCombos: readonly Combo[] = [
      { key: '=', ctrlKey: true },
      { key: '-', ctrlKey: true },
      { key: '0', ctrlKey: true },
      { key: 'd', metaKey: true, shiftKey: true },
    ];
    for (const combo of deviceCombos) {
      expect(press(surface, combo).defaultPrevented).toBe(false);
    }
    expect(result.current.zoom).toBe(1);
    expect(result.current.devicePresetId).toBe(DEFAULT_DEVICE_PRESET_ID);
  });

  it('设备动作全部接线时，active 与 BROWSER_PREVIEW_SHORTCUTS 完全一致', () => {
    const { surfaceRef } = createSurface();
    const { result } = renderHook(() =>
      useWiringHarness({ hidden: false, devicePreviewEnabled: true, surfaceRef }),
    );

    expect(result.current.wiring.active).toEqual(BROWSER_PREVIEW_SHORTCUTS);
  });
});

describe('browserPreviewShortcutTitle', () => {
  it('控件 title 的组合键从描述符派生，无法与快捷键漂移', () => {
    for (const shortcut of BROWSER_PREVIEW_SHORTCUTS) {
      expect(browserPreviewShortcutTitle('动作', shortcut.id)).toBe(
        `动作 (${shortcut.combination})`,
      );
    }
  });
});
