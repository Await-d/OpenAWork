import React, { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { createSettingsClient } from '@openAwork/web-client';
import type { AIProviderRef } from '@openAwork/shared-ui';
import { MCPServerConfig, MCPServerList, type MCPServerEntry } from '@openAwork/shared-ui';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { SkillsPluginPanel } from './skills-plugin-panel.js';
import { WebsearchPluginPanel } from './websearch-plugin-panel.js';
import { resolvePersistableMcpServerSource } from '../connection/mcp-server-source-utils.js';
import { useSettingsWebsearch } from '../connection/use-settings-websearch.js';
import { useMcpServers } from '../connection/use-mcp-servers.js';
import { SS, ST, UV } from '../shared/settings-section-styles.js';
import { SettingsToggle } from '../shared/settings-toggle.js';
import { useCompactSettingsLayout } from '../shared/use-compact-settings-layout.js';

// ── Types ─────────────────────────────────────────────────────

export interface ImageGenerationPluginSettings {
  enabled: boolean;
  modelSource?: 'global' | 'dedicated';
  dedicatedProviderId?: string;
  dedicatedModelId?: string;
}

export interface DesktopControlPluginSettings {
  enabled: boolean;
}

export interface DesktopAutomationPluginSettings {
  enabled: boolean;
}

export interface PluginSettings {
  imageGeneration?: ImageGenerationPluginSettings;
  desktopControl?: DesktopControlPluginSettings;
  desktopAutomation?: DesktopAutomationPluginSettings;
}

interface PluginsTabContentProps {
  providers: AIProviderRef[];
  activeImageProviderId?: string;
  activeImageModelId?: string;
}

type PluginId =
  'desktop-automation' | 'desktop-control' | 'image-generation' | 'mcp' | 'skills' | 'websearch';

const SEARCH_MANAGED_MCP_IDS = new Set(['open_websearch', 'websearch']);

function normalizePluginId(value: string | null): PluginId {
  switch (value) {
    case 'desktop-automation':
    case 'desktop-control':
    case 'image-generation':
    case 'mcp':
    case 'skills':
    case 'websearch':
      return value;
    default:
      return 'image-generation';
  }
}

// ── Styles ────────────────────────────────────────────────────

const CARD: CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  padding: '12px 14px',
};

const SECTION_TITLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  marginBottom: 4,
};

const SECTION_DESC: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
  marginBottom: 0,
};

const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '7px 30px 7px 10px',
  fontSize: 12,
  color: 'var(--fg-strong)',
  width: '100%',
  outline: 'none',
  cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

const BADGE_ENABLED: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
  borderRadius: 6,
  padding: '2px 8px',
};

const PARAM_CHIP: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--fg-default)',
  background: 'color-mix(in oklch, var(--fg-default) 8%, transparent)',
  borderRadius: 4,
  padding: '2px 8px',
};

// ── Main Component ────────────────────────────────────────────

