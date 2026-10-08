/**
 * 客户端侧流错误的上报客户端。
 *
 * 这类错误（`SSE_ERROR` / `WS_CLOSED` / `*_INVALID_PAYLOAD` …）由浏览器合成，
 * 网关侧不存在对应记录，所以刷新页面后错误气泡消失。本客户端把它们**尽力**
 * 上报给网关，由网关幂等落成 `assistant` + `status='error'` 消息。
 *
 * 两条刻意的设计：
 *   - **永不抛错**：传输层已经失败过一次，再抛一次只会把错误页顶到用户面前。
 *     失败时返回 `{ ok: false, errorMessage }`，由调用方决定是否记日志。
 *   - **短超时**：网关可能正是故障本身（`SSE_ERROR` 时它多半还没起来），
 *     上报不能拖住 UI，默认 5s 足够。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  fetchWithTimeout,
  readJsonErrorData,
} from '../gateway/http.js';
import type { JsonErrorData } from '../gateway/http.js';

/** 上报是「顺带」行为：网关可能就是故障本身，不能让它把 UI 拖住。 */
export const CLIENT_ERROR_REPORT_TIMEOUT_MS = 5_000;

export type ClientStreamErrorReportOutcome =
  'persisted' | 'deduplicated' | 'skipped_existing' | 'failed';

export interface ClientStreamErrorReportResult {
  /** 服务端是否受理（`deduplicated` / `skipped_existing` 也算受理，都不重复写库）。 */
  ok: boolean;
  outcome: ClientStreamErrorReportOutcome;
  messageId?: string;
  /** 仅 `ok: false` 时给出，供日志定位。 */
  errorMessage?: string;
}

export interface ReportClientStreamErrorInput {
  clientRequestId: string;
  code: string;
  message?: string;
  technicalDetail?: string;
  sessionId: string;
}

export interface ClientErrorReporter {
  reportClientStreamError(
    token: string,
    input: ReportClientStreamErrorInput,
  ): Promise<ClientStreamErrorReportResult>;
}

function buildFailure(errorMessage: string): ClientStreamErrorReportResult {
  return { ok: false, outcome: 'failed', errorMessage };
}

function normalizeReportError(status: number, data: JsonErrorData | undefined): string {
  return extractJsonErrorMessage(data) ?? `上报失败（HTTP ${status}）。`;
}

export function createClientErrorReporter(gatewayUrl: string): ClientErrorReporter {
  return {
    async reportClientStreamError(token, input) {
      // 缺少 clientRequestId 就没有幂等键：宁可不上报，也不能写一条可能被
      // 后续重放当成独立轮次的重复错误。
      if (input.clientRequestId.trim().length === 0) {
        return buildFailure('缺少 clientRequestId，无法幂等上报。');
      }

      try {
        const response = await fetchWithTimeout(
          `${gatewayUrl}/sessions/${input.sessionId}/client-errors`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({
              clientRequestId: input.clientRequestId,
              code: input.code,
              message: input.message ?? input.code,
              ...(input.technicalDetail ? { technicalDetail: input.technicalDetail } : {}),
            }),
            timeoutMs: CLIENT_ERROR_REPORT_TIMEOUT_MS,
          },
        );

        if (!response.ok) {
          const data = await readJsonErrorData<JsonErrorData>(response);
          return buildFailure(normalizeReportError(response.status, data));
        }

        const payload = (await response.json().catch(() => null)) as {
          messageId?: string | null;
          outcome?: ClientStreamErrorReportOutcome;
        } | null;
        const outcome = payload?.outcome;
        return {
          ok: true,
          outcome:
            outcome === 'persisted' || outcome === 'deduplicated' || outcome === 'skipped_existing'
              ? outcome
              : 'persisted',
          ...(payload?.messageId ? { messageId: payload.messageId } : {}),
        };
      } catch (error) {
        // 网关不可达恰恰是 SSE_ERROR 的常态：上报注定失败，静默返回即可，
        // 错误已经展示在气泡里，不需要再打扰用户。
        return buildFailure(error instanceof Error ? error.message : '上报请求失败。');
      }
    },
  };
}
