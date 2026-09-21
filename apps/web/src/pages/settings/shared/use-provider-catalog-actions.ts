import React from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import type { AIProviderRef, ActiveSelectionRef } from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';

interface UseProviderCatalogActionsOptions {
  gatewayUrl: string;
  token: string | null;
  providersRef: React.RefObject<AIProviderRef[]>;
  setProviders: React.Dispatch<React.SetStateAction<AIProviderRef[]>>;
  syncSelectionForProviders: (nextProviders: AIProviderRef[]) => {
    draftSelection: ActiveSelectionRef;
    savedSelection: ActiveSelectionRef;
  };
  activeSelectionRef: React.RefObject<ActiveSelectionRef>;
  setActiveSelection: (updater: React.SetStateAction<ActiveSelectionRef>) => void;
  setSavedActiveSelection: (selection: ActiveSelectionRef) => void;
}

/**
 * Provider 目录相关动作：连通性自检、手动同步目录、发现平台与导入平台。
 */
export function useProviderCatalogActions({
  gatewayUrl,
  token,
  providersRef,
  setProviders,
  syncSelectionForProviders,
  activeSelectionRef,
  setActiveSelection,
  setSavedActiveSelection,
}: UseProviderCatalogActionsOptions) {
  // 连通性自检：用「当前内存里的 provider 配置」(含尚未保存的编辑)对指定模型
  // 发起一次最小化上游调用，返回结构化结果给 ModelManager 的检测按钮显示。
  const handleTestModel = React.useCallback(
    async (
      providerId: string,
      modelId: string,
    ): Promise<{
      ok: boolean;
      status: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
      message: string;
      latencyMs?: number;
    }> => {
      if (!token) {
        return { ok: false, status: 'error', message: '未登录，无法发起检测。' };
      }
      const provider = providersRef.current.find((item) => item.id === providerId);
      if (!provider) {
        return { ok: false, status: 'error', message: '未找到该 provider，请先保存配置。' };
      }
      try {
        const result = (await createSettingsClient(gatewayUrl).testProvider(token, {
          modelId,
          // 传内联 provider，测「尚未保存」的表单值；带上 createdAt/updatedAt 占位
          // 以满足网关 schema(后端会重新规整)。
          provider: {
            ...provider,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })) as {
          ok?: boolean;
          status?: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
          message?: string;
          latencyMs?: number;
        };
        return {
          ok: result.ok === true,
          status: result.status ?? (result.ok ? 'ok' : 'error'),
          message: result.message ?? (result.ok ? '连接正常' : '检测失败'),
          ...(typeof result.latencyMs === 'number' ? { latencyMs: result.latencyMs } : {}),
        };
      } catch (error: unknown) {
        return {
          ok: false,
          status: 'error',
          message: error instanceof Error ? error.message : '检测请求失败',
        };
      }
    },
    [token, gatewayUrl],
  );

  // 手动同步内置模型目录：触发网关从 models.dev 重新拉取，成功后重新加载 provider
  // 列表，使新模型 / 更新后的上下文与价格即时反映到表格里。
  const handleSyncCatalog = React.useCallback(async (): Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }> => {
    if (!token) {
      return { ok: false, message: '未登录，无法同步模型目录。' };
    }
    const settingsClient = createSettingsClient(gatewayUrl);
    try {
      const result = await settingsClient.syncModelsCatalog(token);
      if (!result.ok) {
        return { ok: false, message: result.message ?? '同步失败' };
      }
      // 同步成功后拉取最新 provider 列表（网关已对 catalog 缓存做了失效）。
      // 仅刷新模型清单，不动用户尚未保存的默认选择草稿。
      try {
        const data = (await settingsClient.getProviders(token)) as {
          providers: AIProviderRef[] | null;
        };
        if (data.providers) {
          providersRef.current = data.providers;
          setProviders(data.providers);
        }
      } catch (reloadError) {
        logger.error('failed to reload providers after catalog sync', reloadError);
      }
      return {
        ok: true,
        ...(typeof result.providerCount === 'number'
          ? { providerCount: result.providerCount }
          : {}),
        ...(typeof result.modelCount === 'number' ? { modelCount: result.modelCount } : {}),
      };
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '同步请求失败',
      };
    }
  }, [token, gatewayUrl]);

  const handleDiscoverProviders = React.useCallback(async (): Promise<{
    providers: Array<{
      id: string;
      name: string;
      api?: string;
      modelCount: number;
      sampleModels?: Array<{ id: string; name: string }>;
    }>;
  }> => {
    if (!token) {
      throw new Error('未登录，无法发现平台。');
    }
    const data = (await createSettingsClient(gatewayUrl).discoverProviders(token)) as {
      providers?: Array<{
        id: string;
        name: string;
        api?: string;
        modelCount: number;
        sampleModels?: Array<{ id: string; name: string }>;
      }>;
    };
    return { providers: data.providers ?? [] };
  }, [token, gatewayUrl]);

  const handleImportDiscoveredProvider = React.useCallback(
    async (modelsDevProviderId: string): Promise<void> => {
      if (!token) {
        throw new Error('未登录，无法导入平台。');
      }
      const data = (await createSettingsClient(gatewayUrl).importProviderFromModelsDev(token, {
        modelsDevProviderId,
      })) as {
        providers?: AIProviderRef[];
        activeSelection?: ActiveSelectionRef;
      };
      if (data.providers) {
        providersRef.current = data.providers;
        setProviders(data.providers);
        const { draftSelection, savedSelection } = syncSelectionForProviders(data.providers);
        if (data.activeSelection) {
          activeSelectionRef.current = data.activeSelection;
          setActiveSelection(data.activeSelection);
          setSavedActiveSelection(data.activeSelection);
        } else {
          activeSelectionRef.current = draftSelection;
          setActiveSelection(draftSelection);
          setSavedActiveSelection(savedSelection);
        }
      }
    },
    [token, gatewayUrl, syncSelectionForProviders],
  );

  return {
    handleTestModel,
    handleSyncCatalog,
    handleDiscoverProviders,
    handleImportDiscoveredProvider,
  };
}
