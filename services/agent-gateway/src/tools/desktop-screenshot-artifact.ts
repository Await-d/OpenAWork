import type { InputImageContent } from '@openAwork/shared';
import { createMediaArtifact } from '../media/media-artifact.js';

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/i;

export interface DesktopScreenshotArtifactToolResult {
  readonly attachments: InputImageContent[];
  readonly output: string;
}

export interface CreateDesktopScreenshotArtifactToolResultInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly screenshotPayload: string;
  readonly title: string;
  readonly fileName?: string;
  readonly summary: string;
  readonly sourceKind: string;
  readonly createdByNote: string;
}

export function decodeDesktopScreenshotPayload(input: string): {
  readonly buffer: Buffer;
  readonly mimeType: string;
} {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('桌面截图结果为空。');
  }

  const dataUrlMatch = trimmed.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1] ?? 'image/png',
      buffer: Buffer.from(dataUrlMatch[2] ?? '', 'base64'),
    };
  }

  return {
    mimeType: 'image/png',
    buffer: Buffer.from(trimmed, 'base64'),
  };
}

export function readDesktopControlScreenshotPayload(
  result: Readonly<Record<string, unknown>>,
): string | null {
  const candidates = [result['data'], result['screenshotBase64'], result['imageBase64']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

export function createDesktopScreenshotArtifactToolResult(
  input: CreateDesktopScreenshotArtifactToolResultInput,
): DesktopScreenshotArtifactToolResult {
  const screenshot = decodeDesktopScreenshotPayload(input.screenshotPayload);
  const artifact = createMediaArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    buffer: screenshot.buffer,
    mimeType: screenshot.mimeType,
    title: input.title,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    sourceKind: input.sourceKind,
    toolCallId: input.toolCallId,
    createdBy: 'agent',
    createdByNote: input.createdByNote,
  });

  return {
    output: JSON.stringify({
      success: true,
      artifactId: artifact.artifactId,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      summary: input.summary,
    }),
    attachments: [
      {
        type: 'input_image',
        artifactId: artifact.artifactId,
        detail: 'high',
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
      },
    ],
  };
}
