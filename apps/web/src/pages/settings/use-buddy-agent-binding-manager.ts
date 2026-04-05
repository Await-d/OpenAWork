import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createAgentsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';

export interface BuddyAgentOption {
  id: string;
  label: string;
}

export function useBuddyAgentBindingManager(): {
  agentError: string | null;
  agentLoading: boolean;
  agentOptions: BuddyAgentOption[];
  selectedAgentId: string;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
} {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agentOptions, setAgentOptions] = useState<BuddyAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setAgentOptions([]);
      setSelectedAgentId('');
      setAgentLoading(false);
      setAgentError(null);
      return;
    }

    let cancelled = false;
    setAgentLoading(true);
    setAgentError(null);

    createAgentsClient(gatewayUrl)
      .list(accessToken)
      .then((agents) => {
        if (cancelled) {
          return;
        }

        const nextOptions = agents
          .filter((agent) => agent.enabled)
          .map((agent) => ({ id: agent.id, label: agent.label }));
        setAgentOptions(nextOptions);
        setSelectedAgentId((current) => {
          if (current && nextOptions.some((agent) => agent.id === current)) {
            return current;
          }
          return nextOptions[0]?.id ?? '';
        });
        setAgentLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAgentOptions([]);
        setSelectedAgentId('');
        setAgentError('代理列表读取失败');
        setAgentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

  return {
    agentError,
    agentLoading,
    agentOptions,
    selectedAgentId,
    setSelectedAgentId,
  };
}
