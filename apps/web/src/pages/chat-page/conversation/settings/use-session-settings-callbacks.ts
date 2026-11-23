import { useCallback } from 'react';
import type { DialogueMode } from '../../mode/dialogue-mode.js';
import type { ReasoningEffort } from '../../../../components/conversation-runtime/messages/support.js';
import type { ComposerPermissionMode } from '../../../../components/chat/composer/ComposerPermissionModeSelect.js';
import type { ModelSelectionSource } from './model-selection-source.js';
import { writeRefCurrent } from '../../../../utils/ref/ref-current.js';

export interface SessionSettingsState {
  dialogueMode: DialogueMode;
  /**
   * 会话是否由来源托管（渠道 / 定时任务）。为 true 时 `buildSessionMetadata`
   * **不写** `dialogueMode`：这些会话没有对话模式，写入不仅无意义，还会让网关的
   * 澄清只读白名单把渠道回复工具全部收敛掉（见 utils/session/session-origin）。
   */
  isSourceManagedSession: boolean;
  /** 工具调用审批方式档位（ask / auto-edit / yolo）——审批语义的唯一事实来源。 */
  permissionMode: ComposerPermissionMode;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  activeProviderId: string;
  activeModelId: string;
  /**
   * 会话级上下文窗口挡位（token 数）。
   *
   * 与模型级挡位（`user_settings.providers` 里模型的 `contextWindowOverride`）
   * 分属两个作用域：模型级是该用户下所有会话共享的默认值，本字段只影响当前会话。
   * `undefined` / 缺席表示「本会话未覆盖」——落库时写 `null`，网关按
   * 「显式 null = 清除」处理，随后回退到模型级 / 模型 preset。
   */
  contextWindowOverride?: number | undefined;
  /**
   * 模型选择来源的「最新值 ref」（`'defaults' | 'manual' | ...`）。
   *
   * 该 ref 只在 effect / 事件回调里改写；调用方若在渲染期读 `.current` 再传值，
   * React Compiler 会判定为 "Cannot access refs during render" 并放弃优化整个
   * ChatPage。改为传 ref、由 `buildSessionMetadata` 在被调用时（事件 / effect 内）
   * 读取——`useCallback` 体内读 ref 不受该规则约束，读到的仍是最新值。
   */
  modelSelectionSourceRef: React.MutableRefObject<ModelSelectionSource | null>;
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
  setContextWindowOverride: (value: number | undefined) => void;
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
  /**
   * 写入会话级上下文挡位并标记 metadata 脏（由 ChatPage 的 dirty 副作用
   * 统一 PATCH）。`undefined` = 清除本会话覆盖，回退到模型级配置。
   */
  handleContextWindowOverrideChange: (value: number | undefined) => Promise<void>;
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
    isSourceManagedSession,
    permissionMode,
    webSearchEnabled,
    thinkingEnabled,
    reasoningEffort,
    activeProviderId,
    activeModelId,
    contextWindowOverride,
    modelSelectionSourceRef,
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
    setContextWindowOverride,
    setManualAgentId,
    setSessionMetadataDirty,
  } = setters;

  const buildSessionMetadata = useCallback(
    (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
      const metadata: Record<string, unknown> = {
        // 来源会话（渠道 / 定时任务）没有对话模式：省略该键即字段级「不写」，
        // 否则会把界面上的假模式（默认值）落库，进而被网关的澄清只读白名单
        // 收敛掉渠道回复工具。load 路径同理不会带回该键，快照对比不会反复 PATCH。
        ...(isSourceManagedSession ? {} : { dialogueMode }),
        // 档位为规范字段；yoloMode 是派生的布尔投影，供尚未迁移的老读者消费。
        permissionMode,
        yoloMode: permissionMode === 'yolo',
        webSearchEnabled,
        thinkingEnabled,
        reasoningEffort,
      };
      if (activeProviderId) metadata['providerId'] = activeProviderId;
      if (activeModelId) metadata['modelId'] = activeModelId;
      const modelSelectionSource = modelSelectionSourceRef.current;
      if (activeProviderId && activeModelId && modelSelectionSource) {
        metadata['modelSelectionSource'] = modelSelectionSource;
      }
      // 清空选择时必须**显式写 null**（服务端按「显式 null = 清除绑定」处理）：
      // 省略该键只会保留旧绑定，会话级回退仍会把它当成角色来源。
      metadata['agentId'] = manualAgentId.trim() || null;
      // 会话级上下文挡位：显式 write-null 才能表达「清除本会话覆盖」；
      // 省略该键会保留上一次的会话级值（服务端是增量 PATCH 语义）。
      metadata['contextWindowOverride'] = contextWindowOverride ?? null;
      if (effectiveWorkingDirectory) metadata['workingDirectory'] = effectiveWorkingDirectory;
      return { ...metadata, ...overrides };
    },
    [
      activeModelId,
      activeProviderId,
      contextWindowOverride,
      dialogueMode,
      effectiveWorkingDirectory,
      isSourceManagedSession,
      manualAgentId,
      permissionMode,
      reasoningEffort,
      thinkingEnabled,
      webSearchEnabled,
    ],
  );

  const markSessionMetadataDirty = useCallback(() => {
    // `sessionMetadataDirtyRef` 是 hook 参数：直接写 .current 属「修改 hook 参数」，
    // 会让本 hook 整体退出 React Compiler 优化（见 utils/ref/ref-current.ts）。
    writeRefCurrent(sessionMetadataDirtyRef, true);
    setSessionMetadataDirty(true);
  }, [sessionMetadataDirtyRef, setSessionMetadataDirty]);

  const clearSessionMetadataDirty = useCallback(() => {
    writeRefCurrent(sessionMetadataDirtyRef, false);
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

  const handleContextWindowOverrideChange = useCallback(
    (value: number | undefined): Promise<void> => {
      // 挡位是会话级设置：不再写 `PUT /settings/providers/model-context`（那是
      // 模型级全局配置，一旦在某会话里改动会连带所有用同一模型的会话）。
      // 返回 Promise 只为满足 composer 的异步写入契约；实际落库由 ChatPage 的
      // dirty-metadata 副作用在下一拍统一 PATCH。
      setContextWindowOverride(value);
      markSessionMetadataDirty();
      return Promise.resolve();
    },
    [markSessionMetadataDirty, setContextWindowOverride],
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
    handleContextWindowOverrideChange,
    handleManualAgentChange,
    handleClearManualAgentId,
  };
}
