import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  CompanionAgentBinding,
  CompanionVoiceOutputMode,
  CompanionVoiceVariant,
} from '@openAwork/shared';
import type { CompanionProfile } from './companion-display-model.js';
import { useAuthStore } from '../../../stores/auth.js';

const STORAGE_KEY_PREFIX = 'openawork-buddy-voice-output';
const REMOTE_SAVE_DEBOUNCE_MS = 500;

type CompanionFeatureMode = 'off' | 'beta' | 'ga';
type CompanionInjectionMode = 'off' | 'mention_only' | 'always';
type PreferenceSyncState = 'local' | 'loading' | 'saving' | 'synced' | 'error';

interface CompanionSettingsResponse {
  activeBinding?: CompanionAgentBinding;
  bindings?: Record<string, CompanionAgentBinding>;
  feature?: {
    enabled?: boolean;
    mode?: CompanionFeatureMode;
  };
  preferences?: {
    enabled?: boolean;
    injectionMode?: CompanionInjectionMode;
    muted?: boolean;
    reducedMotion?: boolean;
    verbosity?: 'minimal' | 'normal';
    voiceOutputEnabled?: boolean;
    voiceOutputMode?: CompanionVoiceOutputMode;
    voiceRate?: number;
    voiceVariant?: CompanionVoiceVariant;
  };
  profile?: CompanionProfile | null;
}

interface BuddyVoicePreferencesState {
  enabled: boolean;
  injectionMode: CompanionInjectionMode;
  muted: boolean;
  quietMode: boolean;
  reducedMotion: boolean;
  voiceOutputEnabled: boolean;
  voiceOutputMode: CompanionVoiceOutputMode;
  voiceRate: number;
  voiceVariant: CompanionVoiceVariant;
}

export type BuddyAgentBindings = Record<string, CompanionAgentBinding>;

function normalizeAgentId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBuddyBindings(
  value: Record<string, CompanionAgentBinding> | undefined,
): BuddyAgentBindings {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentId, binding]) => {
      const normalizedAgentId = normalizeAgentId(agentId);
      if (!normalizedAgentId) {
        return [];
      }

      return [[normalizedAgentId, binding] as const];
    }),
  );
}

const DEFAULT_BUDDY_VOICE_PREFERENCES: BuddyVoicePreferencesState = {
  enabled: true,
  injectionMode: 'mention_only',
  muted: false,
  quietMode: false,
  reducedMotion: false,
  voiceOutputEnabled: false,
  voiceOutputMode: 'buddy_only',
  voiceRate: 1.02,
  voiceVariant: 'system',
};

function buildStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}:${scope}`;
}

function normalizeInjectionMode(value: unknown): CompanionInjectionMode {
  return value === 'off' || value === 'always' || value === 'mention_only' ? value : 'mention_only';
}

function readStoredVoicePreferences(scope: string): BuddyVoicePreferencesState {
  if (typeof globalThis.window === 'undefined') {
    return DEFAULT_BUDDY_VOICE_PREFERENCES;
  }

  try {
    const rawValue = globalThis.window.localStorage.getItem(buildStorageKey(scope));
    if (!rawValue) {
      return DEFAULT_BUDDY_VOICE_PREFERENCES;
    }

    if (rawValue === '1' || rawValue === '0') {
      return {
        ...DEFAULT_BUDDY_VOICE_PREFERENCES,
        voiceOutputEnabled: rawValue === '1',
      };
    }

    const parsed = JSON.parse(rawValue) as Partial<BuddyVoicePreferencesState>;
    return {
      enabled: parsed.enabled !== false,
      injectionMode: normalizeInjectionMode(parsed.injectionMode),
      muted: parsed.muted === true,
      quietMode: parsed.quietMode === true,
      reducedMotion: parsed.reducedMotion === true,
      voiceOutputEnabled: parsed.voiceOutputEnabled === true,
      voiceOutputMode: 'buddy_only',
      voiceRate: 1.02,
      voiceVariant: 'system',
    };
  } catch {
    return DEFAULT_BUDDY_VOICE_PREFERENCES;
  }
}

export function useBuddyVoicePreferences(
  scopeInput: string,
  agentIdInput?: string,
): {
  activeBinding?: CompanionAgentBinding;
  bindings: BuddyAgentBindings;
  companionFeatureMode: CompanionFeatureMode;
  effectiveVoiceOutputMode: CompanionVoiceOutputMode;
  effectiveVoiceRate: number;
  effectiveVoiceVariant: CompanionVoiceVariant;
  enabled: boolean;
  injectionMode: CompanionInjectionMode;
  isCompanionFeatureEnabled: boolean;
  isVoiceOutputFeatureReady: boolean;
  isVoiceOutputFeatureEnabled: boolean;
  muted: boolean;
  profile: CompanionProfile | null;
  quietMode: boolean;
  reducedMotion: boolean;
  syncStatus: PreferenceSyncState;
  syncStatusLabel: string;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setInjectionMode: Dispatch<SetStateAction<CompanionInjectionMode>>;
  setMuted: Dispatch<SetStateAction<boolean>>;
  setQuietMode: Dispatch<SetStateAction<boolean>>;
  setReducedMotion: Dispatch<SetStateAction<boolean>>;
  voiceOutputEnabled: boolean;
  setVoiceOutputEnabled: Dispatch<SetStateAction<boolean>>;
  saveAgentBinding: (agentId: string, binding: CompanionAgentBinding) => Promise<void>;
  removeAgentBinding: (agentId: string) => Promise<void>;
} {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const scope = useMemo(() => scopeInput.trim().toLowerCase() || 'guest', [scopeInput]);
  const agentId = useMemo(() => normalizeAgentId(agentIdInput), [agentIdInput]);
  const [preferences, setPreferences] = useState<BuddyVoicePreferencesState>(() =>
    readStoredVoicePreferences(scope),
  );
  const [bindings, setBindings] = useState<BuddyAgentBindings>({});
  const [activeBinding, setActiveBinding] = useState<CompanionAgentBinding | undefined>(undefined);
  const [profile, setProfile] = useState<CompanionProfile | null>(null);
  const [companionFeatureMode, setCompanionFeatureMode] = useState<CompanionFeatureMode>('beta');
  const [hasRemoteHydrated, setHasRemoteHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<PreferenceSyncState>('local');
  const remoteValueRef = useRef<string | null>(null);
  const remoteLoadSucceededRef = useRef(false);
  const hasLocalOverrideRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);

  const serializeRemotePreferences = useCallback(
    (value: BuddyVoicePreferencesState) =>
      JSON.stringify({
        enabled: value.enabled,
        injectionMode: value.injectionMode,
        muted: value.muted,
        reducedMotion: value.reducedMotion,
        verbosity: value.quietMode ? 'minimal' : 'normal',
        voiceOutputEnabled: value.voiceOutputEnabled,
      }),
    [],
  );

  const updatePreference = useCallback(
    (recipe: (value: BuddyVoicePreferencesState) => BuddyVoicePreferencesState) => {
      hasLocalOverrideRef.current = true;
      setPreferences((current) => recipe(current));
    },
    [],
  );

  const setEnabledWithTracking = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      updatePreference((current) => ({
        ...current,
        enabled: typeof value === 'function' ? value(current.enabled) : value,
      }));
    },
    [updatePreference],
  );

  const setInjectionModeWithTracking = useCallback<
    Dispatch<SetStateAction<CompanionInjectionMode>>
  >(
    (value) => {
      updatePreference((current) => ({
        ...current,
        injectionMode:
          typeof value === 'function'
            ? normalizeInjectionMode(value(current.injectionMode))
            : value,
      }));
    },
    [updatePreference],
  );

  const setVoiceOutputEnabledWithTracking = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      updatePreference((current) => ({
        ...current,
        voiceOutputEnabled: typeof value === 'function' ? value(current.voiceOutputEnabled) : value,
      }));
    },
    [updatePreference],
  );

  const setMutedWithTracking = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      updatePreference((current) => ({
        ...current,
        muted: typeof value === 'function' ? value(current.muted) : value,
      }));
    },
    [updatePreference],
  );

  const setQuietModeWithTracking = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      updatePreference((current) => ({
        ...current,
        quietMode: typeof value === 'function' ? value(current.quietMode) : value,
      }));
    },
    [updatePreference],
  );

  const setReducedMotionWithTracking = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      updatePreference((current) => ({
        ...current,
        reducedMotion: typeof value === 'function' ? value(current.reducedMotion) : value,
      }));
    },
    [updatePreference],
  );

  useEffect(() => {
    setPreferences(readStoredVoicePreferences(scope));
    setActiveBinding(undefined);
    setBindings({});
    setProfile(null);
    setCompanionFeatureMode('beta');
    setHasRemoteHydrated(false);
    setSyncStatus(accessToken ? 'loading' : 'local');
    remoteValueRef.current = null;
    remoteLoadSucceededRef.current = false;
    hasLocalOverrideRef.current = false;
  }, [accessToken, scope]);

  useEffect(() => {
    if (!accessToken) {
      setHasRemoteHydrated(true);
      setSyncStatus('local');
      return;
    }

    setSyncStatus('loading');
    const abortController = new AbortController();
    const queryString = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    void fetch(`${gatewayUrl}/settings/companion${queryString}`, {
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('load failed')),
      )
      .then((data: CompanionSettingsResponse) => {
        const remotePreferences: BuddyVoicePreferencesState = {
          enabled: data.preferences?.enabled !== false,
          injectionMode: normalizeInjectionMode(data.preferences?.injectionMode),
          muted: data.preferences?.muted === true,
          quietMode: data.preferences?.verbosity === 'minimal',
          reducedMotion: data.preferences?.reducedMotion === true,
          voiceOutputEnabled: data.preferences?.voiceOutputEnabled === true,
          voiceOutputMode: data.preferences?.voiceOutputMode ?? 'buddy_only',
          voiceRate: data.preferences?.voiceRate ?? 1.02,
          voiceVariant: data.preferences?.voiceVariant ?? 'system',
        };
        remoteValueRef.current = serializeRemotePreferences(remotePreferences);
        setActiveBinding(data.activeBinding);
        setBindings(normalizeBuddyBindings(data.bindings));
        setCompanionFeatureMode(
          data.feature?.mode ?? (data.feature?.enabled === false ? 'off' : 'beta'),
        );
        setProfile(data.profile ?? null);
        remoteLoadSucceededRef.current = true;
        if (!hasLocalOverrideRef.current) {
          setPreferences(remotePreferences);
        }
        setSyncStatus('synced');
      })
      .catch(() => {
        setSyncStatus('error');
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setHasRemoteHydrated(true);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [accessToken, agentId, gatewayUrl, serializeRemotePreferences]);

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') {
      return;
    }

    try {
      globalThis.window.localStorage.setItem(buildStorageKey(scope), JSON.stringify(preferences));
    } catch {
      return;
    }
  }, [preferences, scope]);

  useEffect(() => {
    if (!accessToken || !hasRemoteHydrated) {
      return;
    }

    const nextSerializedPreferences = serializeRemotePreferences(preferences);
    if (remoteValueRef.current === nextSerializedPreferences) {
      return;
    }

    if (!remoteLoadSucceededRef.current && !hasLocalOverrideRef.current) {
      return;
    }

    setSyncStatus('saving');
    const requestSeq = saveSeqRef.current + 1;
    saveSeqRef.current = requestSeq;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      const queuedSave = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const queryString = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
          const response = await fetch(`${gatewayUrl}/settings/companion${queryString}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              preferences: {
                enabled: preferences.enabled,
                injectionMode: preferences.injectionMode,
                muted: preferences.muted,
                reducedMotion: preferences.reducedMotion,
                verbosity: preferences.quietMode ? 'minimal' : 'normal',
                voiceOutputEnabled: preferences.voiceOutputEnabled,
                voiceOutputMode: preferences.voiceOutputMode,
                voiceRate: preferences.voiceRate,
                voiceVariant: preferences.voiceVariant,
              },
            }),
          });

          if (!response.ok) {
            throw new Error('save failed');
          }

          const data = (await response.json()) as CompanionSettingsResponse;
          setActiveBinding(data.activeBinding);
          setBindings(normalizeBuddyBindings(data.bindings));

          if (requestSeq !== saveSeqRef.current) {
            return;
          }

          remoteValueRef.current = nextSerializedPreferences;
          hasLocalOverrideRef.current = false;
          remoteLoadSucceededRef.current = true;
          setProfile(data.profile ?? null);
          setCompanionFeatureMode(
            data.feature?.mode ?? (data.feature?.enabled === false ? 'off' : 'beta'),
          );
          setSyncStatus('synced');
        });

      saveQueueRef.current = queuedSave.then(
        () => undefined,
        () => undefined,
      );

      queuedSave.catch(() => {
        if (requestSeq === saveSeqRef.current) {
          setSyncStatus('error');
        }
      });
    }, REMOTE_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    accessToken,
    agentId,
    gatewayUrl,
    hasRemoteHydrated,
    preferences,
    serializeRemotePreferences,
  ]);

  const persistBindings = useCallback(
    async (nextBindings: BuddyAgentBindings) => {
      if (!accessToken) {
        setBindings(nextBindings);
        return;
      }

      const queryString = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      setSyncStatus('saving');
      const response = await fetch(`${gatewayUrl}/settings/companion${queryString}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bindings: nextBindings,
        }),
      });

      if (!response.ok) {
        throw new Error('save failed');
      }

      const data = (await response.json()) as CompanionSettingsResponse;
      setActiveBinding(data.activeBinding);
      setBindings(normalizeBuddyBindings(data.bindings));
      setProfile(data.profile ?? null);
      setCompanionFeatureMode(
        data.feature?.mode ?? (data.feature?.enabled === false ? 'off' : 'beta'),
      );
      setSyncStatus('synced');
    },
    [accessToken, agentId, gatewayUrl],
  );

  const saveAgentBinding = useCallback(
    async (targetAgentId: string, binding: CompanionAgentBinding) => {
      const normalizedAgentId = normalizeAgentId(targetAgentId);
      if (!normalizedAgentId) {
        return;
      }

      const nextBindings = {
        ...bindings,
        [normalizedAgentId]: binding,
      };
      await persistBindings(nextBindings);
    },
    [bindings, persistBindings],
  );

  const removeAgentBinding = useCallback(
    async (targetAgentId: string) => {
      const normalizedAgentId = normalizeAgentId(targetAgentId);
      if (!normalizedAgentId) {
        return;
      }

      const nextBindings = { ...bindings };
      delete nextBindings[normalizedAgentId];
      await persistBindings(nextBindings);
    },
    [bindings, persistBindings],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const syncStatusLabel = useMemo(() => {
    switch (syncStatus) {
      case 'local':
        return '仅本地保存';
      case 'loading':
        return '读取中';
      case 'saving':
        return '同步中';
      case 'error':
        return '同步失败，先本地生效';
      default:
        return '已同步';
    }
  }, [syncStatus]);

  const isCompanionFeatureEnabled = !accessToken
    ? preferences.enabled
    : hasRemoteHydrated
      ? companionFeatureMode !== 'off' && preferences.enabled
      : preferences.enabled;

  const effectiveVoiceOutputMode = activeBinding?.voiceOutputMode ?? preferences.voiceOutputMode;
  const effectiveVoiceRate = activeBinding?.voiceRate ?? preferences.voiceRate;
  const effectiveVoiceVariant = activeBinding?.voiceVariant ?? preferences.voiceVariant;

  return {
    activeBinding,
    bindings,
    companionFeatureMode,
    effectiveVoiceOutputMode,
    effectiveVoiceRate,
    effectiveVoiceVariant,
    enabled: preferences.enabled,
    injectionMode: preferences.injectionMode,
    isCompanionFeatureEnabled,
    isVoiceOutputFeatureReady: !accessToken || hasRemoteHydrated,
    isVoiceOutputFeatureEnabled: isCompanionFeatureEnabled,
    muted: preferences.muted,
    profile,
    quietMode: preferences.quietMode,
    reducedMotion: preferences.reducedMotion,
    syncStatus,
    syncStatusLabel,
    setEnabled: setEnabledWithTracking,
    setInjectionMode: setInjectionModeWithTracking,
    setMuted: setMutedWithTracking,
    setQuietMode: setQuietModeWithTracking,
    setReducedMotion: setReducedMotionWithTracking,
    voiceOutputEnabled: preferences.voiceOutputEnabled,
    setVoiceOutputEnabled: setVoiceOutputEnabledWithTracking,
    saveAgentBinding,
    removeAgentBinding,
  };
}

export { buildStorageKey, normalizeBuddyBindings, readStoredVoicePreferences, normalizeAgentId };
