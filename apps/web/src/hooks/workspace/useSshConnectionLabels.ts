import { useEffect, useMemo, useState } from 'react';
import { createSshClient, type SSHConnectionEntry } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { logger } from '../../utils/log/logger.js';

export interface SshConnectionSummary {
  id: string;
  /** 展示名：优先用户自定义名称，其次 `user@host:port`。 */
  label: string;
  /** 连接端点（`user@host:port`），用于悬浮提示。 */
  endpoint: string;
  status: SSHConnectionEntry['status'];
}

/** 连接 id → 摘要信息；未加载或加载失败时为空 Map。 */
export type SshConnectionLabelMap = ReadonlyMap<string, SshConnectionSummary>;

const EMPTY_LABEL_MAP: SshConnectionLabelMap = new Map();

function toSummary(entry: SSHConnectionEntry): SshConnectionSummary {
  const endpoint = `${entry.username}@${entry.host}:${entry.port}`;
  const customName = entry.name?.trim();

  return {
    id: entry.id,
    label: customName && customName.length > 0 ? customName : endpoint,
    endpoint,
    status: entry.status,
  };
}

/**
 * 拉取当前用户的 SSH 连接列表，供会话列表渲染远端工作区标识。
 *
 * 只在 `enabled` 为真（列表里确实存在 SSH 会话）时请求，避免无 SSH 用户的
 * 侧栏每次挂载都多打一次网关。加载失败仅降级为「显示 SSH 而不显示连接名」，
 * 不阻塞会话列表渲染。
 */
export function useSshConnectionLabels(enabled: boolean): SshConnectionLabelMap {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [labels, setLabels] = useState<SshConnectionLabelMap>(EMPTY_LABEL_MAP);

  useEffect(() => {
    if (!enabled || !accessToken) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    void createSshClient(gatewayUrl)
      .list(accessToken, { signal: controller.signal })
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setLabels(new Map(entries.map((entry) => [entry.id, toSummary(entry)])));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        logger.warn('failed to list ssh connections for session list badge', error);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, enabled, gatewayUrl]);

  return useMemo(() => labels, [labels]);
}
