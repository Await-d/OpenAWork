import type { AttachmentItem } from '@openAwork/shared-ui';

const BASE64_CHUNK_SIZE = 0x8000;

interface ArtifactUploadRecord {
  id: string;
  name: string;
  preview?: string;
  type?: string;
  metadata?: Record<string, unknown>;
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

export interface UploadedChatAttachment {
  artifactId: string;
  dataUrl?: string;
  fileName: string;
  mimeType?: string;
  preview?: string;
  type: AttachmentItem['type'];
}

export function inferMimeTypeFromFileName(fileName: string): string | undefined {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerName.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerName.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerName.endsWith('.gif')) {
    return 'image/gif';
  }
  return undefined;
}

export function resolveFileMimeType(file: File): string | undefined {
  const mimeType = file.type || inferMimeTypeFromFileName(file.name);
  return mimeType?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType;
}

export function isImageFile(file: File): boolean {
  return Boolean(resolveFileMimeType(file)?.startsWith('image/'));
}

function inferAttachmentType(file: File): AttachmentItem['type'] {
  const mimeType = resolveFileMimeType(file);
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}

function isArtifactUploadRecord(value: unknown): value is ArtifactUploadRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && typeof candidate['name'] === 'string';
}

export function buildUploadedAttachmentSummaryLine(input: UploadedChatAttachment): string {
  return input.preview
    ? `- ${input.fileName} (artifact:${input.artifactId})\n内容摘录:\n${input.preview}`
    : `- ${input.fileName} (artifact:${input.artifactId})`;
}

function toUploadedChatAttachment(
  file: File,
  artifact: ArtifactUploadRecord,
  contentBase64: string,
): UploadedChatAttachment | null {
  if (!isArtifactUploadRecord(artifact)) {
    return null;
  }

  const metadataMimeType =
    artifact.metadata && typeof artifact.metadata['mimeType'] === 'string'
      ? artifact.metadata['mimeType']
      : undefined;
  const mimeType = metadataMimeType ?? resolveFileMimeType(file);

  return {
    artifactId: artifact.id,
    ...(mimeType?.startsWith('image/')
      ? {
          dataUrl: `data:${mimeType};base64,${contentBase64}`,
        }
      : {}),
    fileName: artifact.name,
    ...(mimeType ? { mimeType } : {}),
    ...(artifact.preview ? { preview: artifact.preview } : {}),
    type: inferAttachmentType(file),
  };
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
}: UploadChatAttachmentsOptions): Promise<UploadedChatAttachment[]> {
  if (!token) {
    return [];
  }

  const uploaded = await Promise.all(
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
            mimeType: resolveFileMimeType(file),
            sizeBytes: file.size,
            contentBase64,
          }),
        });
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as ArtifactUploadResponse;
        if (!isArtifactUploadRecord(payload.artifact)) {
          return null;
        }

        return toUploadedChatAttachment(file, payload.artifact, contentBase64);
      } catch {
        return null;
      }
    }),
  );

  return uploaded.filter((item): item is UploadedChatAttachment => item !== null);
}
