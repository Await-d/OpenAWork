import { useCallback, useEffect, useRef, useState } from 'react';
import { validateImageGenerationSize } from '@openAwork/shared';
import { createSettingsClient } from '@openAwork/web-client';
import type {
  AIProviderRef,
  ActiveSelectionRef,
  ImageGenerationDefaultsRef,
} from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
import type {
  SubagentLimitsRef,
  SubagentModelPolicyRef,
  ThinkingDefaultsRef,
} from '../state/settings-types.js';
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
/**
 * 默认模型设置保存的统一包装：置忙 → try → catch 交给 `onError` → finally 清忙。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 这处 try
 * 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runSaveDefaultModelSettingsOnce(ctx: {
  setBusy: (busy: boolean) => void;
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setBusy(true);
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.setBusy(false);
  }
}

export function useSettingsProviders({ gatewayUrl, token }: UseSettingsProvidersOptions) {
  const [providers, setProviders] = useState<AIProviderRef[]>([]);
  const providersRef = useRef<AIProviderRef[]>(providers);
  const normalizeProviderSelection = useCallback(
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
    subagentLimits,
    subagentLimitsRef,
    savingDefaultModelSettings,
    setActiveSelection,
    setSavedActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSavingDefaultModelSettings,
    setSubagentModelPolicy,
    setSubagentLimits,
  } = useProviderDefaultProfile({
    normalizeSelection: normalizeProviderSelection,
  });
  const providerSaveSeqRef = useRef(0);
  const providerSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  const saveProviders = useCallback(
    async (
      nextProviders?: AIProviderRef[],
      nextSelection?: ActiveSelectionRef,
      nextThinkingInput?: ThinkingDefaultsRef,
      nextImageGenerationInput?: ImageGenerationDefaultsRef,
      options?: {
        syncDraft?: boolean;
        syncSaved?: boolean;
      },
    ) => {
      if (!token) return;
      // 默认参数位写 `xxxRef.current` 会被编译器判为 "MemberExpression cannot be
      // safely reordered"（默认参数求值需要重排）并让本 hook 整体脱靶。改成可选参数
      // + 函数体内 `??` 兜底：默认参数同样只在 undefined 时生效，语义等价。
      const next = nextProviders ?? providersRef.current;
      const nextSel = nextSelection ?? activeSelectionRef.current;
      const nextThinking = nextThinkingInput ?? defaultThinkingRef.current;
      const nextImageGenerationDefaults =
        nextImageGenerationInput ?? imageGenerationDefaultsRef.current;
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
          subagentLimits: subagentLimitsRef.current,
        })) as {
          providers?: AIProviderRef[];
          activeSelection?: ActiveSelectionRef;
          defaultThinking?: ThinkingDefaultsRef;
          imageGenerationDefaults?: ImageGenerationDefaultsRef;
          subagentModelPolicy?: SubagentModelPolicyRef;
          subagentLimits?: SubagentLimitsRef;
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
            subagentLimits: data.subagentLimits,
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
    // 补齐编译器推断出的依赖（ref / setter / 回调，见 apps/web/AGENTS.md ②）。
    [
      activeSelectionRef,
      applyServerDefaults,
      defaultThinkingRef,
      gatewayUrl,
      imageGenerationDefaultsRef,
      savedActiveSelectionRef,
      setActiveSelection,
      setSavedActiveSelection,
      setSavingDefaultModelSettings,
      subagentLimitsRef,
      subagentModelPolicyRef,
      token,
    ],
  );

  const syncSelectionForProviders = useCallback(
    (nextProviders: AIProviderRef[]) => {
      const normalizedDraftSelection = normalizeActiveSelectionProviders(
        activeSelectionRef.current,
        nextProviders,
      );
      const normalizedSavedSelection = normalizeActiveSelectionProviders(
        savedActiveSelectionRef.current,
        nextProviders,
      );

      // ref 由调用方创建后作为参数传入（跨 hook 边界的共享 ref 池），直接写 .current 会被
      // 编译器判为「修改函数返回值」；写入统一走收敛函数（见 utils/ref/ref-current.ts）。
      writeRefCurrent(activeSelectionRef, normalizedDraftSelection);
      setActiveSelection(normalizedDraftSelection);
      setSavedActiveSelection(normalizedSavedSelection);

      return {
        draftSelection: normalizedDraftSelection,
        savedSelection: normalizedSavedSelection,
      };
      // 补齐编译器推断出的依赖（ref / setter，见 apps/web/AGENTS.md ②）。
    },
    [activeSelectionRef, savedActiveSelectionRef, setActiveSelection, setSavedActiveSelection],
  );

  const saveDefaultModelSettings = useCallback(async () => {
    if (!token || savingDefaultModelSettings) {
      return;
    }

    // 置 busy 与 try/catch/finally 一起下沉到模块级 `runSaveDefaultModelSettingsOnce`。
    await runSaveDefaultModelSettingsOnce({
      setBusy: setSavingDefaultModelSettings,
      onError: (error) => {
        logger.error('failed to save default model settings', error);
      },
      run: async () => {
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
      },
    });
    // 补齐编译器推断出的依赖（ref / setter，见 apps/web/AGENTS.md ②）。
  }, [
    activeSelectionRef,
    defaultThinkingRef,
    imageGenerationDefaultsRef,
    savingDefaultModelSettings,
    saveProviders,
    setActiveSelection,
    setSavingDefaultModelSettings,
    token,
  ]);

  const {
    handleTestModel,
    handleSyncCatalog,
    handleDiscoverProviders,
    handleFetchUpstreamModels,
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
    handleImportUpstreamModels,
    handleBatchUpdateModels,
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
    subagentLimits,
    hasUnsavedDefaultModelChanges,
    savingDefaultModelSettings,
    setActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSubagentModelPolicy,
    setSubagentLimits,
    saveDefaultModelSettings,
    handleTestModel,
    handleSyncCatalog,
    handleFetchUpstreamModels,
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
    handleImportUpstreamModels,
    handleBatchUpdateModels,
  };
}
