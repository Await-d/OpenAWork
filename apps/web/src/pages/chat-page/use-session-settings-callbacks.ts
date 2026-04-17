import { useCallback } from 'react';
import { createAgentProfilesClient } from '@openAwork/web-client';
import type { AgentProfileRecord } from '@openAwork/web-client';
import { toast } from '../../components/ToastNotification.js';
import type { DialogueMode } from '../dialogue-mode.js';
import type { ReasoningEffort } from './support.js';

export interface SessionSettingsState {
  dialogueMode: DialogueMode;
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  activeProviderId: string;
  activeModelId: string;
  manualAgentId: string;
  effectiveWorkingDirectory: string | null;
  currentAgentProfile: AgentProfileRecord | null;
  sessionMetadataDirty: boolean;
  sessionMetadataDirtyRef: React.MutableRefObject<boolean>;
}

export interface SessionSettingsSetters {
  setDialogueMode: (value: DialogueMode) => void;
  setYoloMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setWebSearchEnabled: (value: boolean | ((prev: boolean) => boolean)) => void;
  setThinkingEnabled: (value: boolean) => void;
  setReasoningEffort: (value: ReasoningEffort) => void;
  setManualAgentId: (value: string) => void;
  setCurrentAgentProfile: (value: AgentProfileRecord | null) => void;
  setSessionMetadataDirty: (value: boolean) => void;
}

export interface SessionSettingsCallbacksReturn {
  buildSessionMetadata: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  markSessionMetadataDirty: () => void;
  clearSessionMetadataDirty: () => void;
  handleDialogueModeChange: (mode: DialogueMode) => void;
  handleToggleYolo: () => void;
  handleToggleWebSearch: () => void;
  handleThinkingEnabledChange: (enabled: boolean) => void;
  handleReasoningEffortChange: (effort: ReasoningEffort) => void;
  handleManualAgentChange: (agentId: string) => void;
  handleClearManualAgentId: () => void;
  handleSaveWorkspaceProfile: () => Promise<void>;
}

export function useSessionSettingsCallbacks(
  state: SessionSettingsState,
  setters: SessionSettingsSetters,
  gatewayUrl: string,
  token: string | null,
): SessionSettingsCallbacksReturn {
  const {
    dialogueMode,
    yoloMode,
    webSearchEnabled,
    thinkingEnabled,
    reasoningEffort,
    activeProviderId,
    activeModelId,
    manualAgentId,
    effectiveWorkingDirectory,
    currentAgentProfile,
    sessionMetadataDirtyRef,
  } = state;
  const {
    setDialogueMode,
    setYoloMode,
    setWebSearchEnabled,
    setThinkingEnabled,
    setReasoningEffort,
    setManualAgentId,
    setCurrentAgentProfile,
    setSessionMetadataDirty,
  } = setters;

  const buildSessionMetadata = useCallback(
    (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
      const metadata: Record<string, unknown> = {
        dialogueMode,
        yoloMode,
        webSearchEnabled,
        thinkingEnabled,
        reasoningEffort,
      };
      if (activeProviderId) metadata['providerId'] = activeProviderId;
      if (activeModelId) metadata['modelId'] = activeModelId;
      if (manualAgentId.trim()) metadata['agentId'] = manualAgentId.trim();
      if (effectiveWorkingDirectory) metadata['workingDirectory'] = effectiveWorkingDirectory;
      return { ...metadata, ...overrides };
    },
    [
      activeModelId,
      activeProviderId,
      dialogueMode,
      effectiveWorkingDirectory,
      manualAgentId,
      reasoningEffort,
      thinkingEnabled,
      webSearchEnabled,
      yoloMode,
    ],
  );

  const markSessionMetadataDirty = useCallback(() => {
    sessionMetadataDirtyRef.current = true;
    setSessionMetadataDirty(true);
  }, [sessionMetadataDirtyRef, setSessionMetadataDirty]);

  const clearSessionMetadataDirty = useCallback(() => {
    sessionMetadataDirtyRef.current = false;
    setSessionMetadataDirty(false);
  }, [sessionMetadataDirtyRef, setSessionMetadataDirty]);

  const handleDialogueModeChange = useCallback(
    (mode: DialogueMode) => {
      setDialogueMode(mode);
      markSessionMetadataDirty();
    },
    [setDialogueMode, markSessionMetadataDirty],
  );

  const handleToggleYolo = useCallback(() => {
    setYoloMode((prev) => !prev);
    markSessionMetadataDirty();
  }, [setYoloMode, markSessionMetadataDirty]);

  const handleToggleWebSearch = useCallback(() => {
    setWebSearchEnabled((prev) => !prev);
    markSessionMetadataDirty();
  }, [setWebSearchEnabled, markSessionMetadataDirty]);

  const handleThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setThinkingEnabled(enabled);
      markSessionMetadataDirty();
    },
    [setThinkingEnabled, markSessionMetadataDirty],
  );

  const handleReasoningEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      setReasoningEffort(effort);
      markSessionMetadataDirty();
    },
    [setReasoningEffort, markSessionMetadataDirty],
  );

  const handleManualAgentChange = useCallback(
    (agentId: string) => {
      setManualAgentId(agentId.trim());
      markSessionMetadataDirty();
    },
    [setManualAgentId, markSessionMetadataDirty],
  );

  const handleClearManualAgentId = useCallback(() => {
    setManualAgentId('');
    markSessionMetadataDirty();
  }, [setManualAgentId, markSessionMetadataDirty]);

  const handleSaveWorkspaceProfile = useCallback(async () => {
    if (!token || !effectiveWorkingDirectory) return;
    const client = createAgentProfilesClient(gatewayUrl);
    const payload = {
      workspacePath: effectiveWorkingDirectory,
      label:
        currentAgentProfile?.label ??
        effectiveWorkingDirectory.split('/').filter(Boolean).at(-1) ??
        '项目配置',
      ...(manualAgentId.trim() ? { agentId: manualAgentId.trim() } : {}),
      ...(activeProviderId ? { providerId: activeProviderId } : {}),
      ...(activeModelId ? { modelId: activeModelId } : {}),
    };
    try {
      const nextProfile = currentAgentProfile
        ? await client.update(token, currentAgentProfile.id, payload)
        : await client.create(token, payload);
      setCurrentAgentProfile(nextProfile);
      toast(currentAgentProfile ? '已更新项目配置' : '已保存为项目配置', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存项目配置失败', 'error');
    }
  }, [
    activeModelId,
    activeProviderId,
    currentAgentProfile,
    effectiveWorkingDirectory,
    gatewayUrl,
    manualAgentId,
    setCurrentAgentProfile,
    token,
  ]);

  return {
    buildSessionMetadata,
    markSessionMetadataDirty,
    clearSessionMetadataDirty,
    handleDialogueModeChange,
    handleToggleYolo,
    handleToggleWebSearch,
    handleThinkingEnabledChange,
    handleReasoningEffortChange,
    handleManualAgentChange,
    handleClearManualAgentId,
    handleSaveWorkspaceProfile,
  };
}
