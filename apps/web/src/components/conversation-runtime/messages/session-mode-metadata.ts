import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type { ReasoningEffort } from './message-model.js';

export function parseSessionModeMetadata(metadataJson: string | undefined): {
  agentId?: string;
  dialogueMode?: DialogueMode;
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  modelSelectionSource?: 'metadata' | 'defaults' | 'manual';
  providerId?: string;
  modelId?: string;
} {
  if (!metadataJson) {
    return {
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }

  try {
    const parsed = JSON.parse(metadataJson) as {
      dialogueMode?: DialogueMode;
      agentId?: string;
      yoloMode?: boolean;
      webSearchEnabled?: boolean;
      thinkingEnabled?: boolean;
      reasoningEffort?: ReasoningEffort;
      modelSelectionSource?: 'metadata' | 'defaults' | 'manual';
      providerId?: string;
      modelId?: string;
    };
    return {
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      dialogueMode:
        parsed.dialogueMode === 'clarify' ||
        parsed.dialogueMode === 'coding' ||
        parsed.dialogueMode === 'programmer'
          ? parsed.dialogueMode
          : undefined,
      yoloMode: parsed.yoloMode === true,
      webSearchEnabled: parsed.webSearchEnabled !== false,
      thinkingEnabled: parsed.thinkingEnabled === true,
      reasoningEffort:
        parsed.reasoningEffort === 'none' ||
        parsed.reasoningEffort === 'minimal' ||
        parsed.reasoningEffort === 'low' ||
        parsed.reasoningEffort === 'medium' ||
        parsed.reasoningEffort === 'high' ||
        parsed.reasoningEffort === 'xhigh' ||
        parsed.reasoningEffort === 'max'
          ? parsed.reasoningEffort
          : 'medium',
      modelSelectionSource:
        parsed.modelSelectionSource === 'metadata' ||
        parsed.modelSelectionSource === 'defaults' ||
        parsed.modelSelectionSource === 'manual'
          ? parsed.modelSelectionSource
          : undefined,
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : undefined,
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : undefined,
    };
  } catch {
    return {
      agentId: undefined,
      dialogueMode: 'clarify',
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }
}
