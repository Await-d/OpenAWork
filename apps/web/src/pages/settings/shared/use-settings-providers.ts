import React, { useEffect, useRef, useState } from 'react';
import { validateImageGenerationSize } from '@openAwork/shared';
import { createSettingsClient } from '@openAwork/web-client';
import type {
  AIProviderRef,
  ActiveSelectionRef,
  ImageGenerationDefaultsRef,
} from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';
import type { SubagentModelPolicyRef, ThinkingDefaultsRef } from '../state/settings-types.js';
import { normalizeActiveSelectionProviders } from './settings-page-helpers.js';
import { useProviderDefaultProfile } from '../connection/use-provider-default-profile.js';
import { useProviderCatalogActions } from './use-provider-catalog-actions.js';
import { useProviderMutations } from './use-provider-mutations.js';

interface UseSettingsProvidersOptions {
  gatewayUrl: string;
  token: string | null;
}

/**
 * Settings 页 provider 状态与默认模型画像：provider 列表、默认选择/思考/图片
 * 生成配置，以及保存、目录刷新与增删改动作的统一装配。
 */
export function useSettingsProviders({ gatewayUrl, token }: UseSettingsProvidersOptions) {
  const [providers, setProviders] = useState<AIProviderRef[]>([]);
  const providersRef = useRef<AIProviderRef[]>(providers);
  const normalizeProviderSelection = React.useCallback(
    (selection: ActiveSelectionRef) =>
      normalizeActiveSelectionProviders(selection, providersRef.current),
    [],
  );
  const {
    activeSelection,
    activeSelectionRef,
    applyServerDefaults,
    defaultThinking,
    defaultThinkingRef,
    hasUnsavedDefaultModelChanges,
    imageGenerationDefaults,
    imageGenerationDefaultsRef,
    savedActiveSelectionRef,
    savedDefaultThinkingRef,
    savedImageGenerationDefaultsRef,
    subagentModelPolicy,
    subagentModelPolicyRef,
    savingDefaultModelSettings,
    setActiveSelection,
    setSavedActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSavingDefaultModelSettings,
    setSubagentModelPolicy,
  } = useProviderDefaultProfile({
    normalizeSelection: normalizeProviderSelection,
  });
  const providerSaveSeqRef = useRef(0);
  const providerSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  const saveProviders = React.useCallback(
    async (
      next: AIProviderRef[] = providersRef.current,
      nextSel: ActiveSelectionRef = activeSelectionRef.current,
      nextThinking: ThinkingDefaultsRef = defaultThinkingRef.current,
      nextImageGenerationDefaults: ImageGenerationDefaultsRef = imageGenerationDefaultsRef.current,
      options?: {
        syncDraft?: boolean;
        syncSaved?: boolean;
      },
    ) => {
      if (!token) return;
      const syncDraft = options?.syncDraft ?? true;
      const syncSaved = options?.syncSaved ?? true;
      const sizeValidation = validateImageGenerationSize(nextImageGenerationDefaults.size);
      if (!sizeValidation.valid) {
        throw new Error(sizeValidation.message ?? '图片尺寸无效');
      }
      const requestSeq = providerSaveSeqRef.current + 1;
      providerSaveSeqRef.current = requestSeq;

      const runSave = async () => {
        const data = (await createSettingsClient(gatewayUrl).putProviders(token, {
          providers: next,
          activeSelection: nextSel,
          defaultThinking: nextThinking,
          imageGenerationDefaults: nextImageGenerationDefaults,
          subagentModelPolicy: subagentModelPolicyRef.current,
        })) as {
          providers?: AIProviderRef[];
          activeSelection?: ActiveSelectionRef;
          defaultThinking?: ThinkingDefaultsRef;
          imageGenerationDefaults?: ImageGenerationDefaultsRef;
          subagentModelPolicy?: SubagentModelPolicyRef;
          error?: string;
        };

        if (requestSeq !== providerSaveSeqRef.current) {
          return;
        }

        if (data.providers) {
          providersRef.current = data.providers;
          setProviders(data.providers);
        }
        applyServerDefaults(
          {
            activeSelection: data.activeSelection,
            defaultThinking: data.defaultThinking,
            imageGenerationDefaults: data.imageGenerationDefaults,
            subagentModelPolicy: data.subagentModelPolicy,
          },
          { syncDraft, syncSaved },
        );
      };

      const queuedSave = providerSaveQueueRef.current.catch(() => undefined).then(runSave);
      providerSaveQueueRef.current = queuedSave.then(
        () => undefined,
        () => undefined,
      );
      await queuedSave;
    },
    [token, gatewayUrl],
  );

  const syncSelectionForProviders = React.useCallback((nextProviders: AIProviderRef[]) => {
    const normalizedDraftSelection = normalizeActiveSelectionProviders(
      activeSelectionRef.current,
      nextProviders,
    );
    const normalizedSavedSelection = normalizeActiveSelectionProviders(
      savedActiveSelectionRef.current,
      nextProviders,
    );

    activeSelectionRef.current = normalizedDraftSelection;
    setActiveSelection(normalizedDraftSelection);
    setSavedActiveSelection(normalizedSavedSelection);

    return {
      draftSelection: normalizedDraftSelection,
      savedSelection: normalizedSavedSelection,
    };
  }, []);

  const saveDefaultModelSettings = React.useCallback(async () => {
    if (!token || savingDefaultModelSettings) {
      return;
    }

    setSavingDefaultModelSettings(true);
    try {
      const normalizedDraftSelection = normalizeActiveSelectionProviders(
        activeSelectionRef.current,
        providersRef.current,
      );
      setActiveSelection(normalizedDraftSelection);
      await saveProviders(
        providersRef.current,
        normalizedDraftSelection,
        defaultThinkingRef.current,
        imageGenerationDefaultsRef.current,
        {
          syncDraft: true,
          syncSaved: true,
        },
      );
    } catch (error: unknown) {
      logger.error('failed to save default model settings', error);
    } finally {
      setSavingDefaultModelSettings(false);
    }
  }, [token, savingDefaultModelSettings, saveProviders]);

  const {
    handleTestModel,
    handleSyncCatalog,
    handleDiscoverProviders,
    handleImportDiscoveredProvider,
  } = useProviderCatalogActions({
    gatewayUrl,
    token,
    providersRef,
    setProviders,
    syncSelectionForProviders,
    activeSelectionRef,
    setActiveSelection,
    setSavedActiveSelection,
  });

  const {
    handleAddProvider,
    handleEditProvider,
    handleToggleProvider,
    handleRemoveProvider,
    handleToggleModel,
    handleAddModel,
    handleUpdateModel,
    handleRemoveModel,
  } = useProviderMutations({
    providersRef,
    setProviders,
    syncSelectionForProviders,
    saveProviders,
    savedDefaultThinkingRef,
    savedImageGenerationDefaultsRef,
  });

  return {
    providers,
    setProviders,
    providersRef,
    applyServerDefaults,
    activeSelection,
    defaultThinking,
    imageGenerationDefaults,
    subagentModelPolicy,
    hasUnsavedDefaultModelChanges,
    savingDefaultModelSettings,
    setActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSubagentModelPolicy,
    saveDefaultModelSettings,
    handleTestModel,
    handleSyncCatalog,
    handleDiscoverProviders,
    handleImportDiscoveredProvider,
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
