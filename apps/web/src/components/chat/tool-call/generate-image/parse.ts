/**
 * Pure parsers for the `generate_image` tool's input + output. Kept free of
 * React so they can be unit-tested without rendering and re-used by future
 * server-side preview / artifact pickers.
 */

export interface GenerateImageResult {
  success: boolean;
  artifactId: string;
  title: string;
  fileName?: string;
  modelId: string;
  providerId: string;
  size: string;
  quality: string;
  outputFormat: string;
  revisedPrompt: string | null;
  summary: string;
}

/**
 * Parse the tool's stringified JSON output. Returns null when:
 *   - output isn't a string yet (still streaming),
 *   - it isn't valid JSON (older error format),
 *   - or it doesn't look like a successful image artifact response.
 *
 * Callers treat null as "no artifact ready" and fall back to the running /
 * error UI instead of crashing on a malformed payload.
 */
export function parseGenerateImageOutput(output: unknown): GenerateImageResult | null {
  if (typeof output !== 'string') return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (parsed.success === true && typeof parsed.artifactId === 'string') {
      return parsed as unknown as GenerateImageResult;
    }
  } catch {
    // not JSON — older format or error
  }
  return null;
}

/**
 * Parse a "WxH" size string (e.g. "1024x1024", "1536x1024") into an aspect
 * ratio suitable for CSS `aspect-ratio`. Falls back to 1 (square) when
 * unparseable — which is the natural default while the tool input is still
 * streaming and `size` hasn't been emitted yet.
 */
export function parseImageAspectRatio(rawSize: unknown): number {
  if (typeof rawSize !== 'string') return 1;
  const match = rawSize.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}
