import { useCallback } from 'react';
import type { DialogueMode } from '../../mode/dialogue-mode.js';
import type { ReasoningEffort } from '../../../../components/conversation-runtime/messages/support.js';
import type { ComposerPermissionMode } from '../../../../components/chat/composer/ComposerPermissionModeSelect.js';
import type { ModelSelectionSource } from './model-selection-source.js';

export interface SessionSettingsState {
  dialogueMode: DialogueMode;
  /** 工具调用审批方式档位（ask / auto-edit / yolo）——审批语义的唯一事实来源。 */
  permissionMode: ComposerPermissionMode;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  activeProviderId: string;
  activeModelId: string;
  modelSelectionSource: ModelSelectionSource | null;
  manualAgentId: string;
  effectiveWorkingDirectory: string | null;
  sessionMetadataDirty: boolean;
  sessionMetadataDirtyRef: React.MutableRefObject<boolean>;
}

export interface SessionSettingsSetters {
  setDialogueMode: (value: DialogueMode) => void;
  setPermissionMode: (value: ComposerPermissionMode) => void;
  setWebSearchEnabled: (value: boolean | ((prev: boolean) => boolean)) => void;
  setThinkingEnabled: (value: boolean) => void;
  setReasoningEffort: (value: ReasoningEffort) => void;
  setManualAgentId: (value: string) => void;
  setSessionMetadataDirty: (value: boolean) => void;
}

export interface SessionSettingsCallbacksReturn {
  buildSessionMetadata: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  markSessionMetadataDirty: () => void;
  clearSessionMetadataDirty: () => void;
  handleDialogueModeChange: (mode: DialogueMode) => void;
  handleToggleYolo: () => void;
  /** 按目标档位设置审批方式（不再盲目取反）：ask / auto-edit / yolo 三档。 */
  handlePermissionModeChange: (mode: ComposerPermissionMode) => void;
  handleToggleWebSearch: () => void;
  handleThinkingEnabledChange: (enabled: boolean) => void;
  handleReasoningEffortChange: (effort: ReasoningEffort) => void;
  handleManualAgentChange: (agentId: string) => void;
  handleClearManualAgentId: () => void;
}

export function useSessionSettingsCallbacks(
  state: SessionSettingsState,
  setters: SessionSettingsSetters,
  gatewayUrl: string,
  token: string | null,
): SessionSettingsCallbacksReturn {
  const {
    dialogueMode,
    permissionMode,
    webSearchEnabled,
    thinkingEnabled,
    reasoningEffort,
    activeProviderId,
    activeModelId,
    modelSelectionSource,
    manualAgentId,
    effectiveWorkingDirectory,
    sessionMetadataDirtyRef,
  } = state;
  const {
    setDialogueMode,
    setPermissionMode,
    setWebSearchEnabled,
    setThinkingEnabled,
    setReasoningEffort,
    setManualAgentId,
    setSessionMetadataDirty,
  } = setters;

  const buildSessionMetadata = useCallback(
    (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
      const metadata: Record<string, unknown> = {
        dialogueMode,
        // 档位为规范字段；yoloMode 是派生的布尔投影，供尚未迁移的老读者消费。
        permissionMode,
        yoloMode: permissionMode === 'yolo',
        webSearchEnabled,
        thinkingEnabled,
        reasoningEffort,
      };
      if (activeProviderId) metadata['providerId'] = activeProviderId;
      if (activeModelId) metadata['modelId'] = activeModelId;
      if (activeProviderId && activeModelId && modelSelectionSource) {
        metadata['modelSelectionSource'] = modelSelectionSource;
      }
      if (manualAgentId.trim()) metadata['agentId'] = manualAgentId.trim();
      if (effectiveWorkingDirectory) metadata['workingDirectory'] = effectiveWorkingDirectory;
      return { ...metadata, ...overrides };
    },
    [
      activeModelId,
      modelSelectionSource,
      activeProviderId,
      dialogueMode,
      effectiveWorkingDirectory,
      manualAgentId,
      permissionMode,
      reasoningEffort,
      thinkingEnabled,
      webSearchEnabled,
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

  /** 快捷命令入口的 YOLO 开关：只在 ask 与 yolo 两档之间切换，不触碰中间的编辑自动档。 */
  const handleToggleYolo = useCallback(() => {
    setPermissionMode(permissionMode === 'yolo' ? 'ask' : 'yolo');
    markSessionMetadataDirty();
  }, [setPermissionMode, permissionMode, markSessionMetadataDirty]);

  /**
   * 输入框内档位选择器的写入路径：按目标档位设置，避免「取反」在连续切换时
   * 依赖渲染时序。本地状态先乐观更新，之后由 ChatPage 的 dirty-metadata 副作用
   * 统一 PATCH；该副作用失败时静默保留本地值（既有行为，不做回滚）。
   */
  const handlePermissionModeChange = useCallback(
    (mode: ComposerPermissionMode) => {
      setPermissionMode(mode);
      markSessionMetadataDirty();
    },
    [markSessionMetadataDirty, setPermissionMode],
  );

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

  return {
    buildSessionMetadata,
    markSessionMetadataDirty,
    clearSessionMetadataDirty,
    handleDialogueModeChange,
    handleToggleYolo,
    handlePermissionModeChange,
    handleToggleWebSearch,
    handleThinkingEnabledChange,
    handleReasoningEffortChange,
    handleManualAgentChange,
    handleClearManualAgentId,
  };
}
