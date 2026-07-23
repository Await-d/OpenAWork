import type React from 'react';
import type { CSSProperties } from 'react';
import type { DesktopGatewayMode } from '../../../utils/gateway/desktop-gateway.js';
import {
  ProviderSettings,
  type ActiveSelectionRef,
  type AIModelConfigItem,
  type AIProviderRef,
  type ImageGenerationDefaultsRef,
} from '@openAwork/shared-ui';
import type {
  ProviderEditData,
  ThinkingDefaultsRef,
  ThinkingModeRef,
} from '../state/settings-types.js';
import { BP, IS, SS, UV } from '../shared/settings-section-styles.js';
import { UpstreamRetrySection } from './upstream-retry-section.js';

/** 区域分组标题——比 ST 更大，用于二级信息架构 */
const GROUP_TITLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  letterSpacing: '-0.01em',
  margin: 0,
};

/** 区域分组描述文字 */
const GROUP_DESC: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
  margin: '1px 0 0',
};

/** 区域分组容器 */
const GROUP_WRAPPER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

/** 区域分组头部——标题+描述行 */
const GROUP_HEADER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '0 2px',
};

/** 紧凑版 section——覆盖 SS 的 padding 和 gap */
const SS_TIGHT: CSSProperties = {
  ...SS,
  marginBottom: 0,
  padding: '10px 12px',
  gap: '0.5rem',
};

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
  onTestModel?: (
    providerId: string,
    modelId: string,
  ) => Promise<{
    ok: boolean;
    status: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
    message: string;
    latencyMs?: number;
  }>;
  onSyncCatalog?: () => Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }>;
  onDiscoverProviders?: () => Promise<{
    providers: Array<{
      id: string;
      name: string;
      api?: string;
      modelCount: number;
      sampleModels?: Array<{ id: string; name: string }>;
    }>;
  }>;
  onImportDiscoveredProvider?: (modelsDevProviderId: string) => Promise<void>;
  urlInput: string;
  setUrlInput: React.Dispatch<React.SetStateAction<string>>;
  saveGatewayUrl: () => void;
  urlSaved: boolean;
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
  /** 自定义域名 */
  customBaseUrl: string;
  setCustomBaseUrl: (url: string) => void;
  customBaseUrlSaved: boolean;
  saveCustomBaseUrl: () => void;
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
  onTestModel,
  onSyncCatalog,
  onDiscoverProviders,
  onImportDiscoveredProvider,
  urlInput,
  setUrlInput,
  saveGatewayUrl,
  urlSaved,
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
  customBaseUrl,
  setCustomBaseUrl,
  customBaseUrlSaved,
  saveCustomBaseUrl,
}: ConnectionTabContentProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ───── 区域一：网关连接 ───── */}
      <div style={GROUP_WRAPPER}>
        <div style={GROUP_HEADER}>
          <h3 style={GROUP_TITLE}>网关连接</h3>
          <p style={GROUP_DESC}>配置网关地址与认证凭据，桌面端可在本地与远程模式间切换。</p>
        </div>
        <section style={SS_TIGHT}>
          {isTauri ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--accent-border)',
                background:
                  desktopGatewayMode === 'local'
                    ? 'var(--accent-subtle)'
                    : 'var(--contrast-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background:
                      desktopGatewayMode === 'local' ? 'var(--accent)' : 'var(--contrast)',
                    boxShadow: `0 0 6px ${
                      desktopGatewayMode === 'local' ? 'var(--accent)' : 'var(--contrast)'
                    }`,
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>当前模式</span>
              </div>
              <strong
                style={{
                  fontSize: 11,
                  color: desktopGatewayMode === 'local' ? 'var(--accent)' : 'var(--contrast)',
                  fontWeight: 700,
                }}
              >
                {desktopGatewayMode === 'local' ? '本地网关' : '远程网关'}
              </strong>
            </div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor="gw-url"
              style={{ fontSize: 11, color: 'var(--fg-strong)', fontWeight: 500 }}
            >
              网关地址
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="gw-url"
                style={{ ...IS, flex: 1, padding: '6px 10px' }}
                type="url"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="http://localhost:3000"
              />
              <button type="button" onClick={saveGatewayUrl} style={{ ...BP, padding: '6px 12px' }}>
                {desktopGatewayBusy ? '同步中…' : urlSaved ? '✓ 已保存' : '保存'}
              </button>
            </div>
          </div>
          {desktopGatewayError ? (
            <p style={{ color: 'var(--complement)', fontSize: 11, margin: 0 }}>
              {desktopGatewayError}
            </p>
          ) : null}
          {isTauri ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                }}
              >
                远程管理员邮箱
                <input
                  style={{ ...IS, padding: '6px 10px' }}
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
                  gap: 4,
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                }}
              >
                远程管理员密码
                <input
                  style={{ ...IS, padding: '6px 10px' }}
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
      </div>

      {/* ───── 区域：自定义域名 ───── */}
      <div style={GROUP_WRAPPER}>
        <div style={GROUP_HEADER}>
          <h3 style={GROUP_TITLE}>自定义域名</h3>
          <p style={GROUP_DESC}>配置用于生成分享链接等对外 URL 的域名，不带尾部斜杠。</p>
        </div>
        <section style={SS_TIGHT}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                color: 'var(--fg-muted)',
                fontSize: 11,
                flex: 1,
              }}
            >
              基础域名
              <input
                style={{ ...IS, padding: '6px 10px' }}
                value={customBaseUrl}
                onChange={(event) => setCustomBaseUrl(event.target.value)}
                placeholder="https://openwork.app"
              />
            </label>
            <button
              style={{
                ...BP,
                opacity: customBaseUrlSaved ? 0.7 : 1,
              }}
              onClick={saveCustomBaseUrl}
            >
              {customBaseUrlSaved ? '✓ 已保存' : '保存'}
            </button>
          </div>
        </section>
      </div>

      {/* ───── 区域二：调用策略 ───── */}
      <div style={GROUP_WRAPPER}>
        <div style={GROUP_HEADER}>
          <h3 style={GROUP_TITLE}>调用策略</h3>
          <p style={GROUP_DESC}>上游重试策略，影响所有会话的全局行为。</p>
        </div>
        <UpstreamRetrySection
          isSaving={savingUpstreamRetrySettings}
          maxRetries={upstreamRetryMaxRetries}
          onChange={(value) => setUpstreamRetryMaxRetries(value)}
          onSave={saveUpstreamRetrySettings}
          savedMaxRetries={savedUpstreamRetryMaxRetries}
        />
      </div>

      {/* ───── 区域三：模型与提供商 ───── */}
      <div style={GROUP_WRAPPER}>
        <div style={GROUP_HEADER}>
          <h3 style={GROUP_TITLE}>模型与提供商</h3>
          <p style={GROUP_DESC}>
            新建会话会默认继承这里的工具配置档；进入具体会话后，仍可在聊天顶部继续临时切换。
          </p>
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
            {...(onTestModel ? { onTestModel } : {})}
            {...(onSyncCatalog ? { onSyncCatalog } : {})}
            {...(onDiscoverProviders ? { onDiscoverProviders } : {})}
            {...(onImportDiscoveredProvider ? { onImportDiscoveredProvider } : {})}
          />
        </div>
      </div>
    </div>
  );
}
