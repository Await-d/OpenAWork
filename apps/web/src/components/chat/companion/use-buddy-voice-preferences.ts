import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useAuthStore } from '../../../stores/auth.js';

const STORAGE_KEY_PREFIX = 'openawork-buddy-voice-output';
const REMOTE_SAVE_DEBOUNCE_MS = 500;

interface CompanionSettingsResponse {
  feature?: {
    enabled?: boolean;
    mode?: 'off' | 'beta' | 'ga';
  };
  preferences?: {
    muted?: boolean;
    verbosity?: 'minimal' | 'normal';
    voiceOutputEnabled?: boolean;
  };
  profile?: unknown;
}

interface BuddyVoicePreferencesState {
  muted: boolean;
  quietMode: boolean;
  voiceOutputEnabled: boolean;
}

type CompanionFeatureMode = 'off' | 'beta' | 'ga';
type PreferenceSyncState = 'local' | 'loading' | 'saving' | 'synced' | 'error';

const DEFAULT_BUDDY_VOICE_PREFERENCES: BuddyVoicePreferencesState = {
  muted: false,
  quietMode: false,
  voiceOutputEnabled: false,
};

function buildStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}:${scope}`;
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
      muted: parsed.muted === true,
      quietMode: parsed.quietMode === true,
      voiceOutputEnabled: parsed.voiceOutputEnabled === true,
    };
  } catch {
    return DEFAULT_BUDDY_VOICE_PREFERENCES;
  }
}

export function useBuddyVoicePreferences(scopeInput: string): {
  companionFeatureMode: CompanionFeatureMode;
  isVoiceOutputFeatureReady: boolean;
  isVoiceOutputFeatureEnabled: boolean;
  muted: boolean;
  quietMode: boolean;
  syncStatus: PreferenceSyncState;
  syncStatusLabel: string;
  setMuted: Dispatch<SetStateAction<boolean>>;
  setQuietMode: Dispatch<SetStateAction<boolean>>;
  voiceOutputEnabled: boolean;
  setVoiceOutputEnabled: Dispatch<SetStateAction<boolean>>;
} {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const scope = useMemo(() => scopeInput.trim().toLowerCase() || 'guest', [scopeInput]);
  const [preferences, setPreferences] = useState<BuddyVoicePreferencesState>(() =>
    readStoredVoicePreferences(scope),
  );
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
        muted: value.muted,
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

  useEffect(() => {
    setPreferences(readStoredVoicePreferences(scope));
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
    void fetch(`${gatewayUrl}/settings/companion`, {
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
          muted: data.preferences?.muted === true,
          quietMode: data.preferences?.verbosity === 'minimal',
          voiceOutputEnabled: data.preferences?.voiceOutputEnabled === true,
        };
        remoteValueRef.current = serializeRemotePreferences(remotePreferences);
        setCompanionFeatureMode(
          data.feature?.mode ?? (data.feature?.enabled === false ? 'off' : 'beta'),
        );
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
  }, [accessToken, gatewayUrl, scope]);

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
    if (!accessToken) {
      return;
    }

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
          const response = await fetch(`${gatewayUrl}/settings/companion`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              preferences: {
                muted: preferences.muted,
                verbosity: preferences.quietMode ? 'minimal' : 'normal',
                voiceOutputEnabled: preferences.voiceOutputEnabled,
              },
            }),
          });

          if (!response.ok) {
            throw new Error('save failed');
          }

          if (requestSeq !== saveSeqRef.current) {
            return;
          }

          remoteValueRef.current = nextSerializedPreferences;
          hasLocalOverrideRef.current = false;
          remoteLoadSucceededRef.current = true;
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
  }, [accessToken, gatewayUrl, hasRemoteHydrated, preferences, serializeRemotePreferences]);

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

  return {
    companionFeatureMode,
    isVoiceOutputFeatureReady: !accessToken || hasRemoteHydrated,
    isVoiceOutputFeatureEnabled: !accessToken
      ? true
      : hasRemoteHydrated && companionFeatureMode !== 'off',
    muted: preferences.muted,
    quietMode: preferences.quietMode,
    syncStatus,
    syncStatusLabel,
    setMuted: setMutedWithTracking,
    setQuietMode: setQuietModeWithTracking,
    voiceOutputEnabled: preferences.voiceOutputEnabled,
    setVoiceOutputEnabled: setVoiceOutputEnabledWithTracking,
  };
}

export { buildStorageKey, readStoredVoicePreferences };
