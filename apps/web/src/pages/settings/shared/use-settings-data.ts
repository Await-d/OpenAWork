import React, { useEffect, useRef, useState } from 'react';
import {
  createChannelsClient,
  createGitHubClient,
  createSettingsClient,
  createUsageClient,
} from '@openAwork/web-client';
import type {
  AIProviderRef,
  ActiveSelectionRef,
  AttributionConfig,
  CostBreakdownItem,
  ImageGenerationDefaultsRef,
  MonthlyRecord,
  PermissionCategoryMeta,
  PermissionDecisionRecord,
  PermissionRuleEntry,
  ModelPriceEntry,
  ProviderCatalogUiEntry,
} from '@openAwork/shared-ui';
import { hydrateProviderCatalogUi } from '@openAwork/shared-ui';
import type {
  ChannelSettingsEntry,
  ChannelTypeDescriptor,
} from '../../../components/common/display/ChannelSubscriptionSettings.js';
import { logger } from '../../../utils/log/logger.js';
import { normalizeSettingsModelPrices } from '../usage/usage-data.js';
import { createInitialDevtoolsSourceStates } from '../state/settings-derived.js';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SubagentLimitsRef,
  SubagentModelPolicyRef,
  ThinkingDefaultsRef,
} from '../state/settings-types.js';

interface UseSettingsDataOptions {
  gatewayUrl: string;
  token: string | null;
  providersRef: React.RefObject<AIProviderRef[]>;
  setProviders: React.Dispatch<React.SetStateAction<AIProviderRef[]>>;
  applyServerDefaults: (
    input: {
      activeSelection?: ActiveSelectionRef | null;
      defaultThinking?: ThinkingDefaultsRef | null;
      imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
      subagentModelPolicy?: SubagentModelPolicyRef | null;
      subagentLimits?: SubagentLimitsRef | null;
    },
    options?: {
      syncDraft?: boolean;
      syncSaved?: boolean;
    },
  ) => void;
  loadDevLogs: () => Promise<void>;
  loadWorkers: () => Promise<void>;
  loadDiagnostics: () => Promise<void>;
  loadDesktopAutomationStatus: () => Promise<void>;
  loadDesktopControlStatus: () => Promise<void>;
  loadSshConnections: () => Promise<void>;
  loadUpstreamRetrySettings: () => Promise<void>;
  setDevtoolsSourceStates: React.Dispatch<
    React.SetStateAction<Record<DevtoolsSourceKey, DevtoolsSourceState>>
  >;
}

/**
 * Settings 页的非 provider/devtools 数据装配：用量、费用、权限、模型价格、
 * 通道、GitHub 触发器、文件模式，以及页面挂载时的统一引导 effect。
 */
