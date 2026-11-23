/**
 * 原生目录选择（桌面端）的薄封装。
 *
 * 走 Tauri v2 dialog 插件注册的 IPC 命令 `plugin:dialog|open`（`dialog:default`
 * 已在 capability 中授权，Rust 侧 `tauri_plugin_dialog::init()` 已注册）。这里不引
 * `@tauri-apps/plugin-dialog`，而是复用 `open-in-system.ts` 同款 invoke 桥——避免给
 * `apps/web` 增加一个只在桌面端生效的依赖。
 *
 * 纯 Web / 移动端没有这条链路：`canPickDirectory()` 返回 false，调用方据此隐藏按钮，
 * 而不是先渲染再报错。
 */
import { isTauriRuntime, readDesktopGatewayMode } from '../gateway/desktop-gateway.js';

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriBridge {
  __TAURI__?: {
    readonly core?: {
      readonly invoke?: TauriInvoke;
    };
  };
  __TAURI_INTERNALS__?: {
    readonly invoke?: TauriInvoke;
  };
}

function resolveInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const runtime = window as unknown as TauriBridge;
  return runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI_INTERNALS__?.invoke ?? null;
}

export interface DirectoryPickerAvailability {
  /** 能否真的弹出系统目录选择器。 */
  readonly available: boolean;
  /** 是否渲染入口按钮。 */
  readonly renderEntry: boolean;
  /**
   * 不可用时给用户看的解释；`null` 表示无需解释（例如纯 Web 端不渲染入口）。
   *
   * 桌面端渲染禁用按钮而不只是「消失」，否则用户会以为功能丢了——尤其远程网关
   * 模式下功能是「有但不适用」。
   */
  readonly unavailableReason: string | null;
}

/**
 * 目录选择器可用性（含不可用原因）。
 *
 * 三条判据（前两条与 `canOpenPathInSystem` 同一套）：
 *
 * 1. **运行在 Tauri 桌面端** —— 纯 Web / 移动端没有原生对话框，连入口都不渲染；
 * 2. **IPC 通道就绪** —— 桌面端但通道缺失（打包配置异常）时渲染禁用按钮并说明；
 * 3. **网关是本机模式（local）** —— 渠道 ACL 的路径前缀在**网关进程所在主机**上
 *    参与匹配；远程网关模式下系统选择器选的是**本机**路径，对远端网关没有意义，
 *    此时按钮置灰并提示改用手输网关主机上的绝对路径。
 */
export function resolveDirectoryPickerAvailability(): DirectoryPickerAvailability {
  if (!isTauriRuntime()) {
    return { available: false, renderEntry: false, unavailableReason: null };
  }
  if (resolveInvoke() === null) {
    return {
      available: false,
      renderEntry: true,
      unavailableReason: '桌面端对话框通道未就绪，重开应用后再试；也可直接手输绝对路径。',
    };
  }
  if (readDesktopGatewayMode() === 'remote') {
    return {
      available: false,
      renderEntry: true,
      unavailableReason:
        '当前连接的是远程网关：渠道路径前缀在网关主机上匹配，系统选择器选出的本机路径对它无效，请手输网关主机上的绝对路径。',
    };
  }
  return { available: true, renderEntry: true, unavailableReason: null };
}

/** 当前环境是否支持弹出系统目录选择器（`resolveDirectoryPickerAvailability().available` 的简写）。 */
export function canPickDirectory(): boolean {
  return resolveDirectoryPickerAvailability().available;
}

/**
 * 弹出系统目录选择器，返回选中的绝对路径；用户取消时返回 `null`。
 *
 * 函数内部重新检查可用性，不依赖 UI 的禁用状态。返回值保持原样（不 trim、不做平台归一），
 * 交由调用方用 `validateReadablePathPrefix` 校验与归一。
 *
 * @throws 当运行环境不支持该能力，或系统侧对话框调用失败时抛出带中文说明的 Error。
 */
export async function pickDirectory(): Promise<string | null> {
  const availability = resolveDirectoryPickerAvailability();
  if (!availability.available) {
    throw new Error(availability.unavailableReason ?? '当前环境不支持系统目录选择器。');
  }
  const invoke = resolveInvoke();
  if (!invoke) {
    throw new Error('当前环境不支持系统目录选择器。');
  }

  try {
    const selected = await invoke<unknown>('plugin:dialog|open', {
      options: { directory: true, multiple: false, title: '选择目录' },
    });
    if (typeof selected === 'string' && selected.trim().length > 0) {
      return selected;
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`打开系统目录选择器失败：${reason}`, { cause: error });
  }
}
