import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { createArtifactsClient } from '@openAwork/web-client';
import type { MobileAttachmentItem } from '../../components/MobileAttachmentBar';
import type { MobileImageGenerationDefaults } from '../../store/providerPersistence';
import { inferAttachmentType, resolveAttachmentMimeType } from './chat-attachments';
import type { ArtifactRecord, UploadedMobileAttachment } from './types';

interface UseChatArtifactsInput {
  accessToken: string | null;
  canApplySessionMutation: (requestSessionId: string | undefined) => boolean;
  gatewayUrl: string;
  handleAuthError: (error: unknown) => boolean;
  imageDefaults: MobileImageGenerationDefaults;
  sessionId: string;
  setArtifactHistory: Dispatch<SetStateAction<MobileAttachmentItem[]>>;
}

export function useChatArtifacts({
  accessToken,
  canApplySessionMutation,
  gatewayUrl,
  handleAuthError,
  imageDefaults,
  sessionId,
  setArtifactHistory,
}: UseChatArtifactsInput) {
  const loadArtifactHistory = useCallback(
    async (requestSessionId = sessionId) => {
      if (!accessToken) return;
      try {
        const data = (await createArtifactsClient(gatewayUrl).listForSession(
          accessToken,
          requestSessionId,
        )) as { artifacts?: ArtifactRecord[] };
        if (!canApplySessionMutation(requestSessionId)) {
          return;
        }
        setArtifactHistory(
          [...(data.artifacts ?? [])]
            .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
            .map((artifact) => {
              const mimeType = resolveAttachmentMimeType({
                mimeType: artifact.mimeType,
                name: artifact.name,
              });
              return {
                id: artifact.id,
                artifactId: artifact.id,
                name: artifact.name,
                ...(mimeType ? { mimeType } : {}),
                type: inferAttachmentType({ mimeType, name: artifact.name }),
                sizeBytes: artifact.sizeBytes ?? 0,
              };
            }),
        );
      } catch (error) {
        if (handleAuthError(error)) return;
        console.warn('Failed to load mobile artifact history', error);
      }
    },
    [accessToken, canApplySessionMutation, gatewayUrl, sessionId],
  );

  const uploadSelectedAttachments = useCallback(
    async (requestSessionId: string, selectedAttachments: MobileAttachmentItem[]) => {
      const uploaded: UploadedMobileAttachment[] = [];
      for (const attachment of selectedAttachments) {
        if (!attachment.uri || !accessToken) {
          continue;
        }

        try {
          const contentBase64 = await FileSystem.readAsStringAsync(attachment.uri, {
            encoding: 'base64' as const,
          });
          const mimeType = resolveAttachmentMimeType({
            mimeType: attachment.mimeType,
            name: attachment.name,
          });
          const data = (await createArtifactsClient(gatewayUrl).uploadToSession(
            accessToken,
            requestSessionId,
            {
              name: attachment.name,
              mimeType,
              sizeBytes: attachment.sizeBytes,
              contentBase64,
            },
          )) as {
            artifact?: { id: string; name: string; preview?: string; mimeType?: string };
          };
          if (!data.artifact?.id) {
            continue;
          }

          uploaded.push({
            artifactId: data.artifact.id,
            fileName: data.artifact.name,
            localUri: attachment.uri,
            mimeType: data.artifact.mimeType ?? mimeType,
            preview: data.artifact.preview,
            type: inferAttachmentType({
              mimeType: data.artifact.mimeType ?? mimeType,
              name: data.artifact.name,
            }),
          });
        } catch (error) {
          if (handleAuthError(error)) return uploaded;
          console.warn('Failed to upload mobile attachment', error);
        }
      }

      return uploaded;
    },
    [accessToken, gatewayUrl],
  );

  const generateImageForSession = useCallback(
    async (params: {
      inputArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
      prompt: string;
      requestSessionId: string;
    }) => {
      if (!accessToken) {
        throw new Error('当前未登录，无法生成图片。');
      }

      const payload = (await createArtifactsClient(gatewayUrl).generateImage(
        accessToken,
        params.requestSessionId,
        {
          ...(params.inputArtifacts ? { inputArtifacts: params.inputArtifacts } : {}),
          prompt: params.prompt,
          size: imageDefaults.size,
          quality: imageDefaults.quality,
          outputFormat: imageDefaults.outputFormat,
          background: imageDefaults.background,
        },
      )) as {
        artifact?: { id: string; title: string; type: 'image' };
        error?: { message?: string };
        messageSummary?: string;
        parameters?: { modelId?: string; providerId?: string };
        revisedPrompt?: string | null;
      };

      return payload;
    },
    [accessToken, gatewayUrl, imageDefaults],
  );

  return { generateImageForSession, loadArtifactHistory, uploadSelectedAttachments };
}
