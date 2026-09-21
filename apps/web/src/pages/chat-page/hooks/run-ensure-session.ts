/**
 * `ensureSession` 的逻辑体（P4c 原样搬家）。
 *
 * `ChatPage` 保留原位 `async function ensureSession` 声明；deps 在函数体内构造，
 * 调用时才求值，无 TDZ、无顺序变化。
 */
import { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import type { AssistantTraceToolCall, ReasoningEffort } from '../../../components/conversation-runtime/messages/support.js';
import { useGatewayClient } from '../../../hooks/gateway/useGatewayClient.js';
import { useBookmarkStore } from '../../../stores/chat/bookmarks.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { ChatSettingsProvider, SavedChatDefaults, SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { createSessionMetadataSnapshot } from '.././conversation/render/chat-page-utils.js';
import { resolveModelSelectionSourceFromMetadata } from '.././conversation/settings/model-selection-source.js';
import type { ModelSelectionSource } from '.././conversation/settings/model-selection-source.js';
import { normalizeChatThinkingState } from '.././conversation/settings/resolve-chat-thinking-request.js';
import { createSessionsClient } from '@openAwork/web-client';
import { useCallback, useMemo } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router';

export interface EnsureSessionDeps {
  readonly activateSessionView: (nextSessionId: string | null, options?: { incrementEpoch?: boolean | undefined; } | undefined) => number;
  readonly activeModelId: string;
  readonly activeProviderId: string;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly applySavedImageDefaults: (next: SavedChatImageDefaults) => void;
  readonly buildSessionMetadata: (overrides?: Record<string, unknown> | undefined) => Record<string, unknown>;
  readonly clearSessionMetadataDirty: () => void;
  readonly currentSessionId: string | null;
  readonly currentSessionViewRef: MutableRefObject<{ epoch: number; sessionId: string | null; }>;
  readonly gatewayUrl: string;
  readonly hasAppliedSavedImageDefaultsRef: RefObject<boolean>;
  readonly lastPersistedSessionMetadataSnapshotRef: RefObject<string | null>;
  readonly loadSavedChatDefaults: () => Promise<{ defaults: SavedChatDefaults; imageDefaults: SavedChatImageDefaults; providers: ChatSettingsProvider[]; } | null>;
  readonly navigate: NavigateFunction;
  readonly pendingBootstrapSessionRef: MutableRefObject<string | null>;
  readonly providers: ChatSettingsProvider[];
  readonly reasoningEffort: ReasoningEffort;
  readonly savedChatDefaultsRef: RefObject<{ modelId: string; providerId: string; reasoningEffort: ReasoningEffort; thinkingEnabled: boolean; } | null>;
  readonly sessionMetadataDirty: boolean;
  readonly sessionModelSelectionSourceRef: RefObject<ModelSelectionSource | null>;
  readonly setActiveModelId: Dispatch<SetStateAction<string>>;
  readonly setActiveProviderId: Dispatch<SetStateAction<string>>;
  readonly setCurrentSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setProviders: Dispatch<SetStateAction<ChatSettingsProvider[]>>;
  readonly setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  readonly setSessionModesHydrated: Dispatch<SetStateAction<boolean>>;
  readonly setThinkingEnabled: Dispatch<SetStateAction<boolean>>;
  readonly thinkingEnabled: boolean;
  readonly token: string | null;
}

export async function runEnsureSession(deps: EnsureSessionDeps): Promise<string> {
  const {
  activateSessionView,
  activeModelId,
  activeProviderId,
  activeSessionRef,
  applySavedImageDefaults,
  buildSessionMetadata,
  clearSessionMetadataDirty,
  currentSessionId,
  currentSessionViewRef,
  gatewayUrl,
  hasAppliedSavedImageDefaultsRef,
  lastPersistedSessionMetadataSnapshotRef,
  loadSavedChatDefaults,
  navigate,
  pendingBootstrapSessionRef,
  providers,
  reasoningEffort,
  savedChatDefaultsRef,
  sessionMetadataDirty,
  sessionModelSelectionSourceRef,
  setActiveModelId,
  setActiveProviderId,
  setCurrentSessionId,
  setProviders,
  setReasoningEffort,
  setSessionModesHydrated,
  setThinkingEnabled,
  thinkingEnabled,
  token
  } = deps;

    if (currentSessionId) {
      activeSessionRef.current = currentSessionId;
      currentSessionViewRef.current = {
        ...currentSessionViewRef.current,
        sessionId: currentSessionId,
      };
      return currentSessionId;
    }

    const originSessionId = activeSessionRef.current;
    const originSessionViewEpoch = currentSessionViewRef.current.epoch;
    let savedDefaults = savedChatDefaultsRef.current;
    let availableProviders = providers;
    if (!savedDefaults) {
      try {
        const loadedDefaults = await loadSavedChatDefaults();
        if (loadedDefaults) {
          savedDefaults = loadedDefaults.defaults;
          availableProviders = loadedDefaults.providers;
          setProviders(loadedDefaults.providers);
          if (!hasAppliedSavedImageDefaultsRef.current) {
            applySavedImageDefaults(loadedDefaults.imageDefaults);
            hasAppliedSavedImageDefaultsRef.current = true;
          }
        }
      } catch {
        savedDefaults = null;
      }
    }

    const resolvedProviderId = sessionMetadataDirty
      ? activeProviderId || savedDefaults?.providerId || ''
      : savedDefaults?.providerId || activeProviderId || '';
    const resolvedModelId = sessionMetadataDirty
      ? activeModelId || savedDefaults?.modelId || ''
      : savedDefaults?.modelId || activeModelId || '';
    const resolvedThinkingEnabled = sessionMetadataDirty
      ? thinkingEnabled
      : (savedDefaults?.thinkingEnabled ?? thinkingEnabled);
    const resolvedReasoningEffort = sessionMetadataDirty
      ? reasoningEffort
      : (savedDefaults?.reasoningEffort ?? reasoningEffort);
    const resolvedModelSelectionSource =
      sessionMetadataDirty && sessionModelSelectionSourceRef.current
        ? sessionModelSelectionSourceRef.current
        : resolvedProviderId && resolvedModelId
          ? 'defaults'
          : sessionModelSelectionSourceRef.current;

    if (!activeProviderId && resolvedProviderId) {
      setActiveProviderId(resolvedProviderId);
    }
    if (!activeModelId && resolvedModelId) {
      setActiveModelId(resolvedModelId);
    }

    const resolvedProvider = availableProviders.find(
      (provider) => provider.id === resolvedProviderId,
    );
    const resolvedModel = resolvedProvider?.defaultModels.find(
      (model) => model.id === resolvedModelId,
    );
    const normalizedThinkingState = normalizeChatThinkingState({
      providerType: resolvedProvider?.type,
      modelId: resolvedModel?.id ?? resolvedModelId,
      declaredSupportsThinking: resolvedModel?.supportsThinking === true,
      thinkingEnabled: resolvedThinkingEnabled,
      reasoningEffort: resolvedReasoningEffort,
    });

    if (!sessionMetadataDirty) {
      setThinkingEnabled(normalizedThinkingState.thinkingEnabled);
      setReasoningEffort(normalizedThinkingState.reasoningEffort);
    }

    const resolvedMetadata = buildSessionMetadata({
      ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
      ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
      ...(resolvedModel?.label ? { modelLabel: resolvedModel.label } : {}),
      ...(resolvedModelSelectionSource
        ? { modelSelectionSource: resolvedModelSelectionSource }
        : {}),
      reasoningEffort: normalizedThinkingState.reasoningEffort,
      thinkingEnabled: normalizedThinkingState.thinkingEnabled,
    });
    // SSH 工作区草稿：远端连接 id 随元数据一并创建，网关在创建时自动完成
    // 会话↔连接绑定（workingDirectory 已由 buildSessionMetadata 取自草稿的
    // 远端路径；SSH 会话下网关按远端绝对路径校验）。
    const draftSshConnectionId = useUIStateStore.getState().selectedSshConnectionId;
    if (draftSshConnectionId) {
      resolvedMetadata['sshConnectionId'] = draftSshConnectionId;
    }
    const session = await createSessionsClient(gatewayUrl).create(token ?? '', {
      metadata: resolvedMetadata,
    });
    if (
      activeSessionRef.current !== originSessionId ||
      currentSessionViewRef.current.epoch !== originSessionViewEpoch
    ) {
      throw new Error('当前会话已切换，请重试');
    }

    lastPersistedSessionMetadataSnapshotRef.current =
      createSessionMetadataSnapshot(resolvedMetadata);
    sessionModelSelectionSourceRef.current = resolveModelSelectionSourceFromMetadata({
      modelSelectionSource:
        typeof resolvedMetadata['modelSelectionSource'] === 'string'
          ? resolvedMetadata['modelSelectionSource']
          : undefined,
      providerId: resolvedProviderId,
      modelId: resolvedModelId,
    });
    activateSessionView(session.id);
    pendingBootstrapSessionRef.current = session.id;
    setCurrentSessionId(session.id);
    clearSessionMetadataDirty();
    setSessionModesHydrated(true);
    requestSessionListRefresh();
    // 草稿「转正」：会话已落库，移除草稿标签，由真实会话标签接替。
    useUIStateStore.getState().closeDraftTabs();
    // 新会话默认收起会话面板：`reviewPanelOpened` 是全局持久化偏好，且面板可见性
    // 受「无会话」限制，不复位会在会话落库后把上一会话残留的展开态直接放出来。
    useUIStateStore.getState().setReviewPanelOpened(false);
    void navigate(`/chat/${session.id}`, { replace: true });
    return session.id;
}
