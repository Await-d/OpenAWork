/**
 * 工具调用图片源解析（纯函数，无 React / 无副作用）。
 *
 * 覆盖两类「查阅了图片」的工具调用：
 *   - `look_at`：图片只存在于**入参**（`input.image_data` / `input.file_path`），
 *     网关最终只把分析文本写回 output，图片本身不进 output；
 *   - `desktop_automation` / `desktop_control`：截图以 artifact 形式存在，
 *     output JSON 里带 `artifactId`（见网关 desktop-screenshot-artifact.ts）。
 *
 * 解析结果供 `useToolCallImagePreview` 决定后续的读取方式（内联 data URL /
 * 远端 URL / 工作区文件 / 产物中心）。
 */

import { getFilePreviewKind } from '../../../../utils/file/file-preview.js';

export type ToolCallImageSource =
  | { kind: 'inline'; src: string; alt: string }
  | { kind: 'remote'; src: string; alt: string }
  | { kind: 'workspace'; path: string; alt: string }
  | { kind: 'artifact'; artifactId: string; alt: string };

/** data URL：仅接受图片 MIME，避免把 PDF / 文本的 data URL 误判成图片。 */
const INLINE_DATA_URL_PATTERN = /^data:image\//i;
/** 远端图片：look_at 只放行公网 http(s) 地址。 */
const REMOTE_URL_PATTERN = /^https?:\/\//i;
/** 裸 base64 字符集（允许换行 / 空格等空白，判定前先剔除）。 */
const BARE_BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
/**
 * 裸 base64 的最小长度：过短的字符串更可能是普通文本（例如文件名或提示词），
 * 只有当它长到不可能被误读时才当作图片数据。
 */
const BARE_BASE64_MIN_LENGTH = 128;

const LOOK_AT_ALT = '已查看的图片';
const DESKTOP_SCREENSHOT_ALT = '桌面截图';

/**
 * 把 `look_at` 入参解析为图片源。
 *
 * 优先级：data URL → http(s) URL → 裸 base64 → 图片类工作区文件。
 * 前三者都落在 `image_data`（与网关入参 schema 一致，二者互斥）；
 * `image_data` 无法识别时继续看 `file_path`，例如模型传了提示文本而非图片数据。
 */
function resolveLookAtSource(input: Record<string, unknown>): ToolCallImageSource | null {
  const imageData = input['image_data'];
  if (typeof imageData === 'string') {
    const trimmed = imageData.trim();
    if (INLINE_DATA_URL_PATTERN.test(trimmed)) {
      return { kind: 'inline', src: trimmed, alt: LOOK_AT_ALT };
    }
    if (REMOTE_URL_PATTERN.test(trimmed)) {
      return { kind: 'remote', src: trimmed, alt: LOOK_AT_ALT };
    }
    const compact = trimmed.replace(/\s+/g, '');
    if (compact.length > BARE_BASE64_MIN_LENGTH && BARE_BASE64_PATTERN.test(compact)) {
      // 网关侧对裸 base64 按 PNG 兜底解码，预览沿用同一假设。
      return { kind: 'inline', src: `data:image/png;base64,${compact}`, alt: LOOK_AT_ALT };
    }
  }

  const filePath = input['file_path'];
  if (typeof filePath === 'string') {
    const trimmedPath = filePath.trim();
    // 只认图片扩展名：对文本 / PDF 调 look_at 不产生图片预览。
    if (trimmedPath.length > 0 && getFilePreviewKind(trimmedPath) === 'image') {
      return { kind: 'workspace', path: trimmedPath, alt: LOOK_AT_ALT };
    }
  }

  return null;
}

/**
 * 把 output 归一化成对象形式。
 *
 * 正常情况下网关输出是 JSON 字符串（`JSON.stringify({...})`），但历史会话 /
 * 内存态可能是已解析对象。解析失败时返回 null 而不是抛错：这里只是「能否多给
 * 一个缩略图」的增强展示，原始 output 仍由 ToolOutputPreview 完整渲染，因此
 * 解析失败不影响任何既有信息展示，可以安全忽略。
 */
function normalizeOutputRecord(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output !== 'string') {
    return null;
  }
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // 非 JSON 的 output（纯文本 / 报错信息）没有 artifactId 可取，忽略即可。
    return null;
  }
}

/** 桌面截图类工具：从 output 里取 artifactId + image/* 的 mimeType。 */
function resolveDesktopScreenshotSource(output: unknown): ToolCallImageSource | null {
  const record = normalizeOutputRecord(output);
  if (!record) return null;

  const artifactId = record['artifactId'];
  if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
    return null;
  }

  const mimeType = record['mimeType'];
  if (mimeType !== undefined) {
    // mimeType 存在时必须明确是图片；缺失时按历史数据兜底（仅产生产物请求）。
    if (typeof mimeType !== 'string' || !mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
  }

  return { kind: 'artifact', artifactId, alt: DESKTOP_SCREENSHOT_ALT };
}

export function resolveToolCallImageSource(
  toolName: string,
  input: Record<string, unknown>,
  output?: unknown,
): ToolCallImageSource | null {
  const normalized = toolName.trim().toLowerCase();

  if (normalized === 'look_at') {
    return resolveLookAtSource(input);
  }

  if (normalized === 'desktop_automation' || normalized === 'desktop_control') {
    return resolveDesktopScreenshotSource(output);
  }

  // 其它工具（generate_image / convert_media / read 等）已有专属卡片或并非
  // 图片检视语义，一律不重复渲染预览。
  return null;
}
