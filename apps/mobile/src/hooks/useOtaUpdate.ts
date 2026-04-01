import { useState, useEffect, useCallback } from 'react';
import * as Updates from 'expo-updates';

export type OtaUpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'up-to-date';

export interface OtaUpdateState {
  status: OtaUpdateStatus;
  errorMessage: string | null;
}

export function useOtaUpdate() {
  const [state, setState] = useState<OtaUpdateState>({ status: 'idle', errorMessage: null });

  const checkAndApply = useCallback(async () => {
    setState({ status: 'checking', errorMessage: null });
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setState({ status: 'up-to-date', errorMessage: null });
        return;
      }
      setState({ status: 'downloading', errorMessage: null });
      await Updates.fetchUpdateAsync();
      setState({ status: 'ready', errorMessage: null });
    } catch (err) {
      setState({ status: 'error', errorMessage: String(err) });
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    await Updates.reloadAsync();
  }, []);

  useEffect(() => {
    if (__DEV__) return;
    const timer = setTimeout(() => {
      void checkAndApply();
    }, 5000);
    return () => clearTimeout(timer);
  }, [checkAndApply]);

  return { state, checkAndApply, applyUpdate };
}
