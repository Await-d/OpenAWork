import type { AttachmentItem } from '@openAwork/shared-ui';

const BASE64_CHUNK_SIZE = 0x8000;

interface ArtifactUploadRecord {
  id: string;
  name: string;
  preview?: string;
}

interface ArtifactUploadResponse {
  artifact?: ArtifactUploadRecord;
}

export interface UploadChatAttachmentsOptions {
  files: File[];
  gatewayUrl: string;
  sessionId: string;
  token: string | null;
  fetchImpl?: typeof fetch;
}

function inferAttachmentType(file: File): AttachmentItem['type'] {
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  if (file.type.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}

function describeAttachmentType(type: AttachmentItem['type']): string {
  switch (type) {
    case 'image':
      return '图片';
    case 'audio':
      return '音频';
    default:
      return '文件';
  }
}

function isArtifactUploadRecord(value: unknown): value is ArtifactUploadRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && typeof candidate['name'] === 'string';
}

function buildFailedAttachmentLine(file: File): string {
  return `- ${file.name} (${describeAttachmentType(inferAttachmentType(file))}，上传失败)`;
}

function buildSuccessfulAttachmentLine(artifact: ArtifactUploadRecord): string {
  return artifact.preview
    ? `- ${artifact.name} (artifact:${artifact.id})\n内容摘录:\n${artifact.preview}`
    : `- ${artifact.name} (artifact:${artifact.id})`;
}

export function buildAttachmentSummary(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }

  return `[附件]\n${lines.join('\n')}`;
}

export function appendAttachmentSummary(message: string, lines: string[]): string {
  const trimmedMessage = message.trim();
  const summary = buildAttachmentSummary(lines);
  if (!summary) {
    return trimmedMessage;
  }

  return trimmedMessage ? `${trimmedMessage}\n\n${summary}` : summary;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(start, start + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return encodeBytesToBase64(new Uint8Array(buffer));
}

export async function uploadChatAttachments({
  files,
  gatewayUrl,
  sessionId,
  token,
  fetchImpl = fetch,
}: UploadChatAttachmentsOptions): Promise<string[]> {
  if (!token) {
    return files.map((file) => buildFailedAttachmentLine(file));
  }

  return Promise.all(
    files.map(async (file) => {
      try {
        const contentBase64 = await fileToBase64(file);
        const response = await fetchImpl(`${gatewayUrl}/sessions/${sessionId}/artifacts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type || undefined,
            sizeBytes: file.size,
            contentBase64,
          }),
        });
        if (!response.ok) {
          return buildFailedAttachmentLine(file);
        }

        const payload = (await response.json()) as ArtifactUploadResponse;
        if (!isArtifactUploadRecord(payload.artifact)) {
          return buildFailedAttachmentLine(file);
        }

        return buildSuccessfulAttachmentLine(payload.artifact);
      } catch {
        return buildFailedAttachmentLine(file);
      }
    }),
  );
}
