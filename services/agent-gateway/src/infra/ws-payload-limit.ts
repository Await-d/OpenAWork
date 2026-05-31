/**
 * WebSocket inbound-frame size ceiling resolver.
 *
 * `@fastify/websocket` runs `ws`'s `WebSocket.Server` in noServer mode and,
 * when registered without options, inherits ws's default `maxPayload` of
 * **100 MiB**. Every gateway WS handler (`/sessions/:id/stream`,
 * `/team/events`, `/lsp/events`) buffers a whole inbound frame and then does
 * `raw.toString()` + `JSON.parse(...)`. HTTP request bodies are bounded by
 * Fastify's ~1 MiB default, but the WS path had no equivalent ceiling — an
 * authenticated client could push 100 MiB frames straight into those parsers
 * and amplify gateway memory pressure.
 *
 * The largest *legitimate* frame is a `/stream` message carrying `inputParts`
 * images (each `imageUrl` ≤ 500_000 chars) plus a ≤ 32768-char message, so a
 * few MiB is normal. The default below leaves generous headroom for multi-image
 * prompts while cutting the abuse ceiling by ~6x. ws rejects an over-limit frame
 * by closing the socket with code 1009 (receiver enforces it only when
 * `maxPayload > 0`).
 *
 * Override via `OPENAWORK_WS_MAX_PAYLOAD_BYTES`; `<= 0` / NaN restores ws's
 * uncapped default (disables the ceiling), matching the shared
 * `resolveHttpBodyLimitBytes` env-switch semantics (§0.85 family).
 */
import { resolveHttpBodyLimitBytes } from './http-body-limit.js';

/** Default inbound WS frame ceiling: 16 MiB. */
export const DEFAULT_WS_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

/**
 * Resolve the inbound WS frame byte ceiling. Returns the default when unset,
 * a positive override when configured, or `0` (ws-uncapped / disabled) when the
 * override is non-positive or non-finite.
 */
export function resolveWsMaxPayloadBytes(): number {
  return resolveHttpBodyLimitBytes('OPENAWORK_WS_MAX_PAYLOAD_BYTES', DEFAULT_WS_MAX_PAYLOAD_BYTES);
}