export function PluginsTabContent({
  providers,
  activeImageProviderId,
  activeImageModelId,
}: PluginsTabContentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPluginFromUrl = normalizePluginId(searchParams.get('plugin'));
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [pluginSettings, setPluginSettings] = useState<PluginSettings>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<PluginId>(selectedPluginFromUrl);

  useEffect(() => {
    setSelectedPluginId(selectedPluginFromUrl);
  }, [selectedPluginFromUrl]);

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
  } = useMcpServers({
    gatewayUrl,
    token,
    active: true,
  });

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
        /* ignore */
      } finally {
        setLoaded(true);
      }
    })();
  }, [gatewayUrl, token]);

  // Save plugin settings
  const saveSettings = useCallback(
    async (next: PluginSettings) => {
      if (!token) return;
      setSaving(true);
      try {
        await createSettingsClient(gatewayUrl).putPlugins(token, next);
      } catch {
        /* ignore */
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

  // Resolve the active image model info for display
  const imageProviders = providers.filter(
    (p) => p.enabled && p.defaultModels.some((m) => m.enabled && m.supportsImageGeneration),
  );
  const activeImageProvider = providers.find((p) => p.id === activeImageProviderId);
  const activeImageModel = activeImageProvider?.defaultModels.find(
    (m) => m.id === activeImageModelId,
  );

  // Plugin list definition
  const PLUGINS: Array<{
    id: PluginId;
    icon: React.ReactElement;
    label: string;
    description: string;
    enabled?: boolean;
  }> = [
    {
      id: 'image-generation',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      ),
      label: '图片插件',
      description: '为 Agent 提供专用图片生成 Tool。',
      enabled: imgPlugin.enabled,
    },
    {
      id: 'desktop-control',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
          <path d="M8 9l2.5 2.5L16 7" />
        </svg>
      ),
      label: '系统桌面控制',
      description: '为 Agent 提供截图、点击、输入和按键 Tool。',
      enabled: desktopControlPlugin.enabled,
    },
    {
      id: 'desktop-automation',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M2 9h20" />
          <circle cx="5.5" cy="6.5" r="0.5" fill="currentColor" />
          <circle cx="8.5" cy="6.5" r="0.5" fill="currentColor" />
          <path d="M9 13.5l2 2 4-4" />
        </svg>
      ),
      label: '浏览器自动化',
      description: '为 Agent 提供网页导航、点击、填写与截图 Tool。',
      enabled: desktopAutomationPlugin.enabled,
    },
    {
      id: 'skills',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.7 7.1 17.2l.9-5.5-4-3.9 5.5-.8L12 2z" />
        </svg>
      ),
      label: '技能',
      description: '管理已安装 Agent 技能，控制每条技能是否启用。',
      // Skill enablement is per-row inside the panel, so there's no
      // single global "enabled" badge to display in the sidebar.
      enabled: undefined,
    },
    {
      id: 'websearch',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
      label: 'Web 搜索',
      description: '统一管理默认搜索 MCP 与原生 Provider 回退策略。',
      enabled:
        searchManagedMcpServers.some((server) => server.enabled !== false) ||
        websearchSavedPolicy.providers.length > 0,
    },
    {
      id: 'mcp',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4" />
        </svg>
      ),
      label: 'MCP 服务器',
      description: '管理除网络搜索外的内置与自定义 MCP 服务器。',
      enabled: generalMcpServers.some((server) => server.enabled !== false),
    },
  ];

  const selectedPlugin = PLUGINS.find((p) => p.id === selectedPluginId);

  if (!loaded) {
    return <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isCompactSettingsLayout ? 'minmax(0, 1fr)' : '240px 1fr',
        gap: 24,
        minHeight: 400,
      }}
    >
      {/* ── Left: Plugin list ── */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)' }}>插件</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
            配置可选 Tool 插件，默认均为禁用
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {PLUGINS.map((plugin) => {
            const isActive = selectedPluginId === plugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                onClick={() => selectPlugin(plugin.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: isActive ? 'var(--accent-muted)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--fg-default)',
                  transition: 'background 150ms ease',
                }}
              >
                <span style={{ flexShrink: 0, opacity: 0.8 }}>{plugin.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 500 }}>
                      {plugin.label}
                    </span>
                    {plugin.enabled && <span style={BADGE_ENABLED}>已启用</span>}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {plugin.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: Plugin detail ── */}
      {/*
        `minWidth: 0` lets the `1fr` grid column shrink below the
        intrinsic width of its child. Without this, wide content
        (e.g. SkillsPluginPanel's 5-column table) forces the column
        wider than the viewport and triggers a horizontal scrollbar
        on the whole settings page.
       */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        {selectedPlugin && selectedPluginId === 'image-generation' && (
          <>
            {/* Header */}
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                图片插件
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                为 Agent 提供专用图片生成 Tool。
              </div>
            </div>

            {/* Enable toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                ...CARD,
              }}
            >
              <div>
                <h3 style={{ ...SECTION_TITLE, margin: 0 }}>启用插件</h3>
                <div style={SECTION_DESC}>启用并配置完成后，Agent 才会获得对应 Tool</div>
              </div>
              <SettingsToggle
                checked={imgPlugin.enabled}
                onChange={(v) => updateImagePlugin({ enabled: v })}
                ariaLabel="启用插件"
              />
            </div>

            {/* Model source */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ ...SECTION_TITLE, margin: 0 }}>图片模型来源</h3>
                <div style={SECTION_DESC}>你可以置用全局绘图模型，或为该插件单独指定图片模型</div>
              </div>
              <select
                value={imgPlugin.modelSource ?? 'global'}
                onChange={(e) =>
                  updateImagePlugin({
                    modelSource: e.target.value as 'global' | 'dedicated',
                  })
                }
                style={SELECT_STYLE}
              >
                <option value="global">使用全局绘图模型</option>
                <option value="dedicated">为此插件单独指定模型</option>
              </select>

              {imgPlugin.modelSource === 'dedicated' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={LABEL}>服务商</div>
                  <select
                    value={imgPlugin.dedicatedProviderId ?? ''}
                    onChange={(e) =>
                      updateImagePlugin({
                        dedicatedProviderId: e.target.value,
                        dedicatedModelId: '',
                      })
                    }
                    style={SELECT_STYLE}
                  >
                    <option value="">选择服务商…</option>
                    {imageProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {imgPlugin.dedicatedProviderId &&
                    (() => {
                      const provider = providers.find(
                        (p) => p.id === imgPlugin.dedicatedProviderId,
                      );
                      const models =
                        provider?.defaultModels.filter(
                          (m) => m.enabled && m.supportsImageGeneration,
                        ) ?? [];
                      return (
                        <>
                          <div style={LABEL}>模型</div>
                          <select
                            value={imgPlugin.dedicatedModelId ?? ''}
                            onChange={(e) =>
                              updateImagePlugin({ dedicatedModelId: e.target.value })
                            }
                            style={SELECT_STYLE}
                          >
                            <option value="">选择模型…</option>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label || m.id}
                              </option>
                            ))}
                          </select>
                        </>
                      );
                    })()}
                </div>
              )}

              {/* Current model display */}
              {imgPlugin.modelSource !== 'dedicated' && activeImageProvider && activeImageModel && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-overlay)',
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                      {activeImageProvider.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      {activeImageModel.label || activeImageModel.id}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tool status */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>Tool 状态</h3>
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--fg-strong)',
                    fontFamily: 'monospace',
                  }}
                >
                  ImageGenerate
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: imgPlugin.enabled ? 'var(--accent)' : 'var(--fg-muted)',
                    marginTop: 2,
                  }}
                >
                  {imgPlugin.enabled
                    ? '插件已就绪，Agent 可以调用此工具。'
                    : '插件未启用，Agent 无法使用此工具。'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    marginTop: 4,
                  }}
                >
                  可用参数：prompt、size、quality
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={PARAM_CHIP}>prompt</span>
                  <span style={PARAM_CHIP}>size</span>
                  <span style={PARAM_CHIP}>quality</span>
                </div>
              </div>
            </div>

            {/* Tool usage constraints */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>Tool 使用约束</h3>
              <div style={SECTION_DESC}>
                仅当你希望 Agent 直接生成图片时启用。Tool 只接受 prompt、size 和 quality
                参数，并使用当前配置的图片模型执行生成。
              </div>
            </div>

            {saving && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>
                保存中…
              </div>
            )}
          </>
        )}

        {selectedPlugin && selectedPluginId === 'skills' && <SkillsPluginPanel />}

        {selectedPlugin && selectedPluginId === 'desktop-control' && (
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                系统桌面控制
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                控制 Agent 是否获得系统级桌面工具（desktop_control 与 computer_use）。
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                ...CARD,
              }}
            >
              <div>
                <h3 style={{ ...SECTION_TITLE, margin: 0 }}>启用插件</h3>
                <div style={SECTION_DESC}>
                  启用后才会把 desktop_control 与 computer_use 注入 Agent 工具列表
                </div>
              </div>
              <SettingsToggle
                checked={desktopControlPlugin.enabled}
                onChange={(v) => updateDesktopControlPlugin({ enabled: v })}
                ariaLabel="启用插件"
              />
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>Tool 状态</h3>
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--fg-strong)',
                    fontFamily: 'monospace',
                  }}
                >
                  desktop_control
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: desktopControlPlugin.enabled ? 'var(--accent)' : 'var(--fg-muted)',
                    marginTop: 2,
                  }}
                >
                  {desktopControlPlugin.enabled
                    ? '插件已启用，后端会在本用户会话中注入该工具。'
                    : '插件未启用，后端不会注入该工具，历史调用也会被拒绝。'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  可用动作：截图、坐标点击（含按下、抬起、双击）、文本输入、单键与组合键、滚动、
                  等待、拖拽、鼠标移动、长按
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  可用参数：action、x、y、text、key、keys、scrollX、scrollY、ms
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={PARAM_CHIP}>action</span>
                  <span style={PARAM_CHIP}>x</span>
                  <span style={PARAM_CHIP}>y</span>
                  <span style={PARAM_CHIP}>text</span>
                  <span style={PARAM_CHIP}>key</span>
                  <span style={PARAM_CHIP}>keys</span>
                  <span style={PARAM_CHIP}>scrollX</span>
                  <span style={PARAM_CHIP}>scrollY</span>
                  <span style={PARAM_CHIP}>ms</span>
                </div>
              </div>

              {/* computer_use 与 desktop_control 共用同一个插件开关（T-14b），
                  这里显式列出，避免用户以为开关只影响 desktop_control。 */}
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--fg-strong)',
                    fontFamily: 'monospace',
                  }}
                >
                  computer_use
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: desktopControlPlugin.enabled ? 'var(--accent)' : 'var(--fg-muted)',
                    marginTop: 2,
                  }}
                >
                  {desktopControlPlugin.enabled
                    ? '插件已启用，具备 GUI grounding 能力的模型可驱动桌面完成多步任务。'
                    : '插件未启用，模型不会看到该工具，历史调用也会被拒绝。'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  内嵌「截图 → 视觉决策 → 动作」循环，每步执行进度会实时显示在对话里。
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={PARAM_CHIP}>instruction</span>
                  <span style={PARAM_CHIP}>maxSteps</span>
                </div>
              </div>
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>执行边界</h3>
              <div style={SECTION_DESC}>
                插件开关只决定 Agent 工具是否注入和是否允许执行；实际截图、坐标点击（含按下、抬起、
                双击）、文本输入、单键与组合键、滚动、等待、拖拽、鼠标移动、长按等动作仍会继续走
                权限审批与运行环境能力检查。computer_use 除插件开关外还需当前模型具备 GUI grounding
                能力，否则会直接返回明确原因而不执行。
              </div>
            </div>

            {saving && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>
                保存中…
              </div>
            )}
          </>
        )}

        {selectedPlugin && selectedPluginId === 'desktop-automation' && (
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                浏览器自动化
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                控制 Agent 是否获得桌面端专属的浏览器自动化工具（desktop_automation）。
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                ...CARD,
              }}
            >
              <div>
                <h3 style={{ ...SECTION_TITLE, margin: 0 }}>启用插件</h3>
                <div style={SECTION_DESC}>启用后才会把 desktop_automation 注入 Agent 工具列表</div>
              </div>
              <SettingsToggle
                checked={desktopAutomationPlugin.enabled}
                onChange={(v) => updateDesktopAutomationPlugin({ enabled: v })}
                ariaLabel="启用插件"
              />
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>Tool 状态</h3>
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--fg-strong)',
                    fontFamily: 'monospace',
                  }}
                >
                  desktop_automation
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: desktopAutomationPlugin.enabled ? 'var(--accent)' : 'var(--fg-muted)',
                    marginTop: 2,
                  }}
                >
                  {desktopAutomationPlugin.enabled
                    ? '插件已启用，后端会在本用户会话中注入该工具。'
                    : '插件未启用，后端不会注入该工具，历史调用也会被拒绝。'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  可用动作：导航与点击、输入、按键、滚动、等待、内容读取、页面快照、截图；检查面：
                  悬停、勾选、下拉选择、查找元素、iframe 列表、执行脚本、控制台读取
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  可用参数：action、url、selector、text、key、checked、values、limit、script、args、
                  level、clear、direction、amount、ms
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={PARAM_CHIP}>action</span>
                  <span style={PARAM_CHIP}>url</span>
                  <span style={PARAM_CHIP}>selector</span>
                  <span style={PARAM_CHIP}>text</span>
                  <span style={PARAM_CHIP}>key</span>
                  <span style={PARAM_CHIP}>checked</span>
                  <span style={PARAM_CHIP}>values</span>
                  <span style={PARAM_CHIP}>limit</span>
                  <span style={PARAM_CHIP}>script</span>
                  <span style={PARAM_CHIP}>args</span>
                  <span style={PARAM_CHIP}>level</span>
                  <span style={PARAM_CHIP}>clear</span>
                  <span style={PARAM_CHIP}>direction</span>
                  <span style={PARAM_CHIP}>amount</span>
                  <span style={PARAM_CHIP}>ms</span>
                </div>
              </div>
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ ...SECTION_TITLE, margin: 0 }}>执行边界</h3>
              <div style={SECTION_DESC}>
                插件开关只决定 desktop_automation 是否注入工具列表与是否允许执行；实际导航、点击、
                输入、按键、滚动、等待、脚本执行等动作仍会继续走权限审批。该插件还需要运行环境支持：
                桌面端 sidecar 会自动注入 DESKTOP_AUTOMATION=1，纯 Web 或远程网关环境即使打开开关也
                无法使用。
              </div>
            </div>

            {saving && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>
                保存中…
              </div>
            )}
          </>
        )}

        {selectedPlugin && selectedPluginId === 'websearch' && (
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
        )}

        {selectedPlugin && selectedPluginId === 'mcp' && (
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                MCP 服务器
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                管理除 Web 搜索外的内置 MCP（如 grep_app、codegraph、lsp、omo），也可以接入 自定义
                SSE / stdio MCP，并对同 id 内置项做禁用或覆盖。
              </div>
            </div>
            {mcpLoadError ? (
              <div role="alert" style={{ fontSize: 11, color: 'var(--danger)', lineHeight: 1.5 }}>
                {mcpLoadError}
              </div>
            ) : null}
            <section style={{ ...SS, marginBottom: 0, padding: '10px 12px', gap: '0.5rem' }}>
              <h3 style={ST}>服务器配置</h3>
              <div style={UV}>
                <MCPServerConfig
                  servers={generalMcpServers}
                  onAdd={handleAddMcpServer}
                  onRemove={handleRemoveMcpServer}
                  onUpdate={handleUpdateMcpServer}
                />
              </div>
            </section>
            <section style={{ ...SS, marginBottom: 0, padding: '10px 12px', gap: '0.5rem' }}>
              <h3 style={ST}>运行状态</h3>
              <div style={UV}>
                <MCPServerList servers={generalMcpStatuses} onRetry={onRetryMcp} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
