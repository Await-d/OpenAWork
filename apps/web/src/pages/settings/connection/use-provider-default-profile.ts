import React from 'react';
import type { ActiveSelectionRef, ImageGenerationDefaultsRef } from '@openAwork/shared-ui';
import type { SubagentModelPolicyRef, ThinkingDefaultsRef } from '../state/settings-types.js';
import {
  DEFAULT_IMAGE_GENERATION_DEFAULTS,
  DEFAULT_SUBAGENT_MODEL_POLICY,
  DEFAULT_THINKING_DEFAULTS,
  normalizeImageGenerationDefaults,
  normalizeSubagentModelPolicy,
  normalizeThinkingDefaults,
} from '../shared/settings-page-helpers.js';

interface UseProviderDefaultProfileOptions {
  normalizeSelection: (selection: ActiveSelectionRef) => ActiveSelectionRef;
}

export function useProviderDefaultProfile({
  normalizeSelection,
}: UseProviderDefaultProfileOptions) {
  const [activeSelection, setActiveSelectionState] = React.useState<ActiveSelectionRef>({
    chat: { providerId: '', modelId: '' },
    fast: { providerId: '', modelId: '' },
  });
  const [savedActiveSelection, setSavedActiveSelectionState] = React.useState<ActiveSelectionRef>({
    chat: { providerId: '', modelId: '' },
    fast: { providerId: '', modelId: '' },
  });
  const [defaultThinking, setDefaultThinkingState] = React.useState<ThinkingDefaultsRef>({
    chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
    fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
  });
  const [savedDefaultThinking, setSavedDefaultThinkingState] = React.useState<ThinkingDefaultsRef>({
    chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
    fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
  });
  const [imageGenerationDefaults, setImageGenerationDefaultsState] =
    React.useState<ImageGenerationDefaultsRef>({
      ...DEFAULT_IMAGE_GENERATION_DEFAULTS,
    });
  const [savedImageGenerationDefaults, setSavedImageGenerationDefaultsState] =
    React.useState<ImageGenerationDefaultsRef>({
      ...DEFAULT_IMAGE_GENERATION_DEFAULTS,
    });
  const [subagentModelPolicy, setSubagentModelPolicyState] = React.useState<SubagentModelPolicyRef>(
    {
      ...DEFAULT_SUBAGENT_MODEL_POLICY,
    },
  );
  const [savedSubagentModelPolicy, setSavedSubagentModelPolicyState] =
    React.useState<SubagentModelPolicyRef>({
      ...DEFAULT_SUBAGENT_MODEL_POLICY,
    });
  const [savingDefaultModelSettings, setSavingDefaultModelSettings] = React.useState(false);

  const activeSelectionRef = React.useRef<ActiveSelectionRef>(activeSelection);
  const savedActiveSelectionRef = React.useRef<ActiveSelectionRef>(savedActiveSelection);
  const defaultThinkingRef = React.useRef<ThinkingDefaultsRef>(defaultThinking);
  const savedDefaultThinkingRef = React.useRef<ThinkingDefaultsRef>(savedDefaultThinking);
  const imageGenerationDefaultsRef =
    React.useRef<ImageGenerationDefaultsRef>(imageGenerationDefaults);
  const savedImageGenerationDefaultsRef = React.useRef<ImageGenerationDefaultsRef>(
    savedImageGenerationDefaults,
  );
  const subagentModelPolicyRef = React.useRef<SubagentModelPolicyRef>(subagentModelPolicy);
  const savedSubagentModelPolicyRef =
    React.useRef<SubagentModelPolicyRef>(savedSubagentModelPolicy);

  React.useEffect(() => {
    activeSelectionRef.current = activeSelection;
  }, [activeSelection]);

  React.useEffect(() => {
    savedActiveSelectionRef.current = savedActiveSelection;
  }, [savedActiveSelection]);

  React.useEffect(() => {
    defaultThinkingRef.current = defaultThinking;
  }, [defaultThinking]);

  React.useEffect(() => {
    savedDefaultThinkingRef.current = savedDefaultThinking;
  }, [savedDefaultThinking]);

  React.useEffect(() => {
    imageGenerationDefaultsRef.current = imageGenerationDefaults;
  }, [imageGenerationDefaults]);

  React.useEffect(() => {
    savedImageGenerationDefaultsRef.current = savedImageGenerationDefaults;
  }, [savedImageGenerationDefaults]);

  React.useEffect(() => {
    subagentModelPolicyRef.current = subagentModelPolicy;
  }, [subagentModelPolicy]);

  React.useEffect(() => {
    savedSubagentModelPolicyRef.current = savedSubagentModelPolicy;
  }, [savedSubagentModelPolicy]);

  const hasUnsavedDefaultModelChanges = React.useMemo(
    () =>
      JSON.stringify(activeSelection) !== JSON.stringify(savedActiveSelection) ||
      JSON.stringify(defaultThinking) !== JSON.stringify(savedDefaultThinking) ||
      JSON.stringify(imageGenerationDefaults) !== JSON.stringify(savedImageGenerationDefaults) ||
      JSON.stringify(subagentModelPolicy) !== JSON.stringify(savedSubagentModelPolicy),
    [
      activeSelection,
      savedActiveSelection,
      defaultThinking,
      savedDefaultThinking,
      imageGenerationDefaults,
      savedImageGenerationDefaults,
      subagentModelPolicy,
      savedSubagentModelPolicy,
    ],
  );

  const setActiveSelection = React.useCallback(
    (updater: React.SetStateAction<ActiveSelectionRef>) => {
      setActiveSelectionState((prev) => {
        const nextRaw = typeof updater === 'function' ? updater(prev) : updater;
        const next = normalizeSelection(nextRaw);
        activeSelectionRef.current = next;
        return next;
      });
    },
    [normalizeSelection],
  );

  const setDefaultThinking = React.useCallback(
    (updater: React.SetStateAction<ThinkingDefaultsRef>) => {
      setDefaultThinkingState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        defaultThinkingRef.current = next;
        return next;
      });
    },
    [],
  );

  const setSavedActiveSelection = React.useCallback(
    (selection: ActiveSelectionRef) => {
      const normalizedSelection = normalizeSelection(selection);
      savedActiveSelectionRef.current = normalizedSelection;
      setSavedActiveSelectionState(normalizedSelection);
    },
    [normalizeSelection],
  );

  const setImageGenerationDefaults = React.useCallback(
    (updater: React.SetStateAction<ImageGenerationDefaultsRef>) => {
      setImageGenerationDefaultsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        imageGenerationDefaultsRef.current = next;
        return next;
      });
    },
    [],
  );

  const setSubagentModelPolicy = React.useCallback(
    (updater: React.SetStateAction<SubagentModelPolicyRef>) => {
      setSubagentModelPolicyState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        subagentModelPolicyRef.current = next;
        return next;
      });
    },
    [],
  );

  const applyServerDefaults = React.useCallback(
    (
      input: {
        activeSelection?: ActiveSelectionRef | null;
        defaultThinking?: ThinkingDefaultsRef | null;
        imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
        subagentModelPolicy?: SubagentModelPolicyRef | null;
      },
      options?: {
        syncDraft?: boolean;
        syncSaved?: boolean;
      },
    ) => {
      const syncDraft = options?.syncDraft ?? true;
      const syncSaved = options?.syncSaved ?? true;

      if (input.activeSelection) {
        const normalizedSelection = normalizeSelection(input.activeSelection);
        if (syncDraft) {
          activeSelectionRef.current = normalizedSelection;
          setActiveSelectionState(normalizedSelection);
        }
        if (syncSaved) {
          savedActiveSelectionRef.current = normalizedSelection;
          setSavedActiveSelectionState(normalizedSelection);
        }
      }

      const normalizedThinking = normalizeThinkingDefaults(input.defaultThinking);
      if (syncDraft) {
        defaultThinkingRef.current = normalizedThinking;
        setDefaultThinkingState(normalizedThinking);
      }
      if (syncSaved) {
        savedDefaultThinkingRef.current = normalizedThinking;
        setSavedDefaultThinkingState(normalizedThinking);
      }

      const normalizedImageGenerationDefaults = normalizeImageGenerationDefaults(
        input.imageGenerationDefaults,
      );
      if (syncDraft) {
        imageGenerationDefaultsRef.current = normalizedImageGenerationDefaults;
        setImageGenerationDefaultsState(normalizedImageGenerationDefaults);
      }
      if (syncSaved) {
        savedImageGenerationDefaultsRef.current = normalizedImageGenerationDefaults;
        setSavedImageGenerationDefaultsState(normalizedImageGenerationDefaults);
      }

      // 与 imageGenerationDefaults 的「缺省即重置」不同：subagentModelPolicy 字段缺失（旧版网关
      // 未返回该字段）时表示「未变更」，应保持 draft/saved/ref 原值，而不是重置为 auto。
      // 否则缺失字段的 GET 响应会把本地 inherit-main 拉回 auto，并在下一次 provider 变更保存时写回服务端。
      if (input.subagentModelPolicy !== undefined && input.subagentModelPolicy !== null) {
        const normalizedSubagentModelPolicy = normalizeSubagentModelPolicy(
          input.subagentModelPolicy,
        );
        if (syncDraft) {
          subagentModelPolicyRef.current = normalizedSubagentModelPolicy;
          setSubagentModelPolicyState(normalizedSubagentModelPolicy);
        }
        if (syncSaved) {
          savedSubagentModelPolicyRef.current = normalizedSubagentModelPolicy;
          setSavedSubagentModelPolicyState(normalizedSubagentModelPolicy);
        }
      }
    },
    [normalizeSelection],
  );

  return {
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
    savedSubagentModelPolicyRef,
    savingDefaultModelSettings,
    setActiveSelection,
    setSavedActiveSelection,
    setImageGenerationDefaults,
    setSavingDefaultModelSettings,
    setDefaultThinking,
    setSubagentModelPolicy,
    subagentModelPolicy,
    subagentModelPolicyRef,
  };
}
