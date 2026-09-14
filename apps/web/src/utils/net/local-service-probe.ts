/**
 * 本地 / 局域网服务可达性探针。
 *
 * 内置浏览器需要判断「dev server 是否已经开始监听端口」：agent 刚敲下
 * `npm run dev` 时端口还没起来，此时加载必然是错误页。判断方式只能是
 * 直接连一次目标端口——目标不是网关，而是用户本机或局域网上的任意端口，
 * 且用 `no-cors` 只关心「连接能否建立」，不解析响应（跨域 dev server
 * 本来也不允许读取响应）。
 *
 * 为什么单独放在 utils 层：`apps/web/src/architecture/no-direct-gateway-fetch.test.ts`
 * 禁止 components/pages 直接出现 `fetch(`，其意图是「访问网关必须走
 * web-client，别绕过鉴权/超时/错误归一」。本模块不访问网关，把它留在 UI
 * 层只会让那条规则被迫放宽；下沉到这里既守住规则，也表明这不是网关调用。
 */

export interface ProbeLocalServiceOptions {
  timeoutMs?: number;
  /** 调用方用于取消（组件卸载 / URL 变更）的信号。 */
  signal?: AbortSignal;
}

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

/**
 * 探测目标端口是否有服务在监听。
 *
 * @returns 连接建立（含 404 / 401 等任何 HTTP 响应）→ true；连接被拒 /
 *          超时 / DNS 失败 → false。
 */
export async function probeLocalServiceReachable(
  url: string,
  options: ProbeLocalServiceOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const callerSignal = options.signal;
  const onAbort = (): void => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onAbort);
    }
  }
}
