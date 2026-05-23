import type { InputImageContent } from '@openAwork/shared';
import { uploadChatAttachments } from '../../../../components/conversation-runtime/attachments/attachment-upload.js';

export interface ImageEditReferenceArtifactLike {
  artifactId: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
}

export interface PrepareImageGenerationInputOptions {
  files: File[];
  gatewayUrl: string;
  selectedImageEditReferenceArtifact: ImageEditReferenceArtifactLike | null;
  sessionId: string;
  token: string | null;
}

export interface PreparedImageGenerationInput {
  imageEditArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
  localImageInputs?: InputImageContent[];
}

export async function prepareImageGenerationInput(
  options: PrepareImageGenerationInputOptions,
): Promise<PreparedImageGenerationInput> {
  const { files, gatewayUrl, selectedImageEditReferenceArtifact, sessionId, token } = options;

  let imageEditArtifacts:
    | Array<{ artifactId: string; fileName?: string; mimeType?: string }>
    | undefined;
  let localImageInputs: InputImageContent[] | undefined;

  if (selectedImageEditReferenceArtifact) {
    imageEditArtifacts = [
      {
        artifactId: selectedImageEditReferenceArtifact.artifactId,
        ...(selectedImageEditReferenceArtifact.fileName
          ? { fileName: selectedImageEditReferenceArtifact.fileName }
          : {}),
        ...(selectedImageEditReferenceArtifact.mimeType
          ? { mimeType: selectedImageEditReferenceArtifact.mimeType }
          : {}),
      },
    ];
    localImageInputs = [
      {
        type: 'input_image',
        artifactId: selectedImageEditReferenceArtifact.artifactId,
        ...(selectedImageEditReferenceArtifact.imageUrl
          ? { imageUrl: selectedImageEditReferenceArtifact.imageUrl }
          : {}),
        ...(selectedImageEditReferenceArtifact.fileName
          ? { fileName: selectedImageEditReferenceArtifact.fileName }
          : {}),
        ...(selectedImageEditReferenceArtifact.mimeType
          ? { mimeType: selectedImageEditReferenceArtifact.mimeType }
          : {}),
      },
    ];
  }

  if (files.length === 0) {
    return {
      ...(imageEditArtifacts ? { imageEditArtifacts } : {}),
      ...(localImageInputs ? { localImageInputs } : {}),
    };
  }

  const uploadedAttachments = await uploadChatAttachments({
    files,
    gatewayUrl,
    sessionId,
    token,
  });

  return {
    imageEditArtifacts: uploadedAttachments
      .filter((attachment) => attachment.type === 'image')
      .map((attachment) => ({
        artifactId: attachment.artifactId,
        ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      })),
    localImageInputs: uploadedAttachments
      .filter((attachment) => attachment.type === 'image')
      .map((attachment) => ({
        type: 'input_image' as const,
        artifactId: attachment.artifactId,
        ...(attachment.dataUrl ? { imageUrl: attachment.dataUrl } : {}),
        ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      })),
  };
}
