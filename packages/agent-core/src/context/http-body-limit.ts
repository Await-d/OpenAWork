/**
 * Size-capped response-body reader for `ContextManager.addUrl`.
 *
 * `addUrl` fetches an arbitrary, user-supplied URL and keeps only the first
 * 5000 characters as context. The previous implementation did
 * `await response.text()` then `.slice(0, 5000)`, buffering the ENTIRE body
 * into memory before discarding almost all of it. A wall-clock timeout (the
 * existing `AbortSignal.timeout`) does NOT bound memory: a fast server can
 * stream gigabytes within the deadline (a huge page, an infinite generator,
 * a decompressed payload) and OOM the host before the slice ever runs — the
 * same OOM class addressed for `webfetch` (gateway §0.85) and the skill
 * registry (§0.87).
 *
 * Because only a small prefix is retained, this reader *truncates* rather than
 * rejecting: it streams until the byte ceiling is reached, then cancels the
 * underlying socket and decodes what it has. That keeps large but legitimate
 * pages working while bounding memory to ~`maxBytes`. The default ceiling is
 * generous relative to the 5000-char slice but still finite.
 */

/** Default ceiling on bytes buffered while reading URL context (1 MiB). */
export const DEFAULT_ADD_URL_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Env var to override the URL-context body ceiling; `<= 0` disables the cap. */
export const ADD_URL_MAX_RESPONSE_BYTES_ENV = 'OPENAWORK_ADD_URL_MAX_RESPONSE_BYTES';

/** Resolve the byte ceiling from env; falls back to the default, `<= 0` disables. */
export function resolveAddUrlMaxResponseBytes(): number {
  const raw = globalThis.process?.env?.[ADD_URL_MAX_RESPONSE_BYTES_ENV];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_ADD_URL_MAX_RESPONSE_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Read a `Response` body as UTF-8 text, buffering at most ~`maxBytes`.
 *
 * Streams the body and stops once the accumulated size crosses `maxBytes`,
 * cancelling the underlying stream/socket and returning the bytes read so far
 * (decoded as UTF-8). `maxBytes <= 0` disables the cap and reads the whole
 * body. Callers that only keep a prefix (e.g. `addUrl`) get bounded memory
 * without an error on large inputs.
 */
export async function readResponseTextTruncated(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (maxBytes <= 0 || !response.body) {
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
      const remaining = maxBytes - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
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
