/**
 * Shared network helpers for the skill-registry package: a timeout-bounded
 * `fetch` and a size-capped response-body reader.
 *
 * Skill manifests / registry listings are fetched from arbitrary remote
 * registry / CDN / user-supplied URLs and were read with `response.text()` /
 * `response.json()`, which buffer the WHOLE body. A wall-clock timeout does
 * NOT bound memory — a fast server can stream gigabytes within the deadline
 * (a huge file, an infinite generator, a decompressed zip bomb) — so an
 * oversized or hostile response would OOM the host process. These helpers
 * enforce both a request deadline and a hard byte ceiling on the body.
 *
 * Package-local mirror of the gateway's `infra/http-body-limit.ts` (§0.85 /
 * §0.86): this package has no dependency on the gateway, so the bounded reader
 * is duplicated here rather than imported, keeping the same invariant.
 */

/** Default request deadline for registry network calls. */
export const DEFAULT_REGISTRY_FETCH_TIMEOUT_MS = 8000;

/**
 * Default ceiling on a buffered response body. Skill manifests / listing JSON
 * are small (KBs); 8MiB is generous headroom while still bounding memory.
 */
export const DEFAULT_REGISTRY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * `fetch` with an AbortController-backed wall-clock deadline. The timer is
 * always cleared so it can't keep the event loop alive. A caller-supplied
 * `init.signal` still applies (the underlying fetch honours whichever aborts
 * first once merged by the platform); we add our own deadline on top.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REGISTRY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read a `Response` body as UTF-8 text without buffering more than `maxBytes`.
 * Rejects up front on an over-limit `content-length`, otherwise streams the
 * body and aborts the moment the accumulated size crosses the cap (cancelling
 * the underlying socket). `maxBytes <= 0` disables the cap.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_REGISTRY_MAX_RESPONSE_BYTES,
): Promise<string> {
  if (maxBytes > 0) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `registry response too large: content-length ${declared} exceeds limit ${maxBytes} bytes`,
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
        throw new Error(`registry response too large: exceeds limit ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
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

/** Read + JSON-parse a `Response` body under the same byte ceiling. */
export async function readResponseJsonWithLimit<T>(
  response: Response,
  maxBytes: number = DEFAULT_REGISTRY_MAX_RESPONSE_BYTES,
): Promise<T> {
  const text = await readResponseTextWithLimit(response, maxBytes);
  return JSON.parse(text) as T;
}

/** Default ceiling on a downloaded archive (e.g. a GitHub repo zipball). */
export const DEFAULT_REGISTRY_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

/**
 * Read a `Response` body as a byte array without buffering more than
 * `maxBytes`. Used for binary downloads (zipballs) where a hostile or
 * accidental huge archive — or a zip bomb's compressed payload — would
 * otherwise be fully buffered before decompression and OOM the host. Rejects
 * up front on an over-limit `content-length`, otherwise streams and aborts the
 * moment the cap is crossed. `maxBytes <= 0` disables the cap.
 */
export async function readResponseArrayBufferWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_REGISTRY_MAX_ARCHIVE_BYTES,
): Promise<Uint8Array> {
  if (maxBytes > 0) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `registry archive too large: content-length ${declared} exceeds limit ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
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
        throw new Error(`registry archive too large: exceeds limit ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
