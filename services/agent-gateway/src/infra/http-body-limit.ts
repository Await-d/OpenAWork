/**
 * Shared size-capped HTTP response-body reader.
 *
 * Several tools fetch arbitrary or registry-supplied URLs and then read the
 * whole response into memory (`response.text()` / `response.json()`). A
 * wall-clock timeout does NOT bound memory — a fast server can stream
 * gigabytes within the deadline (a big file, an infinite generator, a
 * decompressed zip bomb) and OOM the gateway. This reader enforces a hard byte
 * ceiling: it rejects up front on an over-limit `content-length`, otherwise
 * streams the body and aborts the moment the accumulated size crosses the cap
 * (cancelling the underlying socket). `maxBytes <= 0` disables the cap.
 *
 * First introduced for `webfetch` (§0.85); shared so every external-content
 * fetch path bounds memory the same way (§0.86 skill content / version checks).
 */

/**
 * Read a `Response` body as UTF-8 text without buffering more than `maxBytes`.
 * Throws an `Error` whose message starts with `response body too large` when
 * the limit is exceeded (by declared content-length or by streamed size).
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (maxBytes > 0) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `response body too large: content-length ${declared} exceeds limit ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (maxBytes > 0 && total > maxBytes) {
        throw new Error(`response body too large: exceeds limit ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    // Release the stream / underlying socket whether we finished or bailed.
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

/**
 * Read a `Response` body as JSON without buffering more than `maxBytes`. Reuses
 * `readResponseTextWithLimit` for the byte-ceiling enforcement, then parses.
 * Throws the same `response body too large` error when the limit is exceeded,
 * or a normal `SyntaxError` when the (bounded) body is not valid JSON.
 */
export async function readResponseJsonWithLimit<T = unknown>(
  response: Response,
  maxBytes: number,
): Promise<T> {
  const text = await readResponseTextWithLimit(response, maxBytes);
  return JSON.parse(text) as T;
}

/** Resolve a byte-ceiling env override; returns `fallback` when unset, 0 to disable. */
export function resolveHttpBodyLimitBytes(envVar: string, fallback: number): number {
  const raw = globalThis.process?.env?.[envVar];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}
