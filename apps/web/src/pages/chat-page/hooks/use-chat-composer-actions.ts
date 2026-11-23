import type { RefObject } from 'react';
import type { UnifiedComposerSubmitPayload } from '../../../components/chat/composer/UnifiedComposer.js';
import type { ReasoningEffort } from '../../../components/conversation-runtime/messages/support.js';
import type { ModelSelectionSource } from '../conversation/settings/model-selection-source.js';

type ComposerActionsDeps = {
  sendMessage: (
    text: string,
    options: {
      queuedFiles: UnifiedComposerSubmitPayload['files'];
      queuedAttachmentItems: UnifiedComposerSubmitPayload['attachmentItems'];
      queuedMessageId: string | undefined;
    },
  ) => Promise<boolean>;
  stopActiveMessage: () => void | Promise<void>;
  setActiveProviderId: (id: string) => void;
  setActiveModelId: (id: string) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  sessionModelSelectionSourceRef: RefObject<ModelSelectionSource | null>;
  markSessionMetadataDirty: () => void;
  markThinkingOverride: () => void;
};

/** Composer 的提交载荷与模型/思考配置变更，复用页面既有发送和停止流水线。 */
export function useChatComposerActions(deps: ComposerActionsDeps) {
  return {
    onComposerSubmit: async (payload: UnifiedComposerSubmitPayload) =>
      deps.sendMessage(payload.text, {
        queuedFiles: payload.files,
        queuedAttachmentItems: payload.attachmentItems,
        queuedMessageId: payload.queuedMessageId,
      }),
    onStopComposer: () => void deps.stopActiveMessage(),
    onComposerModelSelect: async (providerId: string, modelId: string) => {
      deps.setActiveProviderId(providerId);
      deps.setActiveModelId(modelId);
      deps.sessionModelSelectionSourceRef.current = 'manual';
      deps.markSessionMetadataDirty();
    },
    onThinkingEnabledChange: (enabled: boolean) => {
      deps.setThinkingEnabled(enabled);
      deps.markThinkingOverride();
      deps.markSessionMetadataDirty();
    },
    onReasoningEffortChange: (effort: ReasoningEffort) => {
      deps.setReasoningEffort(effort);
      deps.markThinkingOverride();
      deps.markSessionMetadataDirty();
    },
  };
}
