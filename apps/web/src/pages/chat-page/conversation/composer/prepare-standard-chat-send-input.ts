import type { InputImageContent } from '@openAwork/shared';
import { appendAttachmentSummary } from '../../../../components/conversation-runtime/attachments/attachment-upload.js';
import {
  buildUploadedAttachmentSummaryLine,
  uploadChatAttachments,
} from '../../../../components/conversation-runtime/attachments/attachment-upload.js';

export interface PrepareStandardChatSendInputOptions {
  existingInputParts?: InputImageContent[];
  files: File[];
  gatewayUrl: string;
  sessionId: string;
  text: string;
  token: string | null;
}

export interface PreparedStandardChatSendInput {
  requestInputParts?: InputImageContent[];
  localRequestInputParts?: InputImageContent[];
  text: string;
}

export async function prepareStandardChatSendInput(
  options: PrepareStandardChatSendInputOptions,
): Promise<PreparedStandardChatSendInput> {
  const { existingInputParts, files, gatewayUrl, sessionId, text, token } = options;

  if (files.length === 0) {
    return {
      ...(existingInputParts && existingInputParts.length > 0
        ? {
            requestInputParts: existingInputParts,
            localRequestInputParts: existingInputParts,
          }
        : {}),
      text,
    };
  }

  const uploadedAttachments = await uploadChatAttachments({
    files,
    gatewayUrl,
    sessionId,
    token,
  });

  const imageInputParts: InputImageContent[] = uploadedAttachments
    .filter((attachment) => attachment.type === 'image')
    .map((attachment) => ({
      type: 'input_image',
      artifactId: attachment.artifactId,
      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    }));

  const localImageParts: InputImageContent[] = uploadedAttachments
    .filter((attachment) => attachment.type === 'image')
    .map((attachment) => ({
      type: 'input_image',
      artifactId: attachment.artifactId,
      ...(attachment.dataUrl ? { imageUrl: attachment.dataUrl } : {}),
      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    }));

  const uploadedAttachmentLines = uploadedAttachments
    .filter((attachment) => attachment.type !== 'image')
    .map((attachment) => buildUploadedAttachmentSummaryLine(attachment));

  return {
    ...(imageInputParts.length > 0
      ? {
          requestInputParts: imageInputParts,
          localRequestInputParts: localImageParts,
        }
      : {}),
    text: appendAttachmentSummary(text, uploadedAttachmentLines),
  };
}
