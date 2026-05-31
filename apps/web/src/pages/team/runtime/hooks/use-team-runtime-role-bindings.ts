import { useEffect, useMemo, useRef, useState } from 'react';
import { createAgentsClient, createCapabilitiesClient } from '@openAwork/web-client';
import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, FIXED_TEAM_CORE_ROLE_ORDER } from '@openAwork/shared';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../hooks/use-recoverable-retry.js';

const EXECUTION_ROLES: CoreRole[] = [...FIXED_TEAM_CORE_ROLE_ORDER];

const ROLE_LABELS: Record<CoreRole, string> = {
  general: '通用',
  leader: '领导',
  planner: '规划',
  researcher: '研究',
  executor: '执行',
  reviewer: '审查',
};

const TEAM_ROLE_BINDINGS_RETRY_BASE_MS = 2_000;
const TEAM_ROLE_BINDINGS_RETRY_MAX_MS = 30_000;

export function computeTeamRoleBindingsRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_ROLE_BINDINGS_RETRY_BASE_MS,
    maxMs: TEAM_ROLE_BINDINGS_RETRY_MAX_MS,
  });
}

export function formatTeamRoleBindingsLoadError(input: {
  hasCachedData: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载执行角色绑定数据失败。',
    hasRetainedData: input.hasCachedData,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '角色绑定数据',
    retryable: input.result.retryable,
  });
}

export function useTeamRuntimeRoleBindings() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agents, setAgents] = useState<ManagedAgentRecord[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Partial<Record<CoreRole, string>>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const agentsRef = useRef<ManagedAgentRecord[]>([]);
  const capabilitiesRef = useRef<CapabilityDescriptor[]>([]);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const {
    clearRetry,
    resetRetry,
    scheduleRetry,
  } = useRecoverableRetryController();

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    capabilitiesRef.current = capabilities;
  }, [capabilities]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!accessToken) {
      resetRetry();
      setAgents([]);
      setCapabilities([]);
      setBindings({});
      setLoading(false);
      setError(null);
      return;
    }

    const hasCachedData = agentsRef.current.length > 0 || capabilitiesRef.current.length > 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamRoleBindingsLoadError({
          hasCachedData,
          result: {
            errorMessage: '当前网络离线，执行角色绑定数据暂时不可用。',
            retryable: true,
          },
        }),
      );
      return;
    }

    const agentsClient = createAgentsClient(gatewayUrl);
    const capabilitiesClient = createCapabilitiesClient(gatewayUrl);
    setLoading(!hasCachedData);
    setError(null);

    void Promise.all([
      agentsClient.listResult(accessToken),
      capabilitiesClient.listResult(accessToken),
    ]).then(([agentsResult, capabilitiesResult]) => {
      if (cancelled) {
        return;
      }

      if (agentsResult.ok) {
        setAgents(agentsResult.agents);
      }
      if (capabilitiesResult.ok) {
        setCapabilities(capabilitiesResult.capabilities);
      }
      if (agentsResult.ok || capabilitiesResult.ok) {
        setBindings((current) =>
          Object.keys(current).length > 0 ? current : { ...FIXED_TEAM_CORE_ROLE_BINDINGS },
        );
      }

      const failedResult = !agentsResult.ok ? agentsResult : !capabilitiesResult.ok ? capabilitiesResult : null;
      if (failedResult) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamRoleBindingsRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: failedResult.retryable,
        });
        setLoading(false);
        setError(
          formatTeamRoleBindingsLoadError({
            hasCachedData:
              agentsResult.ok ||
              capabilitiesResult.ok ||
              agentsRef.current.length > 0 ||
              capabilitiesRef.current.length > 0,
            nextRetryAtMs,
            result: failedResult,
          }),
        );
        return;
      }

      resetRetry();
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    clearRetry,
    gatewayUrl,
    refreshTick,
    resetRetry,
    scheduleRetry,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!accessToken || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      resetRetry();
      setRefreshTick((current) => current + 1);
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamRoleBindingsLoadError({
          hasCachedData: agentsRef.current.length > 0 || capabilitiesRef.current.length > 0,
          result: {
            errorMessage: '当前网络离线，执行角色绑定数据暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, resetRetry]);

  useEffect(() => {
    if (!accessToken || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [accessToken, resetRetry, teamEventsRecoveredAt]);

  const roleCards = useMemo(
    () =>
      EXECUTION_ROLES.map((role) => {
        const selectedAgentId = bindings[role] ?? '';
        const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
        const recommendedCapabilities = capabilities.filter(
          (capability) => capability.canonicalRole?.coreRole === role,
        );

        return {
          role,
          roleLabel: ROLE_LABELS[role],
          selectedAgentId,
          selectedAgent,
          recommendedCapabilities,
        };
      }),
    [agents, bindings, capabilities],
  );

  return {
    agents,
    error,
    loading,
    roleCards,
  };
}
