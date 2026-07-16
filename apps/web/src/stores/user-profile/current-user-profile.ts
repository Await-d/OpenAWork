import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSettingsClient } from '@openAwork/web-client';
import { useEffect } from 'react';
import { useAuthStore } from '../auth/auth.js';

type CurrentUserProfileSyncStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'error';

interface CurrentUserProfileStore {
  email: string | null;
  gatewayUrl: string | null;
  nickname: string | null;
  syncStatus: CurrentUserProfileSyncStatus;
  errorMessage: string | null;
  clear: () => void;
  ensureLoaded: () => Promise<void>;
  saveNickname: (nickname: string | null) => Promise<void>;
}

interface CurrentUserProfilePersistedState {
  email: string | null;
  gatewayUrl: string | null;
  nickname: string | null;
}

const CURRENT_USER_PROFILE_STORAGE_KEY = 'openawork-current-user-profile';

const INITIAL_STATE = {
  email: null,
  gatewayUrl: null,
  nickname: null,
  syncStatus: 'idle' as CurrentUserProfileSyncStatus,
  errorMessage: null,
};

const pendingLoads = new Map<string, Promise<void>>();

function normalizeNickname(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getCurrentUserDisplayName(input: {
  readonly email: string | null | undefined;
  readonly nickname: string | null | undefined;
}): string {
  return normalizeNickname(input.nickname) ?? input.email ?? '你';
}

export const useCurrentUserProfileStore = create<CurrentUserProfileStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      clear: () => set(INITIAL_STATE),
      async ensureLoaded() {
        const authState = useAuthStore.getState();
        const accessToken = authState.accessToken;
        const gatewayUrl = authState.gatewayUrl;
        const authEmail = authState.email;

        if (!accessToken || !gatewayUrl || !authEmail) {
          get().clear();
          return;
        }

        const currentState = get();
        const sameProfileScope =
          currentState.email === authEmail && currentState.gatewayUrl === gatewayUrl;
        if (
          sameProfileScope &&
          (currentState.syncStatus === 'synced' || currentState.syncStatus === 'saving')
        ) {
          return;
        }

        const loadKey = `${gatewayUrl}::${authEmail}`;
        const existingLoad = pendingLoads.get(loadKey);
        if (existingLoad) {
          return existingLoad;
        }

        set({
          email: authEmail,
          gatewayUrl,
          nickname: sameProfileScope ? currentState.nickname : null,
          syncStatus: 'loading',
          errorMessage: null,
        });

        const loadPromise = (async () => {
          try {
            const data = await createSettingsClient(gatewayUrl).getProfile(accessToken);
            const latestAuthState = useAuthStore.getState();
            if (latestAuthState.email !== authEmail || latestAuthState.gatewayUrl !== gatewayUrl) {
              return;
            }
            set({
              email: data.email,
              gatewayUrl,
              nickname: normalizeNickname(data.nickname),
              syncStatus: 'synced',
              errorMessage: null,
            });
          } catch (error) {
            const latestAuthState = useAuthStore.getState();
            if (latestAuthState.email !== authEmail || latestAuthState.gatewayUrl !== gatewayUrl) {
              return;
            }
            set({
              email: authEmail,
              gatewayUrl,
              nickname: sameProfileScope ? currentState.nickname : null,
              syncStatus: 'error',
              errorMessage: error instanceof Error ? error.message : '加载昵称失败。',
            });
          } finally {
            pendingLoads.delete(loadKey);
          }
        })();

        pendingLoads.set(loadKey, loadPromise);
        return loadPromise;
      },
      async saveNickname(nextNickname) {
        const authState = useAuthStore.getState();
        const accessToken = authState.accessToken;
        const gatewayUrl = authState.gatewayUrl;
        const authEmail = authState.email;

        if (!accessToken || !gatewayUrl || !authEmail) {
          throw new Error('未登录，无法保存昵称。');
        }

        const normalizedNickname = normalizeNickname(nextNickname);
        const previousState = get();

        set({
          email: authEmail,
          gatewayUrl,
          nickname: normalizedNickname,
          syncStatus: 'saving',
          errorMessage: null,
        });

        try {
          const data = await createSettingsClient(gatewayUrl).putProfile(accessToken, {
            nickname: normalizedNickname,
          });
          const latestAuthState = useAuthStore.getState();
          if (latestAuthState.email !== authEmail || latestAuthState.gatewayUrl !== gatewayUrl) {
            return;
          }
          set({
            email: data.email,
            gatewayUrl,
            nickname: normalizeNickname(data.nickname),
            syncStatus: 'synced',
            errorMessage: null,
          });
        } catch (error) {
          const latestAuthState = useAuthStore.getState();
          if (latestAuthState.email !== authEmail || latestAuthState.gatewayUrl !== gatewayUrl) {
            return;
          }
          set({
            email: previousState.email,
            gatewayUrl: previousState.gatewayUrl,
            nickname: previousState.nickname,
            syncStatus: 'error',
            errorMessage: error instanceof Error ? error.message : '保存昵称失败。',
          });
          throw error;
        }
      },
    }),
    {
      name: CURRENT_USER_PROFILE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): CurrentUserProfilePersistedState => ({
        email: state.email,
        gatewayUrl: state.gatewayUrl,
        nickname: state.nickname,
      }),
    },
  ),
);

export function useCurrentUserProfileBootstrap(enabled = true): void {
  const accessToken = useAuthStore((state) => state.accessToken);
  const email = useAuthStore((state) => state.email);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const clear = useCurrentUserProfileStore((state) => state.clear);
  const ensureLoaded = useCurrentUserProfileStore((state) => state.ensureLoaded);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!accessToken || !email || !gatewayUrl) {
      clear();
      return;
    }

    void ensureLoaded();
  }, [accessToken, clear, email, enabled, ensureLoaded, gatewayUrl]);
}

export function useCurrentUserDisplayName(): string {
  const email = useAuthStore((state) => state.email);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const profileEmail = useCurrentUserProfileStore((state) => state.email);
  const profileGatewayUrl = useCurrentUserProfileStore((state) => state.gatewayUrl);
  const nickname = useCurrentUserProfileStore((state) => state.nickname);
  const resolvedNickname =
    profileEmail === email && profileGatewayUrl === gatewayUrl ? nickname : null;

  return getCurrentUserDisplayName({ email, nickname: resolvedNickname });
}
