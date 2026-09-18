/**
 * 内置浏览器预览的键盘快捷键（刷新 / 控制台 / 缩放 / 设备预设）。
 *
 * 复用既有快捷键设施的模式与约定，不另起一套：
 * - 注册 / 清理沿用 `useTitlebarKeyboardShortcuts` 的 window `keydown` 写法，
 *   `Cmd` 与 `Ctrl` 统一归一为「mod」；
 * - 输入目标豁免沿用 `useChatKeyboardShortcuts` 的 `input` / `textarea` /
 *   `contenteditable` 判断。
 *
 * 预览快捷键会遮蔽浏览器 / 系统原生行为（`Ctrl+R`、`Ctrl+=`、DevTools 组合等），
 * 因此比全局快捷键多三道硬闸门：
 * 1. **可见性**：`hidden` 为真时完全不注册监听（`BuiltInBrowser` 是常驻挂载的，
 *    仅靠卸载清理不足以保证「不可见即惰性」）。
 * 2. **焦点作用域**：焦点必须落在预览交互区容器内（iframe / CDP 画面所在元素）。
 *    焦点在地址栏、聊天输入框或页面其他位置时一律放行，原生快捷键不受影响。
 * 3. **输入豁免**：`input` / `textarea` / `contenteditable` 中的按键不触发。
 *
 * 修饰键组合**精确匹配**：`Ctrl/⌘+Shift+R` 不会被当作 `Ctrl/⌘+R`，带 `Alt` 的
 * 组合一概不认领。命中后在捕获阶段 `preventDefault` + `stopImmediatePropagation`，
 * 既阻止浏览器原生动作，也避免 CDP 引擎把同一次按键再注入远端页面。
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

export type BrowserPreviewShortcutId =
  'reload' | 'toggleConsole' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'cycleDevicePreset';

export interface BrowserPreviewShortcutBinding {
  /** `KeyboardEvent.key` 归一化后的小写值。 */
  readonly key: string;
  /** `Shift` 必须与该值完全一致（精确匹配，不做宽容合并）。 */
  readonly shift: boolean;
}

export interface BrowserPreviewShortcutDescriptor {
  readonly id: BrowserPreviewShortcutId;
  /** 中文动作名：快捷键提示列表与无障碍描述共用。 */
  readonly label: string;
  /** 跨平台组合键展示文本。 */
  readonly combination: string;
  /** 精确按键集合；同一动作可登记多个等价组合（如 `=` 与 `+`）。 */
  readonly bindings: readonly BrowserPreviewShortcutBinding[];
}

/**
 * 快捷键的**单一事实来源**：匹配逻辑与 UI 提示列表都从这里派生，禁止各写一份，
 * 否则工具栏提示与真实生效的组合键会漂移。
 */
export const BROWSER_PREVIEW_SHORTCUTS: readonly BrowserPreviewShortcutDescriptor[] = [
  {
    id: 'reload',
    label: '刷新预览',
    combination: 'Ctrl/⌘+R',
    bindings: [{ key: 'r', shift: false }],
  },
  {
    id: 'toggleConsole',
    label: '开关控制台',
    combination: 'Ctrl/⌘+Shift+J',
    bindings: [{ key: 'j', shift: true }],
  },
  {
    id: 'zoomIn',
    label: '放大',
    combination: 'Ctrl/⌘+=',
    // 多数键盘布局下 Ctrl+Shift+= 产出的 key 是 '+'，与 '=' 等价接受。
    bindings: [
      { key: '=', shift: false },
      { key: '+', shift: true },
    ],
  },
  {
    id: 'zoomOut',
    label: '缩小',
    combination: 'Ctrl/⌘+-',
    bindings: [{ key: '-', shift: false }],
  },
  {
    id: 'zoomReset',
    label: '重置缩放',
    combination: 'Ctrl/⌘+0',
    bindings: [{ key: '0', shift: false }],
  },
  {
    id: 'cycleDevicePreset',
    label: '循环切换设备预设',
    combination: 'Ctrl/⌘+Shift+D',
    bindings: [{ key: 'd', shift: true }],
  },
];

/**
 * 把组合键拼进控件 `title`：`刷新 (Ctrl/⌘+R)`。
 *
 * 文案与组合键都从描述符取，禁止在控件上另写一份字面量——否则工具栏提示与真实
 * 生效的组合键会漂移。
 */
