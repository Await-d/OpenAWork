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

/** 有界读取结果：`truncated` 表示响应体在 `maxBytes` 处被截断。 */
export interface LimitedTextRead {
  text: string;
  truncated: boolean;
}

/**
 * Read a `Response` body as UTF-8 text, keeping at most `maxBytes` and reporting
 * whether anything was dropped — **never throws** for an over-limit body.
 *
 * Sibling of `readResponseTextWithLimit`, for callers that surface the body to
 * the model as *diagnostics* rather than as content. There, rejecting the whole
 * response is strictly worse than a truncated prefix: a 771-byte Reuters 401
 * page produced `<响应正文读取失败：response body too large: content-length 771
 * exceeds limit 512 bytes>` — i.e. the tool threw away the only evidence of
 * *why* the request failed and the model retried the same URL fifteen times
 * (2026-10-18 线上排障). Truncation keeps the signal and still bounds memory.
 *
 * `maxBytes <= 0` disables the cap. A multi-byte character sliced by the ceiling
 * is dropped from the tail so the returned text stays valid UTF-8.
 */
export async function readResponseTextUpToLimit(
  response: Response,
  maxBytes: number,
): Promise<LimitedTextRead> {
  if (maxBytes <= 0) {
    return { text: await readResponseTextWithLimit(response, 0), truncated: false };
  }

  if (!response.body) {
    const bytes = new TextEncoder().encode(await response.text());
    if (bytes.byteLength <= maxBytes) {
      return { text: new TextDecoder('utf-8').decode(bytes), truncated: false };
    }
    return { text: decodeTruncated(bytes.subarray(0, maxBytes)), truncated: true };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        // 超限即停：保留到上限为止的前缀，并立即释放底层 socket。
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
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
  return truncated
    ? { text: decodeTruncated(merged), truncated: true }
    : { text: new TextDecoder('utf-8').decode(merged), truncated: false };
}

/** 非 fatal 解码后剥离被字节上限劈开的半个多字节字符（尾部 U+FFFD）。 */
function decodeTruncated(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/\uFFFD+$/u, '');
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
