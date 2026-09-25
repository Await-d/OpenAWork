import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { createSettingsClient } from '@openAwork/web-client';
import type { AIProviderRef, MCPServerEntry } from '@openAwork/shared-ui';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useCompactSettingsLayout } from '../shared/use-compact-settings-layout.js';
import { resolvePersistableMcpServerSource } from '../connection/mcp-server-source-utils.js';
import { useSettingsWebsearch } from '../connection/use-settings-websearch.js';
import { useMcpServers } from '../connection/use-mcp-servers.js';
import { ImageGenerationPluginPanel } from './image-generation-plugin-panel.js';
import { McpPluginPanel } from './mcp-plugin-panel.js';
import { PluginDetailHeader } from './plugin-detail-header.js';
import { PluginMarketPanel } from './plugin-market-panel.js';
import { PluginNav } from './plugin-nav.js';
import { PluginToolSummary } from './plugin-tool-summary.js';
import { PLUGIN_REGISTRY, findPluginDefinition, type PluginId } from './plugin-registry.js';
import type {
  DesktopAutomationPluginSettings,
  DesktopControlPluginSettings,
  ImageGenerationPluginSettings,
  PluginSettings,
} from './plugin-settings-types.js';
import { SkillsPluginPanel } from './skills-plugin-panel.js';
import { ThirdPartyPluginsPanel } from './third-party-plugins-panel.js';
import { WebsearchPluginPanel } from './websearch-plugin-panel.js';

export type {
  DesktopAutomationPluginSettings,
  DesktopControlPluginSettings,
  ImageGenerationPluginSettings,
  PluginSettings,
} from './plugin-settings-types.js';

interface PluginsTabContentProps {
  providers: AIProviderRef[];
  activeImageProviderId?: string;
  activeImageModelId?: string;
}

const SEARCH_MANAGED_MCP_IDS = new Set(['open_websearch', 'websearch']);

function normalizePluginId(value: string | null): PluginId {
  switch (value) {
    case 'desktop-automation':
    case 'desktop-control':
    case 'image-generation':
    case 'market':
    case 'mcp':
    case 'skills':
    case 'third-party':
    case 'websearch':
      return value;
    default:
      return 'image-generation';
  }
}

/**
 * 设置 → 插件。
 *
 * 外壳只负责三件事：`?plugin=` 深链与选中态、插件设置加载/保存、按注册表
 * 路由到各插件面板；插件元数据（图标/描述/工具清单）集中在 `plugin-registry`，
 * 详情页头与工具摘要共用同一模板，避免每个插件重复一套卡片 JSX。
 */
