import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createResourcesClient,
  type ResourceCatalog,
  type UploadResourceInput,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';

export interface ResourceCatalogState {
  readonly resources: ResourceCatalog;
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly deletingId: string | null;
  readonly error: string | null;
  readonly reload: () => void;
  readonly uploadResource: (input: UploadResourceInput) => Promise<void>;
  readonly removeResource: (resourceId: string) => Promise<void>;
}

const EMPTY_RESOURCE_CATALOG: ResourceCatalog = {
  skills: [],
  agents: [],
  agentTemplates: [],
  commands: [],
  souls: [],
  prompts: [],
  extensions: [],
  mcps: [],
};

export function useResourceCatalog(): ResourceCatalogState {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const accessToken = useAuthStore((state) => state.accessToken);
  const client = useMemo(() => createResourcesClient(gatewayUrl), [gatewayUrl]);
  const [resources, setResources] = useState<ResourceCatalog>(EMPTY_RESOURCE_CATALOG);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((current) => current + 1), []);

  useEffect(() => {
    if (!accessToken) {
      setResources(EMPTY_RESOURCE_CATALOG);
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
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setResources(result.resources);
          setError(null);
        } else {
          setResources(EMPTY_RESOURCE_CATALOG);
          setError(result.errorMessage ?? '加载资源目录失败');
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        setResources(EMPTY_RESOURCE_CATALOG);
        setError(reason instanceof Error ? reason.message : '加载资源目录失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, client, tick]);

  const uploadResource = useCallback(
    async (input: UploadResourceInput): Promise<void> => {
      if (!accessToken) {
        setError('请先登录后再上传资源。');
        throw new Error('请先登录后再上传资源。');
      }
      setMutating(true);
      setError(null);
      try {
        setResources(await client.upload(accessToken, input));
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : '上传资源失败';
        setError(message);
        throw new Error(message);
      } finally {
        setMutating(false);
      }
    },
    [accessToken, client],
  );

  const removeResource = useCallback(
    async (resourceId: string): Promise<void> => {
      if (!accessToken) {
        setError('请先登录后再删除资源。');
        throw new Error('请先登录后再删除资源。');
      }
      setDeletingId(resourceId);
      setError(null);
      try {
        setResources(await client.remove(accessToken, resourceId));
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : '删除资源失败';
        setError(message);
        throw new Error(message);
      } finally {
        setDeletingId(null);
      }
    },
    [accessToken, client],
  );

  return {
    resources,
    loading,
    mutating,
    deletingId,
    error,
    reload,
    uploadResource,
    removeResource,
  };
}
