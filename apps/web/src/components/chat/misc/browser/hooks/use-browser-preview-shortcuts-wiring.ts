/**
 * `BuiltInBrowser` 的预览快捷键接线：把宿主既有的状态适配成快捷键动作，
 * 并把「已接线」的描述符交回宿主渲染提示。
 *
 * 单独立 hook 的两个原因：
 * 1. 宿主已经很大，接线细节（以及接下来的设备动作适配）不应再堆进去；
 * 2. 快捷键与工具栏控件必须读写**同一份**状态——这里只接受既有 setter，
 *    不持有任何平行 zoom / preset 状态，也不重复实现缩放 / 预设算法
 *    （统一走 `device-presets.ts` 的 `stepBrowserZoom` / `BROWSER_DEVICE_PRESETS`）。
 */

import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  BROWSER_DEVICE_PRESETS,
  DEFAULT_DEVICE_PRESET_ID,
  stepBrowserZoom,
} from '../device-presets.js';
import {
  useBrowserPreviewShortcuts,
  type BrowserPreviewShortcutDescriptor,
} from './use-browser-preview-shortcuts.js';

export interface UseBrowserPreviewShortcutsWiringOptions {
  /** 预览是否可见（`BuiltInBrowser.hidden`）：不可见时快捷键完全惰性。 */
  hidden: boolean;
  /** 预览交互区容器（iframe / CDP 画面所在元素），用于「预览持焦」闸门。 */
  surfaceRef: RefObject<HTMLElement | null>;
  /**
   * 设备动作是否接线；与工具栏 `devicePreviewEnabled` 同源。
   * Tauri 原生 webview 不参与设备预览，此时设备组合键不注册（放行原生缩放）。
   */
  devicePreviewEnabled: boolean;
  setRefreshKey: Dispatch<SetStateAction<number>>;
  setConsoleOpen: Dispatch<SetStateAction<boolean>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setDevicePresetId: Dispatch<SetStateAction<string>>;
}

export interface BrowserPreviewShortcutsWiring {
  /** 已接线的快捷键描述符：提示 UI 直接渲染，保证「提示了什么就真的能用什么」。 */
  active: readonly BrowserPreviewShortcutDescriptor[];
  /** 与快捷键同一份动作：工具栏按钮直接复用，按钮与组合键不允许漂移。 */
  reload: () => void;
  toggleConsole: () => void;
}

export function useBrowserPreviewShortcutsWiring({
  hidden,
  surfaceRef,
  devicePreviewEnabled,
  setRefreshKey,
  setConsoleOpen,
  setZoom,
  setDevicePresetId,
}: UseBrowserPreviewShortcutsWiringOptions): BrowserPreviewShortcutsWiring {
  const reload = useCallback(() => setRefreshKey((key) => key + 1), [setRefreshKey]);
  const toggleConsole = useCallback(() => setConsoleOpen((open) => !open), [setConsoleOpen]);
  const zoomIn = useCallback(() => setZoom((current) => stepBrowserZoom(current, 'in')), [setZoom]);
  const zoomOut = useCallback(
    () => setZoom((current) => stepBrowserZoom(current, 'out')),
    [setZoom],
  );
  const zoomReset = useCallback(() => setZoom(1), [setZoom]);
  const cycleDevicePreset = useCallback(
    () =>
      setDevicePresetId((current) => {
        const index = BROWSER_DEVICE_PRESETS.findIndex((preset) => preset.id === current);
        const next = BROWSER_DEVICE_PRESETS[(index + 1) % BROWSER_DEVICE_PRESETS.length];
        return next?.id ?? DEFAULT_DEVICE_PRESET_ID;
      }),
    [setDevicePresetId],
  );

  const shortcuts = useBrowserPreviewShortcuts({
    hidden,
    surfaceRef,
    reload,
    toggleConsole,
    ...(devicePreviewEnabled ? { zoomIn, zoomOut, zoomReset, cycleDevicePreset } : {}),
  });

  return { active: shortcuts.active, reload, toggleConsole };
}
