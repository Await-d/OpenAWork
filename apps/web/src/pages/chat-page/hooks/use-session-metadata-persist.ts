import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

import { createSessionsClient } from '@openAwork/web-client';

import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';

import {
  resolveModelSelectionSourceFromMetadata,
  type ModelSelectionSource,
} from '../conversation/settings/model-selection-source.js';
import { createSessionMetadataSnapshot } from '../conversation/render/chat-page-utils.js';

type SessionMetadata = Parameters<typeof createSessionMetadataSnapshot>[0];

type UseSessionMetadataPersistDeps = {
  readonly activeModelId: string;
  readonly activeProviderId: string;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly buildSessionMetadata: (overrides: { modelLabel?: string }) => SessionMetadata;
  readonly clearSessionMetadataDirty: () => void;
  readonly currentSessionId: string | null;
  readonly gatewayUrl: string;
  readonly lastPersistedSessionMetadataSnapshotRef: MutableRefObject<string | null>;
  readonly providers: ChatSettingsProvider[];
  readonly requestSessionListRefresh: () => void;
  readonly sessionMetadataDirty: boolean;
  readonly sessionModesHydrated: boolean;
  readonly sessionModelSelectionSourceRef: MutableRefObject<ModelSelectionSource | null>;
  /** 写入本次元数据解析出的模型选型来源；由父组件回调完成写入。 */
  readonly setModelSelectionSource: (source: ModelSelectionSource | null) => void;
  readonly token: string | null;
};

/**
 * 会话元数据（当前模型 / 思考档位 / 权限模式…）的持久化：脏标记为真且快照与
 * 上次写入不同时提交一次，成功后再清脏标记并刷新会话列表。
 */
export function useSessionMetadataPersist(deps: UseSessionMetadataPersistDeps) {
  const {
    activeModelId,
    activeProviderId,
    activeSessionRef,
    buildSessionMetadata,
    clearSessionMetadataDirty,
    currentSessionId,
    gatewayUrl,
    lastPersistedSessionMetadataSnapshotRef,
    providers,
    requestSessionListRefresh,
    sessionMetadataDirty,
    sessionModesHydrated,
    sessionModelSelectionSourceRef,
    setModelSelectionSource,
    token,
  } = deps;

  useEffect(() => {
    if (!currentSessionId || !token || !sessionModesHydrated || !sessionMetadataDirty) return;

    // 从 providers 列表中查找当前选中模型的 label
    const currentProvider = providers.find((p) => p.id === activeProviderId);
    const currentModel = currentProvider?.defaultModels.find((m) => m.id === activeModelId);
    const modelLabel = currentModel?.label;

    const nextMetadata = buildSessionMetadata(modelLabel ? { modelLabel } : {});
    const nextSnapshot = createSessionMetadataSnapshot(nextMetadata);
    const targetSessionId = currentSessionId;

    if (lastPersistedSessionMetadataSnapshotRef.current === nextSnapshot) {
      clearSessionMetadataDirty();
      return;
    }

    void createSessionsClient(gatewayUrl)
      .updateMetadata(token, targetSessionId, nextMetadata)
      .then(() => {
        if (activeSessionRef.current !== targetSessionId) {
          return;
        }
        writeRefCurrent(lastPersistedSessionMetadataSnapshotRef, nextSnapshot);
        setModelSelectionSource(
          resolveModelSelectionSourceFromMetadata({
            modelSelectionSource:
              typeof nextMetadata['modelSelectionSource'] === 'string'
                ? nextMetadata['modelSelectionSource']
                : undefined,
            providerId:
              typeof nextMetadata['providerId'] === 'string'
                ? nextMetadata['providerId']
                : undefined,
            modelId:
              typeof nextMetadata['modelId'] === 'string' ? nextMetadata['modelId'] : undefined,
          }),
        );
        clearSessionMetadataDirty();
        requestSessionListRefresh();
      })
      .catch(() => undefined);
  }, [
    activeModelId,
    activeProviderId,
    activeSessionRef,
    buildSessionMetadata,
    clearSessionMetadataDirty,
    currentSessionId,
    gatewayUrl,
    lastPersistedSessionMetadataSnapshotRef,
    providers,
    requestSessionListRefresh,
    sessionMetadataDirty,
    sessionModesHydrated,
    sessionModelSelectionSourceRef,
    setModelSelectionSource,
    token,
  ]);
}
