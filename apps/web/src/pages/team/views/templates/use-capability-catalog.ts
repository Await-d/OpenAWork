/**
 * 加载用户「已安装 / 启用」的能力目录（skills + MCP servers），供模板成员的
 * 初始能力绑定选择器使用。复用网关 /capabilities 端点（已只返回实际可用项）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCapabilitiesClient } from '@openAwork/web-client';
import type { CapabilityDescriptor } from '@openAwork/shared';
import { useAuthStore } from '../../../../stores/auth/auth.js';

export interface CapabilityOption {
  id: string;
  label: string;
  description?: string;
}

export interface CapabilityCatalogState {
  skills: CapabilityOption[];
  mcpServers: CapabilityOption[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function toOption(c: CapabilityDescriptor): CapabilityOption {
  return {
    id: c.id,
    label: c.label,
    ...(c.description ? { description: c.description } : {}),
  };
}

export function useCapabilityCatalog(): CapabilityCatalogState {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const client = useMemo(() => createCapabilitiesClient(gatewayUrl), [gatewayUrl]);
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!accessToken) {
      setCapabilities([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .listResult(accessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setCapabilities(result.capabilities);
          setError(null);
        } else {
          setError(result.errorMessage ?? '加载能力列表失败');
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '加载能力列表失败');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, client, tick]);

  const skills = useMemo(
    () =>
      capabilities
        .filter((c) => c.kind === 'skill' && c.enabled !== false)
        .map(toOption),
    [capabilities],
  );
  const mcpServers = useMemo(
    () =>
      capabilities
        .filter((c) => c.kind === 'mcp' && c.enabled !== false)
        .map(toOption),
    [capabilities],
  );

  return { skills, mcpServers, loading, error, reload };
}