export function useSettingsData({
  gatewayUrl,
  token,
  providersRef,
  setProviders,
  applyServerDefaults,
  loadDevLogs,
  loadWorkers,
  loadDiagnostics,
  loadDesktopAutomationStatus,
  loadDesktopControlStatus,
  loadSshConnections,
  loadUpstreamRetrySettings,
  setDevtoolsSourceStates,
}: UseSettingsDataOptions) {
  const [filePatterns, setFilePatterns] = useState<string[]>([]);
  const [githubTriggers, setGithubTriggers] = useState<Array<{ repo: string; events: string[] }>>(
    [],
  );
  const [attribution, setAttribution] = useState<AttributionConfig>({
    coAuthoredBy: false,
    assistedBy: false,
    authorName: '',
  });
  const [usageRecords, setUsageRecords] = useState<MonthlyRecord[]>([]);
  const [usageBudget, setUsageBudget] = useState(10);
  const [monthlyCostUsd, setMonthlyCostUsd] = useState(0);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdownItem[]>([]);
  const [usageRecordsError, setUsageRecordsError] = useState<string | null>(null);
  const [costBreakdownError, setCostBreakdownError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionDecisionRecord[]>([]);
  const [permissionRules, setPermissionRules] = useState<PermissionRuleEntry[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategoryMeta[]>([]);
  const [permissionRulesSaving, setPermissionRulesSaving] = useState(false);
  const [priceModels, setPriceModels] = useState<ModelPriceEntry[]>([]);
  const [priceModelsError, setPriceModelsError] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSettingsEntry[]>([]);
  const [channelDescriptors, setChannelDescriptors] = useState<ChannelTypeDescriptor[]>([]);
  const [channelDescriptorsLoadError, setChannelDescriptorsLoadError] = useState<string | null>(
    null,
  );
  const [channelsLoadError, setChannelsLoadError] = useState<string | null>(null);
  const hasLoadedFilePatterns = useRef(false);

  useEffect(() => {
    if (!hasLoadedFilePatterns.current) return;
    if (!token) return;
    const timer = setTimeout(() => {
      void createSettingsClient(gatewayUrl)
        .putFilePatterns(token, filePatterns)
        .catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [filePatterns, gatewayUrl, token]);

  useEffect(() => {
    if (!token) return;
    setDevtoolsSourceStates(createInitialDevtoolsSourceStates());
    const settingsClient = createSettingsClient(gatewayUrl);
    const usageClient = createUsageClient(gatewayUrl);
    const channelsClient = createChannelsClient<ChannelSettingsEntry, ChannelTypeDescriptor>(
      gatewayUrl,
    );
    const githubClient = createGitHubClient(gatewayUrl);

    // 用网关 catalog(单一事实来源)刷新前端 UI 注册表，使新增平台的 logo/名称/
    // 上游变体无需改前端即可显示。失败时静默回退到内置静态兜底。
    void settingsClient
      .getProviderCatalog(token)
      .then((data) => {
        const entries = (data as { catalog?: ProviderCatalogUiEntry[] }).catalog;
        if (entries) {
          hydrateProviderCatalogUi(entries);
        }
      })
      .catch(() => undefined);

    void settingsClient
      .getProviders(token)
      .then((data) => {
        const typed = data as {
          providers: AIProviderRef[] | null;
          activeSelection?: ActiveSelectionRef | null;
          defaultThinking?: ThinkingDefaultsRef | null;
          imageGenerationDefaults?: ImageGenerationDefaultsRef | null;
          subagentModelPolicy?: SubagentModelPolicyRef | null;
          subagentLimits?: SubagentLimitsRef | null;
        };
        if (typed.providers) {
          providersRef.current = typed.providers;
          setProviders(typed.providers);
        }
        applyServerDefaults(
          {
            activeSelection: typed.activeSelection,
            defaultThinking: typed.defaultThinking,
            imageGenerationDefaults: typed.imageGenerationDefaults,
            subagentModelPolicy: typed.subagentModelPolicy,
            subagentLimits: typed.subagentLimits,
          },
          { syncDraft: true, syncSaved: true },
        );
      })
      .catch(() => undefined);
    void usageClient
      .getRecords(token)
      .then((d) => {
        setUsageRecords((d.records as MonthlyRecord[]) ?? []);
        setUsageBudget(d.budgetUsd ?? 0);
        setUsageRecordsError(null);
      })
      .catch((error: unknown) => {
        setUsageRecords([]);
        setUsageBudget(0);
        setUsageRecordsError(error instanceof Error ? error.message : '加载用量记录失败');
        logger.error('failed to load usage records', error);
      });
    void usageClient
      .getBreakdown(token)
      .then((d) => {
        setMonthlyCostUsd(d.monthlyCostUsd ?? 0);
        setCostBreakdown(d.breakdown ?? []);
        setCostBreakdownError(null);
      })
      .catch((error: unknown) => {
        setMonthlyCostUsd(0);
        setCostBreakdown([]);
        setCostBreakdownError(error instanceof Error ? error.message : '加载费用明细失败');
        logger.error('failed to load usage breakdown', error);
      });
    void settingsClient
      .getPermissionRules(token)
      .then((d) => {
        const typed = d as {
          rules: PermissionRuleEntry[];
          categories: PermissionCategoryMeta[];
        };
        setPermissionRules(typed.rules ?? []);
        if (typed.categories?.length) setPermissionCategories(typed.categories);
      })
      .catch(() => setPermissionRules([]));
    void settingsClient
      .getPermissionDecisions(token)
      .then((d) => {
        const typed = d as { decisions: PermissionDecisionRecord[] };
        setPermissions(
          (typed.decisions ?? []).map((decision) => ({
            ...decision,
            scope:
              (decision as PermissionDecisionRecord & { sessionId?: string; requestId?: string })
                .sessionId ??
              (decision as PermissionDecisionRecord & { requestId?: string }).requestId ??
              'settings',
            timestamp: Date.now(),
            riskLevel: 'low',
          })),
        );
      })
      .catch(() => undefined);
    void loadDevLogs();
    void loadWorkers();
    void loadDiagnostics();
    void settingsClient
      .getModelPrices(token)
      .then((d) => {
        const typed = d as { models?: unknown };
        setPriceModels(normalizeSettingsModelPrices(typed.models));
        setPriceModelsError(null);
      })
      .catch((error: unknown) => {
        setPriceModels([]);
        setPriceModelsError(error instanceof Error ? error.message : '加载模型费用配置失败');
        logger.error('failed to load settings model prices', error);
      });
    void loadDesktopAutomationStatus();
    void loadDesktopControlStatus();
    void loadSshConnections();
    void settingsClient
      .getFilePatterns(token)
      .then((d) => {
        const typed = d as { patterns: string[] };
        setFilePatterns(typed.patterns ?? []);
        hasLoadedFilePatterns.current = true;
      })
      .catch(() => {
        hasLoadedFilePatterns.current = true;
      });
    void githubClient
      .listTriggers(token)
      .then((triggers) => setGithubTriggers(triggers))
      .catch(() => undefined);
    void loadUpstreamRetrySettings().catch(() => undefined);
    void channelsClient
      .list(token)
      .then((data) => {
        setChannelsLoadError(null);
        setChannels(data ?? []);
      })
      .catch((error: unknown) => {
        setChannels([]);
        setChannelsLoadError(error instanceof Error ? error.message : '加载通道失败');
        logger.error('failed to load channels', error);
      });
    void channelsClient
      .listDescriptors(token)
      .then((data) => {
        setChannelDescriptorsLoadError(null);
        setChannelDescriptors(data ?? []);
      })
      .catch((error: unknown) => {
        setChannelDescriptors([]);
        setChannelDescriptorsLoadError(error instanceof Error ? error.message : '加载通道模板失败');
        logger.error('failed to load channel descriptors', error);
      });
  }, [
    gatewayUrl,
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadDevLogs,
    loadDiagnostics,
    loadUpstreamRetrySettings,
    loadSshConnections,
    loadWorkers,
    token,
  ]);

  function handlePermissionRulesChange(rules: PermissionRuleEntry[]) {
    setPermissionRules(rules);
    setPermissionRulesSaving(true);
    if (!token) {
      setPermissionRulesSaving(false);
      return;
    }
    void createSettingsClient(gatewayUrl)
      .putPermissionRules(token, { rules })
      .catch((error: unknown) => {
        logger.error('failed to save permission rules', error);
      })
      .finally(() => setPermissionRulesSaving(false));
  }

  return {
    filePatterns,
    setFilePatterns,
    githubTriggers,
    setGithubTriggers,
    attribution,
    setAttribution,
    usageRecords,
    usageBudget,
    monthlyCostUsd,
    costBreakdown,
    usageRecordsError,
    costBreakdownError,
    permissions,
    permissionCategories,
    permissionRules,
    permissionRulesSaving,
    priceModels,
    priceModelsError,
    channels,
    setChannels,
    channelDescriptors,
    channelDescriptorsLoadError,
    channelsLoadError,
    handlePermissionRulesChange,
  };
}
