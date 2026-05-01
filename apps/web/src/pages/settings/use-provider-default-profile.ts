import React from 'react';
import type { ActiveSelectionRef, ImageGenerationDefaultsRef } from '@openAwork/shared-ui';
import type { ThinkingDefaultsRef } from '../settings-types.js';
import {
  DEFAULT_IMAGE_GENERATION_DEFAULTS,
  DEFAULT_THINKING_DEFAULTS,
  normalizeImageGenerationDefaults,
  normalizeThinkingDefaults,
} from './settings-page-helpers.js';

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

  const hasUnsavedDefaultModelChanges = React.useMemo(
    () =>
      JSON.stringify(activeSelection) !== JSON.stringify(savedActiveSelection) ||
      JSON.stringify(defaultThinking) !== JSON.stringify(savedDefaultThinking) ||
      JSON.stringify(imageGenerationDefaults) !== JSON.stringify(savedImageGenerationDefaults),
    [
      activeSelection,
      savedActiveSelection,
      defaultThinking,
      savedDefaultThinking,
      imageGenerationDefaults,
      savedImageGenerationDefaults,
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

  const applyServerDefaults = React.useCallback(
    (
      input: {
        activeSelection?: ActiveSelectionRef | null;
        defaultThinking?: ThinkingDefaultsRef | null;
        imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
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
    savingDefaultModelSettings,
    setActiveSelection,
    setSavedActiveSelection,
    setImageGenerationDefaults,
    setSavingDefaultModelSettings,
    setDefaultThinking,
  };
}
