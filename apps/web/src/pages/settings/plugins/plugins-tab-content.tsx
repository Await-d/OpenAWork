import React, { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { createSettingsClient } from '@openAwork/web-client';
import type { AIProviderRef } from '@openAwork/shared-ui';
import { MCPServerConfig, MCPServerList } from '@openAwork/shared-ui';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { SkillsPluginPanel } from './skills-plugin-panel.js';
import { WebsearchSection } from '../connection/websearch-section.js';
import { resolvePersistableMcpServerSource } from '../connection/mcp-server-source-utils.js';
import { useSettingsWebsearch } from '../connection/use-settings-websearch.js';
import { useMcpServers } from '../connection/use-mcp-servers.js';
import { SS, ST, UV } from '../shared/settings-section-styles.js';

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

export interface PluginSettings {
  imageGeneration?: ImageGenerationPluginSettings;
  desktopControl?: DesktopControlPluginSettings;
}

interface PluginsTabContentProps {
  providers: AIProviderRef[];
  activeImageProviderId?: string;
  activeImageModelId?: string;
}

type PluginId = 'desktop-control' | 'image-generation' | 'mcp' | 'skills' | 'websearch';

function normalizePluginId(value: string | null): PluginId {
  switch (value) {
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

// ── Toggle Switch ─────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 999,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'var(--border-default)',
        flexShrink: 0,
        transition: 'background 180ms ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--bg-overlay)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          transition: 'left 180ms ease',
        }}
      />
    </button>
  );
}

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
  } = useSettingsWebsearch({ gatewayUrl, token });

  // MCP 服务器——独立加载/保存/重试
  const { mcpServers, setMcpServers, mcpStatuses, onRetryMcp } = useMcpServers({
    gatewayUrl,
    token,
    active: true,
  });

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
      description: '为 Agent 的 websearch 工具配置多 provider 策略。',
      enabled: websearchSavedPolicy.providers.length > 0,
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
      description: '管理内置与自定义 MCP 服务器，扩展 Agent 工具能力。',
      enabled: mcpServers.length > 0,
    },
  ];

  const selectedPlugin = PLUGINS.find((p) => p.id === selectedPluginId);

  if (!loaded) {
    return <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, minHeight: 400 }}>
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
                <div style={SECTION_TITLE}>启用插件</div>
                <div style={SECTION_DESC}>启用并配置完成后，Agent 才会获得对应 Tool</div>
              </div>
              <ToggleSwitch
                checked={imgPlugin.enabled}
                onChange={(v) => updateImagePlugin({ enabled: v })}
              />
            </div>

            {/* Model source */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={SECTION_TITLE}>图片模型来源</div>
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
              <div style={SECTION_TITLE}>Tool 状态</div>
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
              <div style={SECTION_TITLE}>Tool 使用约束</div>
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
                控制 Agent 是否获得系统级 desktop_control Tool。
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
                <div style={SECTION_TITLE}>启用插件</div>
                <div style={SECTION_DESC}>启用后才会把 desktop_control 注入 Agent 工具列表</div>
              </div>
              <ToggleSwitch
                checked={desktopControlPlugin.enabled}
                onChange={(v) => updateDesktopControlPlugin({ enabled: v })}
              />
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={SECTION_TITLE}>Tool 状态</div>
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
            </div>

            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={SECTION_TITLE}>执行边界</div>
              <div style={SECTION_DESC}>
                插件开关只决定 Agent 工具是否注入和是否允许执行；实际截图、点击、输入、按键、
                滚动等动作仍会继续走权限审批与运行环境能力检查。
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
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                Web 搜索
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                为 Agent 的 websearch 工具配置多 provider
                策略，支持顺序回退、首个成功和合并去重三种模式。
              </div>
            </div>
            <WebsearchSection
              isSaving={websearchSaving}
              policy={websearchPolicy}
              savedPolicy={websearchSavedPolicy}
              setPolicy={setWebsearchPolicy}
              onSave={() => {
                void saveWebsearchPolicy();
              }}
            />
          </>
        )}

        {selectedPlugin && selectedPluginId === 'mcp' && (
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
                MCP 服务器
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                系统内置 websearch、grep_app、codegraph、git_bash、lsp、omo；也可以接入自定义 SSE /
                stdio MCP，并对同 id 内置项做禁用或覆盖。
              </div>
            </div>
            <section style={{ ...SS, marginBottom: 0, padding: '10px 12px', gap: '0.5rem' }}>
              <h3 style={ST}>服务器配置</h3>
              <div style={UV}>
                <MCPServerConfig
                  servers={mcpServers}
                  onAdd={(entry) =>
                    setMcpServers((prev) => [...prev, { ...entry, source: 'user' }])
                  }
                  onRemove={(id) => {
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
                  }}
                  onUpdate={(id, entry) =>
                    setMcpServers((prev) =>
                      prev.map((server) =>
                        server.id === id
                          ? {
                              ...entry,
                              source: resolvePersistableMcpServerSource(server, entry.source),
                            }
                          : server,
                      ),
                    )
                  }
                />
              </div>
            </section>
            <section style={{ ...SS, marginBottom: 0, padding: '10px 12px', gap: '0.5rem' }}>
              <h3 style={ST}>运行状态</h3>
              <div style={UV}>
                <MCPServerList servers={mcpStatuses} onRetry={onRetryMcp} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
