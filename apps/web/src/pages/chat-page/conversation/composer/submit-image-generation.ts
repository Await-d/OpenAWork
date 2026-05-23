import type { InputImageContent } from '@openAwork/shared';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { estimateTokenCount } from '../../../../components/conversation-runtime/messages/support.js';
import { makeOrderedMessageId } from '../../../../components/conversation-runtime/messages/ordered-id.js';
import type { SessionImageGenerationResponse } from '../../hooks/use-chat-image-generation.js';

export interface SubmitImageGenerationOptions {
  activeSessionRef: React.MutableRefObject<string | null>;
  appendImageGenerationSummaryMessage: (input: {
    artifactTitle: string;
    messageSummary: string;
    modelId: string;
    providerId: string;
    revisedPrompt: string | null;
    sourcePrompt: string;
  }) => void;
  generateImageForSession: (params: {
    inputArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
    prompt: string;
    sessionId: string;
  }) => Promise<SessionImageGenerationResponse>;
  imageEditArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
  imageModelLabel: string;
  localImageInputs?: InputImageContent[];
  onError: (message: string) => void;
  onQueuedMessageConsumed: () => void;
  requestSessionListRefresh: () => void;
  sessionId: string;
  setLatestGeneratedImageResult: React.Dispatch<
    React.SetStateAction<{
      artifactId: string;
      artifactTitle: string;
      modelLabel: string;
    } | null>
  >;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSessionReloadNonce: React.Dispatch<React.SetStateAction<number>>;
  sourcePrompt: string;
  toast: (message: string, tone?: 'success' | 'warning' | 'error' | 'info') => void;
}

export async function submitImageGeneration(
  options: SubmitImageGenerationOptions,
): Promise<boolean> {
  const {
    activeSessionRef,
    appendImageGenerationSummaryMessage,
    generateImageForSession,
    imageEditArtifacts,
    imageModelLabel,
    localImageInputs,
    onError,
    onQueuedMessageConsumed,
    requestSessionListRefresh,
    sessionId,
    setLatestGeneratedImageResult,
    setMessages,
    setSessionReloadNonce,
    sourcePrompt,
    toast,
  } = options;

  const requestStartedAt = Date.now();
  const userMsg: ChatMessage = {
    id: makeOrderedMessageId(requestStartedAt),
    role: 'user',
    content: sourcePrompt,
    ...(localImageInputs
      ? { rawContent: [{ type: 'text' as const, text: sourcePrompt }, ...localImageInputs] }
      : {}),
    createdAt: requestStartedAt,
    tokenEstimate: estimateTokenCount(sourcePrompt),
    status: 'completed',
  };
  setMessages((prev) => [...prev, userMsg]);
  onQueuedMessageConsumed();

  try {
    const responsePayload = await generateImageForSession({
      ...(imageEditArtifacts ? { inputArtifacts: imageEditArtifacts } : {}),
      prompt: sourcePrompt,
      sessionId,
    });
    if (activeSessionRef.current !== sessionId) {
      return false;
    }

    appendImageGenerationSummaryMessage({
      artifactTitle: responsePayload.artifact.title,
      messageSummary: responsePayload.messageSummary,
      modelId: responsePayload.parameters.modelId,
      providerId: responsePayload.parameters.providerId,
      revisedPrompt: responsePayload.revisedPrompt,
      sourcePrompt,
    });
    setLatestGeneratedImageResult({
      artifactId: responsePayload.artifact.id,
      artifactTitle: responsePayload.artifact.title,
      modelLabel: imageModelLabel || responsePayload.parameters.modelId,
    });
    setSessionReloadNonce((value) => value + 1);
    requestSessionListRefresh();
    toast(
      imageEditArtifacts ? '图片已处理，可在产物工作区查看。' : '图片已生成，可在产物工作区查看。',
      'success',
    );
    return true;
  } catch (error) {
    if (activeSessionRef.current === sessionId) {
      onError(error instanceof Error ? error.message : '图片生成失败，请稍后重试。');
    }
    return false;
  }
}