export function browserPreviewShortcutTitle(base: string, id: BrowserPreviewShortcutId): string {
  const descriptor = BROWSER_PREVIEW_SHORTCUTS.find((shortcut) => shortcut.id === id);
  return descriptor === undefined ? base : `${base} (${descriptor.combination})`;
}

/** 参与匹配的最小事件形状（真实 `KeyboardEvent` 结构兼容，便于纯函数测试）。 */
export interface BrowserPreviewShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * 纯匹配：命中返回动作 id，否则返回 null。
 *
 * - `Cmd` / `Ctrl` 归一为「mod」；
 * - 任何带 `Alt` 的组合都不认领（给系统与其他应用快捷键让路）；
 * - 未登记的按键，或 `Shift` 状态与登记不一致时返回 null —— 精确匹配。
 */
export function matchBrowserPreviewShortcut(
  event: BrowserPreviewShortcutKeyEvent,
): BrowserPreviewShortcutId | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  const matched = BROWSER_PREVIEW_SHORTCUTS.find((shortcut) =>
    shortcut.bindings.some((binding) => binding.key === key && binding.shift === event.shiftKey),
  );
  return matched?.id ?? null;
}

/** 按键目标是否正在输入：`input` / `textarea` / `select` / `contenteditable`。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) return true;
  const editable = target.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

/**
 * 焦点是否落在预览交互区内。
 *
 * iframe 内文档持焦时，父文档的 `activeElement` 就是 `<iframe>` 元素本身，
 * 因此同一个 `contains` 判断同时覆盖 iframe 与 CDP 画面两种引擎。
 */
export function isPreviewSurfaceFocused(surface: HTMLElement | null): boolean {
  if (surface === null) return false;
  const activeElement = typeof document === 'undefined' ? null : document.activeElement;
  return activeElement !== null && surface.contains(activeElement);
}

/**
 * 各动作回调。缩放 / 设备预设属设备动作：T-17 的 `device-presets.ts` 落地前可缺省，
 * 缺省时对应组合键**不注册**（既不提示也不拦截原生行为），避免出现「按下无效果」
 * 的空承诺，也避免在此另建一份平行 zoom / preset 状态。
 */
export interface BrowserPreviewShortcutActions {
  reload: () => void;
  toggleConsole: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  zoomReset?: () => void;
  cycleDevicePreset?: () => void;
}

export interface UseBrowserPreviewShortcutsOptions extends BrowserPreviewShortcutActions {
  /** 预览是否可见（`BuiltInBrowser.hidden`）；不可见时完全不注册监听。 */
  hidden: boolean;
  /** 预览交互区容器（iframe / CDP 画面所在元素）。 */
  surfaceRef: RefObject<HTMLElement | null>;
}

export interface BrowserPreviewShortcuts {
  /**
   * 当前**已接线**的快捷键，顺序与 `BROWSER_PREVIEW_SHORTCUTS` 一致。
   * UI 提示只渲染它，保证「提示了什么就真的能用什么」。
   */
  active: readonly BrowserPreviewShortcutDescriptor[];
}

export function useBrowserPreviewShortcuts(
  options: UseBrowserPreviewShortcutsOptions,
): BrowserPreviewShortcuts {
  const {
    hidden,
    surfaceRef,
    reload,
    toggleConsole,
    zoomIn,
    zoomOut,
    zoomReset,
    cycleDevicePreset,
  } = options;

  const resolveAction = (id: BrowserPreviewShortcutId): (() => void) | undefined => {
    switch (id) {
      case 'reload':
        return reload;
      case 'toggleConsole':
        return toggleConsole;
      case 'zoomIn':
        return zoomIn;
      case 'zoomOut':
        return zoomOut;
      case 'zoomReset':
        return zoomReset;
      case 'cycleDevicePreset':
        return cycleDevicePreset;
      default:
        return undefined;
    }
  };

  useEffect(() => {
    if (hidden) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      // 长按重复只保留首次：刷新 / 切换类动作不应被连发。
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const shortcutId = matchBrowserPreviewShortcut(event);
      if (shortcutId === null) return;
      if (!isPreviewSurfaceFocused(surfaceRef.current)) return;
      const action = resolveAction(shortcutId);
      if (action === undefined) return;

      // 捕获阶段先于 React 根节点与 CDP 引擎的键盘注入逻辑，两个都拦下。
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [hidden, surfaceRef, reload, toggleConsole, zoomIn, zoomOut, zoomReset, cycleDevicePreset]);

  const active = BROWSER_PREVIEW_SHORTCUTS.filter(
    (shortcut) => resolveAction(shortcut.id) !== undefined,
  );

  return { active };
}
