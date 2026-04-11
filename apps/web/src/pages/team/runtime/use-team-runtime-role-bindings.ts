import { useEffect, useMemo, useState } from 'react';
import { createAgentsClient, createCapabilitiesClient } from '@openAwork/web-client';
import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth.js';

const EXECUTION_ROLES: CoreRole[] = ['planner', 'researcher', 'executor', 'reviewer'];

const ROLE_LABELS: Record<CoreRole, string> = {
  general: '通用',
  planner: '规划',
  researcher: '研究',
  executor: '执行',
  reviewer: '审查',
};

export function useTeamRuntimeRoleBindings() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agents, setAgents] = useState<ManagedAgentRecord[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Partial<Record<CoreRole, string>>>({});

  useEffect(() => {
    if (!accessToken) {
      setAgents([]);
      setCapabilities([]);
      setBindings({});
      setLoading(false);
      return;
    }

    const agentsClient = createAgentsClient(gatewayUrl);
    const capabilitiesClient = createCapabilitiesClient(gatewayUrl);
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([agentsClient.list(accessToken), capabilitiesClient.list(accessToken)])
      .then(([nextAgents, nextCapabilities]) => {
        if (cancelled) {
          return;
        }
        setAgents(nextAgents);
        setCapabilities(nextCapabilities);
        setBindings((current) => {
          const nextBindings = { ...current };
          for (const role of EXECUTION_ROLES) {
            if (nextBindings[role]) {
              continue;
            }

            const suggested = nextAgents.find(
              (agent) => agent.enabled && agent.canonicalRole?.coreRole === role,
            );
            if (suggested) {
              nextBindings[role] = suggested.id;
            }
          }
          return nextBindings;
        });
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '加载执行角色绑定数据失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

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
    setBinding(role: CoreRole, agentId: string) {
      setBindings((current) => ({
        ...current,
        [role]: agentId || undefined,
      }));
    },
  };
}
