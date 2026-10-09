/**
 * 灵动岛窗口的 Tauri 桥接层。
 *
 * 复用 `withGlobalTauri` 暴露的 `window.__TAURI__`(与
 * `utils/gateway/desktop-gateway.ts` 的探测方式一致),不直接依赖
 * `@tauri-apps/api` 的静态 import —— 保证本模块在浏览器环境被加载时也不会抛错。
 */

interface TauriEventEnvelope<T> {
  payload: T;
}

interface TauriGlobal {
  core?: {
    invoke?: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event?: {
    listen?: <T>(
      event: string,
      handler: (envelope: TauriEventEnvelope<T>) => void,
    ) => Promise<() => void>;
  };
}

interface TauriRuntime {
  __TAURI__?: TauriGlobal;
  __TAURI_INTERNALS__?: {
    invoke?: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

function readRuntime(): TauriRuntime {
  return window as unknown as TauriRuntime;
}

/** 当前是否具备 Tauri IPC 通道。 */
export function hasIslandBridge(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const runtime = readRuntime();
  return Boolean(runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI_INTERNALS__?.invoke);
}

/** 调用一个 Tauri 命令;非 Tauri 环境抛错,由调用方决定是否吞掉。 */
export async function islandInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const runtime = readRuntime();
  const invoke = runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI_INTERNALS__?.invoke;
  if (!invoke) {
    throw new Error('当前不在 Tauri 桌面环境中运行。');
  }
  return await invoke<T>(command, args);
}

/**
 * 订阅一个 Tauri 事件,返回取消订阅函数。
 *
 * 非 Tauri 环境(浏览器直开)返回空操作,让调用方逻辑无需分叉。
 */
export async function islandListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const runtime = readRuntime();
  const listen = runtime.__TAURI__?.event?.listen;
  if (!listen) {
    return () => undefined;
  }
  return await listen<T>(event, (envelope) => handler(envelope.payload));
}
