import type { InputImageContent } from '@openAwork/shared';
import { uploadChatAttachments } from '../../../components/conversation-runtime/attachments/attachment-upload.js';
import { MAX_GATEWAY_IMAGE_URL_CHARS } from '../../../hooks/gateway/sanitize-input-image-parts.js';

interface DecodedInlineImageDataUrl {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType?: string;
}

function decodeBase64DataUrl(dataUrl: string): DecodedInlineImageDataUrl | null {
  if (!dataUrl.startsWith('data:')) {
    return null;
  }
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return null;
  }
  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  if (payload.length === 0 || !metadata.split(';').includes('base64')) {
    return null;
  }

  try {
    const binary = atob(payload);
    const [mimeTypePart] = metadata.split(';');
    const mimeType = mimeTypePart?.trim();
    return {
      bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
      ...(mimeType ? { mimeType } : {}),
    };
  } catch {
    // atob 对非法 base64 会抛错——按“不可解码”处理，保留原始 part。
    return null;
  }
}

/**
 * 把超长内联 imageUrl 的图片重新上传到目标会话，返回可直接发给网关的 parts。
 *
 * 分支 / 编辑重发场景下，parts 来自旧消息的 Data URL，其中的 artifactId 属于
 * 旧会话的产物索引；而新建的分支会话并不拥有这些产物，网关的
 * `resolveInputImageContent()` 按 sessionId 查不到对应 artifact，artifactId
 * 就无法还原成 Data URL；同时超长 imageUrl 又会被客户端剥离
 * （见 stripOversizedInlineImageUrls），图片便会从模型上下文中静默消失。
 * 因此这里把图片重新上传到目标会话，拿到归属该会话的新 artifactId，
 * 让网关可以正常反查并注入。
 *
 * 逐个串行上传：保持顺序确定，也避免一次性把多张大图压给网关。
 */
export async function reuploadOversizedInlineImages(options: {
  gatewayUrl: string;
  inputParts: readonly InputImageContent[];
  sessionId: string;
  token: string | null;
}): Promise<InputImageContent[]> {
  const { gatewayUrl, inputParts, sessionId, token } = options;
  const result: InputImageContent[] = [];

  for (const part of inputParts) {
    if (!part.imageUrl || part.imageUrl.length <= MAX_GATEWAY_IMAGE_URL_CHARS) {
      result.push(part);
      continue;
    }

    const decoded = decodeBase64DataUrl(part.imageUrl);
    if (!decoded) {
      result.push(part);
      continue;
    }

    const fileName = part.fileName ?? 'image';
    const fileMimeType = part.mimeType ?? decoded.mimeType ?? 'application/octet-stream';
    const file = new File([decoded.bytes], fileName, { type: fileMimeType });
    const uploaded = await uploadChatAttachments({ files: [file], gatewayUrl, sessionId, token });
    const reuploaded = uploaded[0];
    if (!reuploaded) {
      // 上传失败时保留原始 part：宁可让发送阶段明确失败，也不要静默丢掉用户的图片。
      result.push(part);
      continue;
    }

    // 有意不携带 imageUrl（超长正是要重传的原因），也不携带 fileId：
    // 网关仅在 part 没有 fileId 时才会用 artifactId 反查并注入 Data URL。
    const resolvedMimeType = reuploaded.mimeType ?? part.mimeType ?? decoded.mimeType;
    result.push({
      type: 'input_image',
      artifactId: reuploaded.artifactId,
      ...(reuploaded.fileName ? { fileName: reuploaded.fileName } : {}),
      ...(resolvedMimeType ? { mimeType: resolvedMimeType } : {}),
      ...(part.detail ? { detail: part.detail } : {}),
    });
  }

  return result;
}
