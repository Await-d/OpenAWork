/**
 * 网关 `/health` 探活客户端：返回 `true` 表示服务可达。
 *
 * 不要求鉴权——桌面端 sidecar 启动时 / 移动端 onboarding 也会调用，
 * 这些场景下 token 不一定就绪。
 */

const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;

export interface HealthClient {
  check(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<boolean>;
}

export function createHealthClient(baseUrl: string): HealthClient {
  return {
    async check(options) {
      try {
        const signal =
          options?.signal ?? AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
        const response = await fetch(`${baseUrl}/health`, { signal });
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
