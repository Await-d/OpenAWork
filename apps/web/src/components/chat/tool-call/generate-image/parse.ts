/**
 * Pure parsers for the `generate_image` tool's input + output. Kept free of
 * React so they can be unit-tested without rendering and re-used by future
 * server-side preview / artifact pickers.
 */

export interface GenerateImageResult {
  success: boolean;
  /** 首张产物——单张语义，历史输出里只有这一个字段。 */
  artifactId: string;
  /** 多张产出（`n>1`）时的全量产物 id，含首张；旧输出缺省。 */
  artifactIds?: string[];
  /** 实际产出的张数；旧输出缺省。 */
  count?: number;
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
 * 解析该工具调用实际产出的**全部**产物 id（顺序即生成顺序）。
 *
 * 单张与多张共用一条读取路径：优先取 `artifactIds`（`n>1` 时网关会下发全量，
 * 含首张），缺省时退回单张 `artifactId`。返回空数组表示「还没有可用产物」，
 * 调用方据此走 running / error 分支，不必区分 null 与 []。
 *
 * 去重是必要的：历史输出里 `artifactIds` 与 `artifactId` 都可能存在，
 * 若二者被拼接，首张会在图集里出现两次。
 */
export function resolveGenerateImageArtifactIds(result: GenerateImageResult | null): string[] {
  if (!result) return [];

  const raw = Array.isArray(result.artifactIds) ? result.artifactIds : [];
  const ids: string[] = [];
  for (const candidate of [...raw, result.artifactId]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || ids.includes(trimmed)) continue;
    ids.push(trimmed);
  }
  return ids;
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
