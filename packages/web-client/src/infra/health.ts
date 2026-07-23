/**
 * 网关 `/health` 探活客户端：返回 `true` 表示服务可达。
 *
 * 不要求鉴权——桌面端 sidecar 启动时 / 移动端 onboarding 也会调用，
 * 这些场景下 token 不一定就绪。
 *
 * 超时走 {@link fetchWithTimeout}（AbortController + setTimeout），
 * **禁止** `AbortSignal.timeout`：React Native 的 AbortSignal polyfill
 * （`abort-controller@3`）没有 `.timeout`，一调用就 TypeError，
 * 会被 catch 吞掉后恒返回 false，手机端表现为“无法连接到网关”。
 */

import { fetchWithTimeout } from '../gateway/http.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;

export interface HealthClient {
  check(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<boolean>;
}

export function createHealthClient(baseUrl: string): HealthClient {
  return {
    async check(options) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/health`, {
          signal: options?.signal,
          timeoutMs: options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export async function isGatewayHealthy(
  baseUrl: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
  return createHealthClient(baseUrl).check(options);
}
