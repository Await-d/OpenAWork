import React from 'react';
import type {
  AIModelConfigItem,
  AIModelConfigRef,
  AIProviderRef,
  ActiveSelectionRef,
  ImageGenerationDefaultsRef,
} from '@openAwork/shared-ui';
import { canRemoveProvider } from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';
import type { ProviderEditData, ThinkingDefaultsRef } from '../state/settings-types.js';
import {
  addProviderModel,
  removeProvider,
  removeProviderModel,
  toggleProviderModel,
  updateProviderModel,
} from '../connection/provider-model-mutations.js';
import { BUILTIN_PROVIDER_TYPE_SET } from './settings-page-helpers.js';

interface UseProviderMutationsOptions {
  providersRef: React.RefObject<AIProviderRef[]>;
  setProviders: React.Dispatch<React.SetStateAction<AIProviderRef[]>>;
  syncSelectionForProviders: (nextProviders: AIProviderRef[]) => {
    draftSelection: ActiveSelectionRef;
    savedSelection: ActiveSelectionRef;
  };
  saveProviders: (
    next?: AIProviderRef[],
    nextSel?: ActiveSelectionRef,
    nextThinking?: ThinkingDefaultsRef,
    nextImageGenerationDefaults?: ImageGenerationDefaultsRef,
    options?: {
      syncDraft?: boolean;
      syncSaved?: boolean;
    },
  ) => Promise<void>;
  savedDefaultThinkingRef: React.RefObject<ThinkingDefaultsRef>;
  savedImageGenerationDefaultsRef: React.RefObject<ImageGenerationDefaultsRef>;
}

/**
 * Provider / Model 的增删改动作，统一走 setProviders + saveProviders 的持久化路径。
 */
export function useProviderMutations({
  providersRef,
  setProviders,
  syncSelectionForProviders,
  saveProviders,
  savedDefaultThinkingRef,
  savedImageGenerationDefaultsRef,
}: UseProviderMutationsOptions) {
  function handleAddProvider(data?: ProviderEditData) {
    if (!data) return;
    setProviders((prev) => {
      const takenIds = new Set(prev.map((provider) => provider.id));
      // 稳定且不重排的 id：会话以 providerId 作为外键，删除中间实例不能让其它
      // 实例的 id 漂移，因此用 UUID 后缀而非基于当前列表的序号。
      const makeStableId = (base: string): string => {
        if (!takenIds.has(base)) return base;
        const uuid =
          typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
        let candidate = `${base}-${uuid}`;
        while (takenIds.has(candidate)) {
          candidate = `${base}-${Math.random().toString(36).slice(2, 10)}`;
        }
        return candidate;
      };

      const isBuiltin = BUILTIN_PROVIDER_TYPE_SET.has(data.type) && data.type !== 'custom';
      const existingTemplate = isBuiltin
        ? prev.find((provider) => provider.type === data.type)
        : undefined;
      const baseId = isBuiltin ? data.type : 'custom';

      const nextProvider: AIProviderRef = existingTemplate
        ? {
            ...existingTemplate,
            id: makeStableId(existingTemplate.id),
            name: data.name.trim() || existingTemplate.name,
            enabled: data.enabled,
            apiKey: data.apiKey.trim() || undefined,
            baseUrl: data.baseUrl.trim() || existingTemplate.baseUrl,
            openaiFastMode:
              data.type === 'openai' && data.openaiFastMode === true ? true : undefined,
            upstreamProtocol: data.upstreamProtocol,
          }
        : {
            id: makeStableId(baseId),
            type: isBuiltin ? data.type : 'custom',
            name: data.name.trim() || (isBuiltin ? data.type : '自定义渠道'),
            enabled: data.enabled,
            apiKey: data.apiKey.trim() || undefined,
            baseUrl: data.baseUrl.trim() || undefined,
            openaiFastMode:
              data.type === 'openai' && data.openaiFastMode === true ? true : undefined,
            upstreamProtocol: data.upstreamProtocol,
            defaultModels: [],
          };
      const next = [...prev, nextProvider];
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save added provider', error);
      });
      return next;
    });
  }
  function handleEditProvider(id: string, data?: ProviderEditData) {
    if (!data) return;
    setProviders((prev) => {
      const next = prev.map((provider) =>
        provider.id === id
          ? {
              ...provider,
              name: data.name.trim(),
              type: data.type,
              enabled: data.enabled,
              apiKey: data.apiKey.trim() || undefined,
              baseUrl: data.baseUrl.trim() || undefined,
              openaiFastMode:
                data.type === 'openai' && data.openaiFastMode === true ? true : undefined,
              upstreamProtocol: data.upstreamProtocol,
            }
          : provider,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save edited provider', error);
      });
      return next;
    });
  }

  function handleToggleProvider(id: string) {
    setProviders((prev) => {
      const next = prev.map((provider) =>
        provider.id === id ? { ...provider, enabled: !provider.enabled } : provider,
      );
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save toggled provider', error);
      });
      return next;
    });
  }
  function handleRemoveProvider(id: string) {
    setProviders((prev) => {
      if (!canRemoveProvider(prev, id)) {
        return prev;
      }
      const next = removeProvider(prev, id);
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error('failed to save removed provider', error);
      });
      return next;
    });
  }
  function persistModelMutation(
    mutate: (providers: AIProviderRef[]) => AIProviderRef[],
    errorMessage: string,
  ) {
    setProviders((prev) => {
      const next = mutate(prev);
      providersRef.current = next;
      const { savedSelection } = syncSelectionForProviders(next);
      void saveProviders(
        next,
        savedSelection,
        savedDefaultThinkingRef.current,
        savedImageGenerationDefaultsRef.current,
        {
          syncDraft: false,
          syncSaved: true,
        },
      ).catch((error: unknown) => {
        logger.error(errorMessage, error);
      });
      return next;
    });
  }
  function handleToggleModel(providerId: string, modelId: string) {
    persistModelMutation(
      (prev) => toggleProviderModel(prev, providerId, modelId),
      'failed to save toggled model',
    );
  }
  function handleAddModel(providerId: string, model: AIModelConfigItem) {
    persistModelMutation(
      (prev) => addProviderModel(prev, providerId, model),
      'failed to save added model',
    );
  }
  function handleUpdateModel(
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfigRef>,
  ) {
    persistModelMutation(
      (prev) => updateProviderModel(prev, providerId, modelId, updates),
      'failed to save updated model settings',
    );
  }
  function handleRemoveModel(providerId: string, modelId: string) {
    persistModelMutation(
      (prev) => removeProviderModel(prev, providerId, modelId),
      'failed to save removed model',
    );
  }

  return {
    handleAddProvider,
    handleEditProvider,
    handleToggleProvider,
    handleRemoveProvider,
    handleToggleModel,
    handleAddModel,
    handleUpdateModel,
    handleRemoveModel,
  };
}
