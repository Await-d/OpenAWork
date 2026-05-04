import type React from 'react';
import type { DesktopGatewayMode } from '../../utils/desktop-gateway.js';
import {
  MCPServerConfig,
  MCPServerList,
  ProviderSettings,
  type ActiveSelectionRef,
  type AIModelConfigItem,
  type AIProviderRef,
  type ImageGenerationDefaultsRef,
  type MCPServerEntry,
  type MCPServerStatus,
} from '@openAwork/shared-ui';
import type { ProviderEditData, ThinkingDefaultsRef, ThinkingModeRef } from '../settings-types.js';
import { BP, IS, SS, ST, UV } from './settings-section-styles.js';
import { UpstreamRetrySection } from './upstream-retry-section.js';

interface ConnectionTabContentProps {
  providers: AIProviderRef[];
  activeSelection: ActiveSelectionRef;
  defaultThinking: ThinkingDefaultsRef;
  imageGenerationDefaults: ImageGenerationDefaultsRef;
  hasUnsavedDefaultChanges: boolean;
  isSavingDefaultChanges: boolean;
  setActiveSelection: React.Dispatch<React.SetStateAction<ActiveSelectionRef>>;
  setDefaultThinking: React.Dispatch<React.SetStateAction<ThinkingDefaultsRef>>;
  setImageGenerationDefaults: React.Dispatch<React.SetStateAction<ImageGenerationDefaultsRef>>;
  saveDefaultModelSettings: () => void;
  handleAddModel: (providerId: string, model: AIModelConfigItem) => void;
  handleRemoveModel: (providerId: string, modelId: string) => void;
  handleUpdateModel: (
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfigItem>,
  ) => void;
  handleToggleModel: (providerId: string, modelId: string) => void;
  handleToggleProvider: (id: string) => void;
  handleEditProvider: (id: string, data: ProviderEditData) => void;
  handleAddProvider: (data: ProviderEditData) => void;
  mcpServers: MCPServerEntry[];
  setMcpServers: React.Dispatch<React.SetStateAction<MCPServerEntry[]>>;
  mcpStatuses: MCPServerStatus[];
  urlInput: string;
  setUrlInput: React.Dispatch<React.SetStateAction<string>>;
  saveGatewayUrl: () => void;
  urlSaved: boolean;
  webAccessEnabled: boolean;
  webPort: number;
  portInput: string;
  setPortInput: React.Dispatch<React.SetStateAction<string>>;
  saveWebPort: () => Promise<void>;
  toggleWebAccess: () => void;
  copied: boolean;
  copyAddress: () => void;
  desktopGatewayBusy: boolean;
  desktopGatewayError: string | null;
  desktopGatewayMode: DesktopGatewayMode;
  remoteAdminEmail: string;
  remoteAdminPassword: string;
  setRemoteAdminEmail: React.Dispatch<React.SetStateAction<string>>;
  setRemoteAdminPassword: React.Dispatch<React.SetStateAction<string>>;
  isTauri: boolean;
  savingUpstreamRetrySettings: boolean;
  setUpstreamRetryMaxRetries: React.Dispatch<React.SetStateAction<number>>;
  upstreamRetryMaxRetries: number;
  saveUpstreamRetrySettings: () => void;
  savedUpstreamRetryMaxRetries: number;
}

