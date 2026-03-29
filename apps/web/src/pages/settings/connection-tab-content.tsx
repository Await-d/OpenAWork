import type React from 'react';
import {
  MCPServerConfig,
  MCPServerList,
  ProviderSettings,
  type ActiveSelectionRef,
  type AIModelConfigItem,
  type AIProviderRef,
  type MCPServerEntry,
  type MCPServerStatus,
} from '@openAwork/shared-ui';
import type { ProviderEditData, ThinkingDefaultsRef, ThinkingModeRef } from '../settings-types.js';
import { BP, IS, SS, ST, UV } from './settings-section-styles.js';

interface ConnectionTabContentProps {
  providers: AIProviderRef[];
  activeSelection: ActiveSelectionRef;
  defaultThinking: ThinkingDefaultsRef;
  hasUnsavedDefaultChanges: boolean;
  isSavingDefaultChanges: boolean;
  setActiveSelection: React.Dispatch<React.SetStateAction<ActiveSelectionRef>>;
  setDefaultThinking: React.Dispatch<React.SetStateAction<ThinkingDefaultsRef>>;
  saveDefaultModelSettings: () => void;
  handleAddModel: (providerId: string, model: AIModelConfigItem) => void;
  handleRemoveModel: (providerId: string, modelId: string) => void;
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
  saveWebPort: () => void;
  toggleWebAccess: () => void;
  copied: boolean;
  copyAddress: () => void;
  isTauri: boolean;
}

export function ConnectionTabContent({
  providers,
  activeSelection,
  defaultThinking,
  hasUnsavedDefaultChanges,
  isSavingDefaultChanges,
  setActiveSelection,
  setDefaultThinking,
  saveDefaultModelSettings,
  handleAddModel,
  handleRemoveModel,
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
  isTauri,
}: ConnectionTabContentProps) {
  return (
    <>
      <section style={SS}>
        <h3 style={ST}>网关</h3>
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
            {urlSaved ? '✓ 已保存' : '保存'}
          </button>
        </div>
      </section>
      <div>
        <h3 style={{ ...ST, marginBottom: 12 }}>模型与提供商</h3>
        <div style={UV}>
          <ProviderSettings
            providers={providers}
            active={activeSelection}
            defaultThinking={defaultThinking}
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
            onSaveDefaultChanges={saveDefaultModelSettings}
            onSetThinkingMode={(mode: keyof ThinkingDefaultsRef, value: ThinkingModeRef) =>
              setDefaultThinking((prev: ThinkingDefaultsRef) => ({
                ...prev,
                [mode]: value,
              }))
            }
            onToggleProvider={handleToggleProvider}
            onEditProvider={handleEditProvider}
            onAddProvider={handleAddProvider}
            onToggleModel={handleToggleModel}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
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
          <h3 style={ST}>网页访问</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, flex: 1 }}>
              启用网页访问
            </span>
            <button
              type="button"
              onClick={toggleWebAccess}
              aria-pressed={webAccessEnabled}
              style={{
                position: 'relative',
                width: 44,
                height: 24,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
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
              disabled={webAccessEnabled}
            />
            <button
              type="button"
              onClick={saveWebPort}
              disabled={webAccessEnabled}
              style={{ ...BP, opacity: webAccessEnabled ? 0.4 : 1 }}
            >
              应用
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
