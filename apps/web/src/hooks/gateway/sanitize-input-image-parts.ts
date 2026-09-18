import type { InputImageContent } from '@openAwork/shared';

/**
 * 网关对 `inputParts[].imageUrl` 的长度上限（单位：字符）。
 *
 * 与 `services/agent-gateway/src/routes/stream.ts` 中的
 * `imageUrl: z.string().trim().min(1).max(500_000).optional()` 保持一致。
 * 500_000 个字符约等于 366 KiB 原始图片——base64 会膨胀 4/3，还要再加上
 * `data:image/png;base64,` 前缀，因此稍大的截图就会超出该上限。
 */
export const MAX_GATEWAY_IMAGE_URL_CHARS = 500_000;

/**
 * 去掉发给网关的 input_image part 中超长的内联 imageUrl。
 *
 * 仅当该 part 还带有 artifactId / fileId 兜底时才移除：网关在持久化时会通过
 * `resolveInputImageContent()` 按 artifactId 在会话产物索引中把 Data URL 反查
 * 回来，所以对已上传的产物来说，内联 imageUrl 本就是冗余的。
 * 反之，若既没有 artifactId 也没有 fileId，移除 imageUrl 会触发网关
 * 「必须提供 artifactId、fileId 或 imageUrl」的另一类报错，因此保持原样。
 *
 * 本地渲染不受影响——调用方继续把保留 imageUrl 的 parts 用于本地消息。
 */
export function stripOversizedInlineImageUrls(
  parts: readonly InputImageContent[],
): InputImageContent[] {
  return parts.map((part) => {
    if (!part.imageUrl || part.imageUrl.length <= MAX_GATEWAY_IMAGE_URL_CHARS) {
      return part;
    }
    if (!part.artifactId && !part.fileId) {
      return part;
    }
    const { imageUrl: _imageUrl, ...rest } = part;
    return rest;
  });
}
