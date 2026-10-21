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

/**
 * 资源目录变更（上传 / 删除）的统一包装：置 busy / 清 error → try → catch 归一文案并
 * **重新抛出** → finally 清 busy。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 2 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬（含 catch 里的 `throw new Error(message)`）。
 */
async function runResourceCatalogActionOnce<T>(ctx: {
  setBusy: (value: T) => void;
  busyValue: T;
  idleValue: T;
  setError: (message: string | null) => void;
  /** catch 的兜底文案（`reason.message` 优先）。 */
  failureMessage: string;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setBusy(ctx.busyValue);
  ctx.setError(null);
  try {
    await ctx.run();
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : ctx.failureMessage;
    ctx.setError(message);
    throw new Error(message);
  } finally {
    ctx.setBusy(ctx.idleValue);
  }
}

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
      // 置 busy / 清 error 与 try/catch/finally 一起下沉到模块级
      // `runResourceCatalogActionOnce`（见其注释：catch 会写 error 并重新抛出）。
      await runResourceCatalogActionOnce<boolean>({
        setBusy: setMutating,
        busyValue: true,
        idleValue: false,
        setError,
        failureMessage: '上传资源失败',
        run: async () => {
          setResources(await client.upload(accessToken, input));
        },
      });
    },
    [accessToken, client],
  );

  const removeResource = useCallback(
    async (resourceId: string): Promise<void> => {
      if (!accessToken) {
        setError('请先登录后再删除资源。');
        throw new Error('请先登录后再删除资源。');
      }
      // 同 uploadResource：整段下沉到 `runResourceCatalogActionOnce`（见其注释）。
      await runResourceCatalogActionOnce<string | null>({
        setBusy: setDeletingId,
        busyValue: resourceId,
        idleValue: null,
        setError,
        failureMessage: '删除资源失败',
        run: async () => {
          setResources(await client.remove(accessToken, resourceId));
        },
      });
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