export function PluginsTabContent({
  providers,
  activeImageProviderId,
  activeImageModelId,
}: PluginsTabContentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [pluginSettings, setPluginSettings] = useState<PluginSettings>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<PluginId>(
    normalizePluginId(searchParams.get('plugin')),
  );

  useEffect(() => {
    setSelectedPluginId(normalizePluginId(searchParams.get('plugin')));
  }, [searchParams]);

  // Web 搜索策略——独立加载/保存
  const {
    loadWebsearchPolicy,
    saveWebsearchPolicy,
    savedPolicy: websearchSavedPolicy,
    saving: websearchSaving,
    setPolicy: setWebsearchPolicy,
    policy: websearchPolicy,
    loadError: websearchLoadError,
    saveError: websearchSaveError,
  } = useSettingsWebsearch({ gatewayUrl, token });

  // MCP 服务器——独立加载/保存/重试
  const {
    mcpServers,
    setMcpServers,
    mcpStatuses,
    onRetryMcp,
    loadError: mcpLoadError,
  } = useMcpServers({ gatewayUrl, token, active: true });

  const isCompactSettingsLayout = useCompactSettingsLayout();

  useEffect(() => {
    void loadWebsearchPolicy().catch(() => undefined);
  }, [loadWebsearchPolicy]);

  // Load plugin settings
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const data = (await createSettingsClient(gatewayUrl).getPlugins(token)) as PluginSettings;
        setPluginSettings(data);
      } catch {
        /* 读取失败时保持默认值（全部禁用），不阻塞页面 */
      } finally {
        setLoaded(true);
      }
    })();
  }, [gatewayUrl, token]);

  const saveSettings = useCallback(
    async (next: PluginSettings) => {
      if (!token) return;
      setSaving(true);
      try {
        await createSettingsClient(gatewayUrl).putPlugins(token, next);
      } catch {
        /* 保存失败保留本地状态，下次切换开关会重试 */
      } finally {
        setSaving(false);
      }
    },
    [gatewayUrl, token],
  );

  const updateImagePlugin = useCallback(
    (patch: Partial<ImageGenerationPluginSettings>) => {
      setPluginSettings((prev) => {
        const next: PluginSettings = {
          ...prev,
          imageGeneration: {
            enabled: prev.imageGeneration?.enabled ?? false,
            modelSource: prev.imageGeneration?.modelSource ?? 'global',
            ...prev.imageGeneration,
            ...patch,
          },
        };
        void saveSettings(next);
        return next;
      });
    },
    [saveSettings],
  );

  const updateDesktopControlPlugin = useCallback(
    (patch: Partial<DesktopControlPluginSettings>) => {
      setPluginSettings((prev) => {
        const next: PluginSettings = {
          ...prev,
          desktopControl: {
            enabled: prev.desktopControl?.enabled ?? false,
            ...prev.desktopControl,
            ...patch,
          },
        };
        void saveSettings(next);
        return next;
      });
    },
    [saveSettings],
  );

  const updateDesktopAutomationPlugin = useCallback(
    (patch: Partial<DesktopAutomationPluginSettings>) => {
      setPluginSettings((prev) => {
        const next: PluginSettings = {
          ...prev,
          desktopAutomation: {
            enabled: prev.desktopAutomation?.enabled ?? false,
            ...prev.desktopAutomation,
            ...patch,
          },
        };
        void saveSettings(next);
        return next;
      });
    },
    [saveSettings],
  );

  const selectPlugin = useCallback(
    (pluginId: PluginId) => {
      setSelectedPluginId(pluginId);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set('plugin', pluginId);
      setSearchParams(nextSearchParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const imgPlugin = pluginSettings.imageGeneration ?? { enabled: false, modelSource: 'global' };
  const desktopControlPlugin = pluginSettings.desktopControl ?? { enabled: false };
  const desktopAutomationPlugin = pluginSettings.desktopAutomation ?? { enabled: false };

  const searchManagedMcpServers = mcpServers.filter((server) =>
    SEARCH_MANAGED_MCP_IDS.has(server.id),
  );
  const searchManagedMcpStatuses = mcpStatuses.filter((server) =>
    SEARCH_MANAGED_MCP_IDS.has(server.id),
  );
  const generalMcpServers = mcpServers.filter((server) => !SEARCH_MANAGED_MCP_IDS.has(server.id));
  const generalMcpStatuses = mcpStatuses.filter((server) => !SEARCH_MANAGED_MCP_IDS.has(server.id));

  const handleAddMcpServer = useCallback(
    (entry: MCPServerEntry) => {
      setMcpServers((prev) => [...prev, { ...entry, source: 'user' }]);
    },
    [setMcpServers],
  );

  const handleRemoveMcpServer = useCallback(
    (id: string) => {
      setMcpServers((prev) => {
        const target = prev.find((server) => server.id === id);
        if (target?.builtin && target.source === 'builtin') {
          return prev.map((server) =>
            server.id === id
              ? {
                  ...server,
                  enabled: false,
                  source: resolvePersistableMcpServerSource(server, undefined),
                }
              : server,
          );
        }
        return prev.filter((server) => server.id !== id);
      });
    },
    [setMcpServers],
  );

  const handleUpdateMcpServer = useCallback(
    (id: string, entry: MCPServerEntry) => {
      setMcpServers((prev) =>
        prev.map((server) =>
          server.id === id
            ? {
                ...entry,
                source: resolvePersistableMcpServerSource(server, entry.source),
              }
            : server,
        ),
      );
    },
    [setMcpServers],
  );

  const pluginEnabled = (id: PluginId): boolean | undefined => {
    switch (id) {
      case 'image-generation':
        return imgPlugin.enabled;
      case 'desktop-control':
        return desktopControlPlugin.enabled;
      case 'desktop-automation':
        return desktopAutomationPlugin.enabled;
      case 'websearch':
        return (
          searchManagedMcpServers.some((server) => server.enabled !== false) ||
          websearchSavedPolicy.providers.length > 0
        );
      case 'mcp':
        return generalMcpServers.some((server) => server.enabled !== false);
      case 'skills':
      default:
        return undefined;
    }
  };

  const selectedDefinition = findPluginDefinition(selectedPluginId);

  if (!loaded) {
    return <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>;
  }

  const renderDetail = () => {
    if (!selectedDefinition) {
      return null;
    }

    switch (selectedPluginId) {
      case 'image-generation':
        return (
          <>
            <PluginDetailHeader
              definition={selectedDefinition}
              enabled={imgPlugin.enabled}
              onToggle={(next) => updateImagePlugin({ enabled: next })}
            />
            <ImageGenerationPluginPanel
              settings={imgPlugin}
              providers={providers}
              activeImageProviderId={activeImageProviderId}
              activeImageModelId={activeImageModelId}
              onChange={updateImagePlugin}
            />
            {selectedDefinition.tools ? (
              <PluginToolSummary tools={selectedDefinition.tools} />
            ) : null}
          </>
        );

      case 'desktop-control':
        return (
          <>
            <PluginDetailHeader
              definition={selectedDefinition}
              enabled={desktopControlPlugin.enabled}
              onToggle={(next) => updateDesktopControlPlugin({ enabled: next })}
            />
            {selectedDefinition.tools ? (
              <PluginToolSummary tools={selectedDefinition.tools} />
            ) : null}
          </>
        );

      case 'desktop-automation':
        return (
          <>
            <PluginDetailHeader
              definition={selectedDefinition}
              enabled={desktopAutomationPlugin.enabled}
              onToggle={(next) => updateDesktopAutomationPlugin({ enabled: next })}
            />
            {selectedDefinition.tools ? (
              <PluginToolSummary tools={selectedDefinition.tools} />
            ) : null}
          </>
        );

      case 'skills':
        return (
          <>
            <PluginDetailHeader definition={selectedDefinition} />
            <SkillsPluginPanel />
          </>
        );

      case 'third-party':
        return (
          <>
            <PluginDetailHeader definition={selectedDefinition} />
            <ThirdPartyPluginsPanel gatewayUrl={gatewayUrl} token={token} />
          </>
        );

      case 'market':
        return (
          <>
            <PluginDetailHeader definition={selectedDefinition} />
            <PluginMarketPanel gatewayUrl={gatewayUrl} token={token} />
          </>
        );

      case 'websearch':
        return (
          <>
            <PluginDetailHeader definition={selectedDefinition} />
            <WebsearchPluginPanel
              isSaving={websearchSaving}
              policy={websearchPolicy}
              savedPolicy={websearchSavedPolicy}
              setPolicy={setWebsearchPolicy}
              searchServers={searchManagedMcpServers}
              searchStatuses={searchManagedMcpStatuses}
              onRemoveMcp={handleRemoveMcpServer}
              onRetryMcp={onRetryMcp}
              onSave={() => {
                void saveWebsearchPolicy();
              }}
              onUpdateMcp={handleUpdateMcpServer}
              loadError={websearchLoadError}
              mcpLoadError={mcpLoadError}
              saveError={websearchSaveError}
            />
          </>
        );

      case 'mcp':
      default:
        return (
          <>
            <PluginDetailHeader definition={selectedDefinition} />
            <McpPluginPanel
              servers={generalMcpServers}
              statuses={generalMcpStatuses}
              onAdd={handleAddMcpServer}
              onRemove={handleRemoveMcpServer}
              onUpdate={handleUpdateMcpServer}
              onRetry={onRetryMcp}
              loadError={mcpLoadError}
            />
          </>
        );
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isCompactSettingsLayout ? 'minmax(0, 1fr)' : '200px minmax(0, 1fr)',
        gap: 20,
        minHeight: 400,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: 'var(--fg-strong)', fontSize: 15, fontWeight: 700 }}>插件</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 2 }}>
            配置可选 Tool 插件，默认均为禁用
          </div>
        </div>
        <PluginNav
          items={PLUGIN_REGISTRY.map((definition) => ({
            definition,
            enabled: pluginEnabled(definition.id),
          }))}
          selectedId={selectedPluginId}
          onSelect={selectPlugin}
        />
      </div>

      {/* minWidth: 0 让右侧列可以收缩到内容宽度以下，避免窄视口横向滚动。 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {renderDetail()}
        {saving ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 11, textAlign: 'right' }}>保存中…</div>
        ) : null}
      </div>
    </div>
  );
}