export function ConnectionTabContent({
  providers,
  activeSelection,
  defaultThinking,
  imageGenerationDefaults,
  hasUnsavedDefaultChanges,
  isSavingDefaultChanges,
  setActiveSelection,
  setDefaultThinking,
  setImageGenerationDefaults,
  saveDefaultModelSettings,
  handleAddModel,
  handleRemoveModel,
  handleUpdateModel,
  handleToggleModel,
  handleToggleProvider,
  handleEditProvider,
  handleAddProvider,
  mcpServers,
  setMcpServers,
  mcpStatuses,
  urlInput,
  setUrlInput,
  saveGatewayUrl,
  urlSaved,
  webAccessEnabled,
  webPort,
  portInput,
  setPortInput,
  saveWebPort,
  toggleWebAccess,
  copied,
  copyAddress,
  desktopGatewayBusy,
  desktopGatewayError,
  desktopGatewayMode,
  remoteAdminEmail,
  remoteAdminPassword,
  setRemoteAdminEmail,
  setRemoteAdminPassword,
  isTauri,
  savingUpstreamRetrySettings,
  setUpstreamRetryMaxRetries,
  upstreamRetryMaxRetries,
  saveUpstreamRetrySettings,
  savedUpstreamRetryMaxRetries,
}: ConnectionTabContentProps) {
  return (
    <>
      <section style={SS}>
        <h3 style={ST}>网关</h3>
        {isTauri ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            <span>当前桌面网关模式</span>
            <strong style={{ color: 'var(--accent)' }}>
              {desktopGatewayMode === 'local' ? '本地网关' : '远程网关'}
            </strong>
          </div>
        ) : null}
        <label htmlFor="gw-url" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
          网关地址
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="gw-url"
            style={{ ...IS, flex: 1 }}
            type="url"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="http://localhost:3000"
          />
          <button type="button" onClick={saveGatewayUrl} style={BP}>
            {desktopGatewayBusy ? '同步中…' : urlSaved ? '✓ 已保存' : '保存'}
          </button>
        </div>
        {desktopGatewayError ? (
          <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{desktopGatewayError}</p>
        ) : null}
        {isTauri ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                color: 'var(--text-3)',
                fontSize: 12,
              }}
            >
              远程管理员邮箱
              <input
                style={IS}
                type="email"
                value={remoteAdminEmail}
                onChange={(event) => setRemoteAdminEmail(event.target.value)}
                placeholder="admin@openAwork.local"
                autoComplete="username"
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                color: 'var(--text-3)',
                fontSize: 12,
              }}
            >
              远程管理员密码
              <input
                style={IS}
                type="password"
                value={remoteAdminPassword}
                onChange={(event) => setRemoteAdminPassword(event.target.value)}
                placeholder="切换远程网关时必填"
                autoComplete="current-password"
              />
            </label>
          </div>
        ) : null}
      </section>
      <UpstreamRetrySection
        isSaving={savingUpstreamRetrySettings}
        maxRetries={upstreamRetryMaxRetries}
        onChange={(value) => setUpstreamRetryMaxRetries(value)}
        onSave={saveUpstreamRetrySettings}
        savedMaxRetries={savedUpstreamRetryMaxRetries}
      />
      <div>
        <h3 style={{ ...ST, marginBottom: 12 }}>模型与提供商</h3>
        <div style={{ ...SS, marginBottom: 12 }}>
          <div style={{ display: 'grid', gap: 6, maxWidth: 520 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
              新建会话会默认继承这里的工具配置档；进入具体会话后，仍可在聊天顶部继续临时切换。
            </span>
          </div>
        </div>
        <div style={UV}>
          <ProviderSettings
            providers={providers}
            active={activeSelection}
            defaultThinking={defaultThinking}
            imageDefaults={imageGenerationDefaults}
            hasUnsavedDefaultChanges={hasUnsavedDefaultChanges}
            isSavingDefaultChanges={isSavingDefaultChanges}
            onSetActiveChat={(providerId, modelId) =>
              setActiveSelection((prev) => ({
                ...prev,
                chat: { providerId, modelId },
              }))
            }
            onSetActiveFast={(providerId, modelId) =>
              setActiveSelection((prev) => ({
                ...prev,
                fast: { providerId, modelId },
              }))
            }
            onSetActiveImage={(providerId, modelId) =>
              setActiveSelection((prev) => ({
                ...prev,
                image: { providerId, modelId },
              }))
            }
            onSaveDefaultChanges={saveDefaultModelSettings}
            onSetThinkingMode={(mode: keyof ThinkingDefaultsRef, value: ThinkingModeRef) =>
              setDefaultThinking((prev: ThinkingDefaultsRef) => ({
                ...prev,
                [mode]: value,
              }))
            }
            onSetImageDefaults={(updates) =>
              setImageGenerationDefaults((prev) => ({
                ...prev,
                ...updates,
              }))
            }
            onToggleProvider={handleToggleProvider}
            onEditProvider={handleEditProvider}
            onAddProvider={handleAddProvider}
            onToggleModel={handleToggleModel}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
            onUpdateModel={handleUpdateModel}
          />
        </div>
      </div>
      <section style={SS}>
        <h3 style={ST}>MCP 服务器</h3>
        <div style={UV}>
          <MCPServerConfig
            servers={mcpServers}
            onAdd={(entry) => setMcpServers((prev) => [...prev, entry])}
            onRemove={(id) => setMcpServers((prev) => prev.filter((server) => server.id !== id))}
          />
        </div>
      </section>
      <section style={SS}>
        <h3 style={ST}>MCP 服务器状态</h3>
        <div style={UV}>
          <MCPServerList servers={mcpStatuses} />
        </div>
      </section>
      {isTauri && (
        <section style={SS}>
          <h3 style={ST}>桌面网关切换</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
            首次启动后可以在这里切换本地网关和远程网关。本地网关会启动桌面端内置服务；远程网关请在上方填写地址并保存。
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, flex: 1 }}>
              {webAccessEnabled ? '正在使用本地网关' : '正在使用远程网关'}
            </span>
            <button
              type="button"
              onClick={toggleWebAccess}
              aria-pressed={webAccessEnabled}
              disabled={desktopGatewayBusy}
              style={{
                position: 'relative',
                width: 44,
                height: 24,
                borderRadius: 999,
                border: 'none',
                cursor: desktopGatewayBusy ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                padding: 0,
                opacity: desktopGatewayBusy ? 0.6 : 1,
                background: webAccessEnabled ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--surface)',
                  display: 'block',
                  transform: webAccessEnabled ? 'translateX(20px)' : 'translateX(2px)',
                }}
              />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...IS, maxWidth: 120 }}
              type="number"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(event) => setPortInput(event.target.value)}
              disabled={desktopGatewayBusy}
            />
            <button
              type="button"
              onClick={() => void saveWebPort()}
              disabled={desktopGatewayBusy}
              style={{ ...BP, opacity: desktopGatewayBusy ? 0.4 : 1 }}
            >
              {desktopGatewayBusy ? '应用中…' : '应用'}
            </button>
          </div>
          {webAccessEnabled && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 12px',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: 'var(--accent)',
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {`http://localhost:${webPort}`}
              </span>
              <button
                type="button"
                onClick={copyAddress}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                }}
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
              <a
                href={`http://localhost:${webPort}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  textDecoration: 'none',
                }}
              >
                打开 ↗
              </a>
            </div>
          )}
        </section>
      )}
    </>
  );
}
