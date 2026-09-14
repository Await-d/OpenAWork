/**
 * 「用系统默认程序打开」的薄封装。
 *
 * 桌面端复用 Rust 侧已注册的 `open_artifact_path` 命令（内部走
 * `tauri-plugin-opener`，对应 capability 中的 `opener:allow-open-path`），
 * 由系统 shell 决定用哪个程序打开该路径。
 *
 * 纯 Web 环境没有这条链路：`canOpenPathInSystem()` 返回 false，调用方据此
 * 隐藏菜单项，而不是先渲染再报错。
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

/**
 * 解析可用的 Tauri invoke 通道。`__TAURI_INTERNALS__` 是 Tauri v2 在未开启
 * `withGlobalTauri` 时注入的内部通道，两个都探测以覆盖不同打包配置。
 */
function resolveInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const runtime = window as unknown as TauriBridge;
  return runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI_INTERNALS__?.invoke ?? null;
}

/**
 * 当前环境是否支持调用系统默认程序打开本地路径。
 *
 * 两条都必须成立：
 *
 * 1. **运行在 Tauri 桌面端且 IPC 通道就绪** —— 纯 Web / 移动端没有 shell 可用。
 * 2. **网关是本机模式（local）** —— 远程网关模式下文件在**远端主机**上，
 *    `open_artifact_path` 会把远端路径交给**本机** shell，必然失败。此时
 *    直接不展示菜单项，比渲染出来再弹一个「打开失败」更诚实。
 *
 * 网关模式取自 `desktop_gateway_mode`（登录页 / 设置页在桌面端写入，
 * 与真实 gatewayUrl 保持同步）；读不到时按 `local` 处理——桌面端默认就是本机模式。
 * 非桌面端不会写入该键，第 1 条也已经把它拦掉了。
 */
export function canOpenPathInSystem(): boolean {
  if (!isTauriRuntime() || resolveInvoke() === null) {
    return false;
  }
  return readDesktopGatewayMode() !== 'remote';
}

/**
 * 用系统默认程序打开 `path`。
 *
 * 调用前应先过 `canOpenPathInSystem()`：本函数只负责「通道能不能用」，
 * 不重复判断网关模式（远程模式下这里会走到系统侧再失败，返回带原因的错误）。
 *
 * @throws 当运行环境不支持该能力，或系统侧打开失败时抛出带中文说明的 Error，
 *   交由调用方提示用户（例如 toast）。
 */
export async function openPathInSystem(path: string): Promise<void> {
  const invoke = resolveInvoke();
  if (!invoke) {
    throw new Error('当前环境不支持用系统默认程序打开文件。');
  }

  const target = path.trim();
  if (target.length === 0) {
    throw new Error('文件路径为空，无法打开。');
  }

  try {
    await invoke<void>('open_artifact_path', { path: target });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`用系统默认程序打开失败：${reason}`);
  }
}
