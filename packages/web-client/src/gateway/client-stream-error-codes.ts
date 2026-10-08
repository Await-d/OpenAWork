/**
 * 「客户端合成」的流错误码白名单。
 *
 * 网关下发的失败（`MODEL_ERROR` / `STREAM_ERROR` / `V2_UPSTREAM_ERROR` 等）
 * 由网关自己落库，刷新后仍在历史里；只有浏览器侧合成的错误 chunk
 * （EventSource / WebSocket 传输失败、载荷解析失败、attach 断连）没有对应的
 * 服务端记录，会话历史里查不到，刷新即消失。
 *
 * 因此只有命中这份名单的错误才需要上报落库——上报由调用方判断，
 * 本模块只负责「这个 code 是不是客户端自己造的」。
 *
 * 名单必须与合成点一一对应，新增合成错误码时必须同步登记，否则该错误会
 * 继续只活在本地 state 里（`client-stream-error-codes.test.ts` 守住这点）。
 */
export const CLIENT_SYNTHETIC_STREAM_ERROR_CODES = [
  /** `gateway-sse.ts` — EventSource.onerror：连接在收到响应前中断。 */
  'SSE_ERROR',
  /** `gateway-sse.ts` — SSE 载荷 JSON 解析失败。 */
  'SSE_INVALID_PAYLOAD',
  /** `gateway-ws.ts` — WebSocket.onerror。 */
  'WS_ERROR',
  /** `gateway-ws.ts` — 非终态、非主动的 onclose（服务端静默断开）。 */
  'WS_CLOSED',
  /** `gateway-ws.ts` — WS 载荷 JSON 解析失败。 */
  'WS_INVALID_PAYLOAD',
  /** `useGatewayClient.ts` — attach SSE 在传输过程中断开（无重连能力时）。 */
  'ATTACH_STREAM_DISCONNECTED',
  /** `useGatewayClient.ts` — attach SSE 载荷解析失败。 */
  'ATTACH_STREAM_INVALID_PAYLOAD',
] as const;

export type ClientSyntheticStreamErrorCode = (typeof CLIENT_SYNTHETIC_STREAM_ERROR_CODES)[number];

const CLIENT_SYNTHETIC_STREAM_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  CLIENT_SYNTHETIC_STREAM_ERROR_CODES,
);

export function isClientSyntheticStreamErrorCode(code: string): boolean {
  return CLIENT_SYNTHETIC_STREAM_ERROR_CODE_SET.has(code.trim());
}
