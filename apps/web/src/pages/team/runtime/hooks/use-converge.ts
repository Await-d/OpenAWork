/**
 * Converge — 代码库与 spec/plan/tasks 一致性评估 hook。
 *
 * 参考：spec-kit v0.11.2 `/speckit.converge`
 */
import { useState, useCallback } from 'react';
import { createTeamPhaseAClient, type ConvergeResult } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';

export interface UseConvergeState {
  loading: boolean;
  result: ConvergeResult | null;
  error: string | null;
}

export interface UseConvergeReturn extends UseConvergeState {
  runConverge: (sessionId: string) => Promise<void>;
  reset: () => void;
}

export function useConverge(): UseConvergeReturn {
  const [state, setState] = useState<UseConvergeState>({
    loading: false,
    result: null,
    error: null,
  });

  const { accessToken, gatewayUrl } = useAuthStore();

  const runConverge = useCallback(
    async (sessionId: string) => {
      if (!accessToken || !gatewayUrl) {
        setState({ loading: false, result: null, error: '未登录或网关地址未配置' });
        return;
      }

      setState({ loading: true, result: null, error: null });

      try {
        const client = createTeamPhaseAClient(gatewayUrl);
        const result = await client.runConverge(accessToken, sessionId);
        setState({ loading: false, result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ loading: false, result: null, error: message });
      }
    },
    [accessToken, gatewayUrl],
  );

  const reset = useCallback(() => {
    setState({ loading: false, result: null, error: null });
  }, []);

  return { ...state, runConverge, reset };
}
