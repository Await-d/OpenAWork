import React, { Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { useAuthStore } from '../../stores/auth/auth.js';
import { ConnectionTabContent } from './connection/connection-tab-content.js';
import { DisplayTabContent } from './display/display-tab-content.js';
import { ChannelsTabContent } from './channels/channels-tab-content.js';
import { DevtoolsTabContent } from './devtools/devtools-tab-content.js';
import AboutPage from '../misc/AboutPage.js';
import {
  TABS,
  TAURI_ONLY_TAB_IDS,
  isEmbeddedRouteTab,
  isTauri,
  type TabId,
} from './shared/settings-page-helpers.js';
import {
  OptimizedSettingsNav,
  OPTIMIZED_CONTENT_GAP,
  OPTIMIZED_MAX_WIDTH,
  OPTIMIZED_NAV_WIDTH,
} from './shared/optimized-settings-layout.js';
import { useCompactSettingsLayout } from './shared/use-compact-settings-layout.js';
import { useSettingsEnvironment } from './shared/use-settings-environment.js';
import { useSettingsUpstreamRetry } from './connection/use-settings-upstream-retry.js';
import { WorkspaceTabContent } from './workspace/workspace-tab-content.js';
import { SecurityTabContent } from './security/security-tab-content.js';
import { UsageTabContent } from './usage/usage-tab-content.js';
import { MemoryTabContent } from './memory/memory-tab-content.js';
import { CompanionTabContent } from './companion/companion-tab-content.js';
import { PluginsTabContent } from './plugins/plugins-tab-content.js';
import { DesktopTabContent } from './desktop/desktop-tab-content.js';
import { useMemoryManagement } from './memory/use-memory-management.js';
import { useSettingsTabActions } from './shared/use-settings-tab-actions.js';
import { useSettingsProviders } from './shared/use-settings-providers.js';
import { useDevtoolsSources } from './shared/use-devtools-sources.js';
import { useSettingsData } from './shared/use-settings-data.js';
import { useSettingsSsh } from './shared/use-settings-ssh.js';
import { PRELOADABLE_ROUTE_MODULES } from '../../routes/preloadable-route-modules.js';
import PageTransitionLoader from '../../components/common/feedback/PageTransitionLoader.js';
import { usePrefersReducedMotion } from '../../hooks/ui/usePrefersReducedMotion.js';
import type { DevtoolsSourceKey } from './state/settings-types.js';

export default function SettingsPage() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const {
    gatewayUrl,
    setGatewayUrl,
    setAuth,
    webAccessEnabled,
    webPort,
    webExposeLan,
    setWebAccess,
    customBaseUrl,
    setCustomBaseUrl,
  } = useAuthStore();
  const token = useAuthStore((s) => s.accessToken);
  const { tab } = useParams<{ tab: string }>();
  const activeTab = (TABS.find((t) => t.id === tab)?.id ?? 'connection') as TabId;
  const [customBaseUrlSaved, setCustomBaseUrlSaved] = useState(false);
  const {
    desktopGatewayBusy,
    desktopGatewayError,
    desktopGatewayMode,
    remoteAdminEmail,
    remoteAdminPassword,
    saveGatewayUrl,
    setRemoteAdminEmail,
    setRemoteAdminPassword,
    setUrlInput,
    urlInput,
    urlSaved,
  } = useSettingsEnvironment({
    gatewayUrl,
    setGatewayUrl,
    setAuth,
    token,
    webAccessEnabled,
    webPort,
    webExposeLan,
    setWebAccess,
  });
  const {
    loadUpstreamRetrySettings,
    saveUpstreamRetrySettings,
    savedUpstreamRetryMaxRetries,
    savingUpstreamRetrySettings,
    setUpstreamRetryMaxRetries,
    upstreamRetryMaxRetries,
  } = useSettingsUpstreamRetry({ gatewayUrl, token });

  const saveCustomBaseUrl = React.useCallback(() => {
    setCustomBaseUrlSaved(true);
    setTimeout(() => setCustomBaseUrlSaved(false), 2000);
  }, []);

  const memoryManagement = useMemoryManagement({
    gatewayUrl,
    token,
    active: activeTab === 'memory',
  });

  const {
    providers,
    setProviders,
    providersRef,
    applyServerDefaults,
    activeSelection,
    defaultThinking,
    imageGenerationDefaults,
    subagentModelPolicy,
    hasUnsavedDefaultModelChanges,
    savingDefaultModelSettings,
    setActiveSelection,
    setDefaultThinking,
    setImageGenerationDefaults,
    setSubagentModelPolicy,
    saveDefaultModelSettings,
    handleTestModel,
    handleSyncCatalog,
    handleDiscoverProviders,
    handleImportDiscoveredProvider,
    handleAddProvider,
    handleEditProvider,
    handleToggleProvider,
    handleRemoveProvider,
    handleToggleModel,
    handleAddModel,
    handleUpdateModel,
    handleRemoveModel,
  } = useSettingsProviders({ gatewayUrl, token });

  const isCompactSettingsLayout = useCompactSettingsLayout();

  const {
    devLogs,
    workers,
    diagnostics,
    setDiagnostics,
    diagnosticsAvailableDates,
    setDiagnosticsAvailableDates,
    devtoolsSourceStates,
    setDevtoolsSourceStates,
    desktopAutomationEnabled,
    desktopControlEnabled,
    desktopControlStatus,
    sshConnections,
    setSshConnections,
    sshDialogs,
    sshDialogsReady,
    loadDevLogs,
    loadWorkers,
    loadDiagnostics,
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadSshConnections,
  } = useDevtoolsSources({ gatewayUrl, token });

  const {
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
  } = useSettingsData({
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
  });

  const [diagnosticsDateFilter, setDiagnosticsDateFilter] = React.useState<string | null>(null);
  const {
    handleClearDiagnostics,
    handleDesktopAutomationClick,
    handleDesktopAutomationGoto,
    handleDesktopAutomationScreenshot,
    handleDesktopAutomationStart,
    handleDesktopAutomationType,
    handleDesktopControlClick,
    handleDesktopControlHotkey,
    handleDesktopControlKey,
    handleDesktopControlScreenshot,
    handleDesktopControlScroll,
    handleDesktopControlType,
    handleDesktopControlWait,
    handleSaveGitHubTrigger,
  } = useSettingsTabActions({
    gatewayUrl,
    token,
    setDiagnostics,
    setDiagnosticsAvailableDates,
    setGithubTriggers,
  });

  const refreshDevtoolsSource = React.useCallback(
    (key: DevtoolsSourceKey) => {
      switch (key) {
        case 'devLogs':
          void loadDevLogs();
          break;
        case 'diagnostics':
          void loadDiagnostics();
          break;
        case 'desktopAutomation':
          void loadDesktopAutomationStatus();
          break;
        case 'desktopControl':
          void loadDesktopControlStatus();
          break;
        case 'sshConnections':
          void loadSshConnections();
          break;
        case 'workers':
          void loadWorkers();
          break;
        default:
          break;
      }
    },
    [
      loadDesktopAutomationStatus,
      loadDesktopControlStatus,
      loadDevLogs,
      loadDiagnostics,
      loadSshConnections,
      loadWorkers,
    ],
  );

  const refreshAllDevtoolsSources = React.useCallback(() => {
    void Promise.allSettled([
      loadDevLogs(),
      loadDiagnostics(),
      loadDesktopAutomationStatus(),
      loadDesktopControlStatus(),
      loadSshConnections(),
      loadWorkers(),
    ]);
  }, [
    loadDesktopAutomationStatus,
    loadDesktopControlStatus,
    loadDevLogs,
    loadDiagnostics,
    loadSshConnections,
    loadWorkers,
  ]);

  const exportDevLogs = React.useCallback(() => {
    const content = JSON.stringify(devLogs, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'settings-dev-logs.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [devLogs]);

  const {
    sshCurrentPath,
    sshNodes,
    sshPreview,
    activeSSHConnectionId,
    setActiveSSHConnectionId,
    loadSshFiles,
    addSshConnection,
    connectSsh,
    disconnectSsh,
    browseSshPath,
    uploadSshFile,
  } = useSettingsSsh({
    gatewayUrl,
    token,
    sshConnections,
    setSshConnections,
    sshDialogs,
    sshDialogsReady,
  });

  const connectedCount = channels.filter((c) => c.status === 'connected').length;
  const disconnectedCount = channels.filter((c) => c.status === 'disconnected').length;
  const channelsPanelLoadError = channelsLoadError ?? channelDescriptorsLoadError;

  return (
    <div className="page-root">
      <div
        className="page-content"
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            padding: isCompactSettingsLayout ? '0 16px' : '0 32px',
          }}
        >
          <div
            style={{
              display: 'grid',
              flex: 1,
              width: '100%',
              maxWidth: isCompactSettingsLayout ? '100%' : OPTIMIZED_MAX_WIDTH,
              minHeight: 0,
              margin: '0 auto',
              overflow: 'hidden',
              gridTemplateColumns: isCompactSettingsLayout
                ? 'minmax(0, 1fr)'
                : `${OPTIMIZED_NAV_WIDTH}px ${OPTIMIZED_CONTENT_GAP}px minmax(0, 1fr)`,
              gridTemplateRows: isCompactSettingsLayout ? 'auto minmax(0, 1fr)' : undefined,
            }}
          >
            <OptimizedSettingsNav
              activeTab={activeTab}
              isCompact={isCompactSettingsLayout}
              isTauri={isTauri}
              tabs={TABS}
              tauriOnlyTabIds={TAURI_ONLY_TAB_IDS}
            />
            <div
              style={{
                gridColumn: isCompactSettingsLayout ? '1' : '3',
                gridRow: isCompactSettingsLayout ? '2' : undefined,
                overflowY: 'auto',
                padding: isCompactSettingsLayout ? '16px 0' : '24px 0',
                minWidth: 0,
              }}
            >
              <div style={{ width: '100%' }}>
                {activeTab === 'connection' && (
                  <ConnectionTabContent
                    providers={providers}
                    activeSelection={activeSelection}
                    defaultThinking={defaultThinking}
                    imageGenerationDefaults={imageGenerationDefaults}
                    subagentModelPolicy={subagentModelPolicy}
                    hasUnsavedDefaultChanges={hasUnsavedDefaultModelChanges}
                    isSavingDefaultChanges={savingDefaultModelSettings}
                    setActiveSelection={setActiveSelection}
                    setDefaultThinking={setDefaultThinking}
                    setImageGenerationDefaults={setImageGenerationDefaults}
                    setSubagentModelPolicy={setSubagentModelPolicy}
                    saveDefaultModelSettings={() => {
                      void saveDefaultModelSettings();
                    }}
                    handleAddModel={handleAddModel}
                    handleRemoveModel={handleRemoveModel}
                    handleUpdateModel={handleUpdateModel}
                    handleToggleModel={handleToggleModel}
                    handleToggleProvider={handleToggleProvider}
                    handleEditProvider={handleEditProvider}
                    handleAddProvider={handleAddProvider}
                    handleRemoveProvider={handleRemoveProvider}
                    onTestModel={handleTestModel}
                    onSyncCatalog={handleSyncCatalog}
                    onDiscoverProviders={handleDiscoverProviders}
                    onImportDiscoveredProvider={handleImportDiscoveredProvider}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    saveGatewayUrl={saveGatewayUrl}
                    urlSaved={urlSaved}
                    desktopGatewayBusy={desktopGatewayBusy}
                    desktopGatewayError={desktopGatewayError}
                    desktopGatewayMode={desktopGatewayMode}
                    remoteAdminEmail={remoteAdminEmail}
                    remoteAdminPassword={remoteAdminPassword}
                    setRemoteAdminEmail={setRemoteAdminEmail}
                    setRemoteAdminPassword={setRemoteAdminPassword}
                    isTauri={isTauri}
                    savingUpstreamRetrySettings={savingUpstreamRetrySettings}
                    setUpstreamRetryMaxRetries={setUpstreamRetryMaxRetries}
                    upstreamRetryMaxRetries={upstreamRetryMaxRetries}
                    saveUpstreamRetrySettings={() => {
                      void saveUpstreamRetrySettings();
                    }}
                    savedUpstreamRetryMaxRetries={savedUpstreamRetryMaxRetries}
                    customBaseUrl={customBaseUrl}
                    setCustomBaseUrl={setCustomBaseUrl}
                    customBaseUrlSaved={customBaseUrlSaved}
                    saveCustomBaseUrl={saveCustomBaseUrl}
                  />
                )}
                {activeTab === 'display' && <DisplayTabContent />}
                {activeTab === 'channels' && (
                  <ChannelsTabContent
                    channels={channels}
                    setChannels={setChannels}
                    descriptors={channelDescriptors}
                    providers={providers.map((provider) => ({
                      id: provider.id,
                      name: provider.name,
                      defaultModels: provider.defaultModels,
                    }))}
                    loadError={channelsPanelLoadError}
                    gatewayUrl={gatewayUrl}
                    token={token}
                    connectedCount={connectedCount}
                    disconnectedCount={disconnectedCount}
                  />
                )}
                {activeTab === 'memory' && <MemoryTabContent memoryState={memoryManagement} />}
                {activeTab === 'companion' && <CompanionTabContent />}
                {activeTab === 'usage' && (
                  <UsageTabContent
                    usageRecords={usageRecords}
                    usageBudget={usageBudget}
                    monthlyCostUsd={monthlyCostUsd}
                    costBreakdown={costBreakdown}
                    priceModels={priceModels}
                    devLogs={devLogs}
                    usageRecordsError={usageRecordsError}
                    costBreakdownError={costBreakdownError}
                    priceModelsError={priceModelsError}
                  />
                )}
                {activeTab === 'security' && (
                  <SecurityTabContent
                    permissions={permissions}
                    permissionCategories={permissionCategories}
                    permissionRules={permissionRules}
                    onPermissionRulesChange={handlePermissionRulesChange}
                    permissionRulesSaving={permissionRulesSaving}
                    attribution={attribution}
                    setAttribution={setAttribution}
                    diagnostics={diagnostics}
                    diagnosticsSource={devtoolsSourceStates.diagnostics}
                  />
                )}
                {activeTab === 'workspace' && (
                  <WorkspaceTabContent
                    filePatterns={filePatterns}
                    setFilePatterns={setFilePatterns}
                    desktopAutomationEnabled={desktopAutomationEnabled}
                    desktopAutomationSourceState={devtoolsSourceStates.desktopAutomation}
                    desktopControlEnabled={desktopControlEnabled}
                    desktopControlStatus={desktopControlStatus}
                    desktopControlSourceState={devtoolsSourceStates.desktopControl}
                    sshConnections={sshConnections}
                    sshSourceState={devtoolsSourceStates.sshConnections}
                    sshNodes={sshNodes}
                    sshCurrentPath={sshCurrentPath}
                    sshPreview={sshPreview}
                    sshDialogs={sshDialogs}
                    activeSshConnectionId={activeSSHConnectionId}
                    onSelectSshDialog={(connectionId, cwd) => {
                      setActiveSSHConnectionId(connectionId);
                      // 仅对已连接的连接拉文件；未就绪的对话只高亮，避免
                      // loadSshFiles 内部因 `SSH client not connected` 兜底清空。
                      const target = sshConnections.find((c) => c.id === connectionId);
                      if (target?.status === 'connected') {
                        void loadSshFiles(connectionId, cwd || '/');
                      }
                    }}
                    onAddSshConnection={addSshConnection}
                    onConnectSsh={connectSsh}
                    onDisconnectSsh={disconnectSsh}
                    onBrowseSshPath={browseSshPath}
                    onUploadSshFile={uploadSshFile}
                    githubTriggers={githubTriggers}
                    providerUpdatesDetail={devtoolsSourceStates.providerUpdates.detail}
                    onSaveGitHubTrigger={handleSaveGitHubTrigger}
                    onDesktopAutomationStart={handleDesktopAutomationStart}
                    onDesktopAutomationGoto={handleDesktopAutomationGoto}
                    onDesktopAutomationClick={handleDesktopAutomationClick}
                    onDesktopAutomationType={handleDesktopAutomationType}
                    onDesktopAutomationScreenshot={handleDesktopAutomationScreenshot}
                    onDesktopControlScreenshot={handleDesktopControlScreenshot}
                    onDesktopControlClick={handleDesktopControlClick}
                    onDesktopControlType={handleDesktopControlType}
                    onDesktopControlKey={handleDesktopControlKey}
                    onDesktopControlHotkey={handleDesktopControlHotkey}
                    onDesktopControlScroll={handleDesktopControlScroll}
                    onDesktopControlWait={handleDesktopControlWait}
                  />
                )}
                {activeTab === 'plugins' && (
                  <PluginsTabContent
                    providers={providers}
                    activeImageProviderId={activeSelection.image?.providerId}
                    activeImageModelId={activeSelection.image?.modelId}
                  />
                )}
                {activeTab === 'desktop' && <DesktopTabContent />}
                {activeTab === 'devtools' && (
                  <DevtoolsTabContent
                    gatewayUrl={gatewayUrl}
                    devLogs={devLogs}
                    diagnostics={diagnostics}
                    diagnosticsAvailableDates={diagnosticsAvailableDates}
                    diagnosticsDateFilter={diagnosticsDateFilter}
                    onSetDiagnosticsDateFilter={setDiagnosticsDateFilter}
                    onClearDiagnostics={handleClearDiagnostics}
                    sourceStates={devtoolsSourceStates}
                    workers={workers}
                    onExportLogs={exportDevLogs}
                    onRefreshAllSources={refreshAllDevtoolsSources}
                    onRefreshSource={refreshDevtoolsSource}
                  />
                )}
                {activeTab === 'about' && <AboutPage />}
                {isEmbeddedRouteTab(activeTab) && (
                  <div
                    style={{
                      height: 'calc(100vh - 80px)',
                      margin: isCompactSettingsLayout ? '-12px 0' : '-20px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                    }}
                  >
                    <Suspense
                      fallback={
                        <PageTransitionLoader
                          variant="overlay"
                          caption="加载中"
                          title="正在加载页面"
                          description="正在加载页面资源，请稍候。"
                          prefersReducedMotion={prefersReducedMotion}
                        />
                      }
                    >
                      {activeTab === 'templates' && (
                        <PRELOADABLE_ROUTE_MODULES.templates.component />
                      )}
                      {activeTab === 'agents' && <PRELOADABLE_ROUTE_MODULES.agents.component />}
                      {activeTab === 'skills' && <PRELOADABLE_ROUTE_MODULES.skills.component />}
                      {activeTab === 'workflows' && (
                        <PRELOADABLE_ROUTE_MODULES.workflows.component />
                      )}
                      {activeTab === 'schedules' && (
                        <PRELOADABLE_ROUTE_MODULES.schedules.component />
                      )}
                      {activeTab === 'resources' && (
                        <PRELOADABLE_ROUTE_MODULES.resources.component />
                      )}
                      {activeTab === 'artifacts' && (
                        <PRELOADABLE_ROUTE_MODULES.artifacts.component />
                      )}
                      {activeTab === 'images' && <PRELOADABLE_ROUTE_MODULES.images.component />}
                      {activeTab === 'sessions' && <PRELOADABLE_ROUTE_MODULES.sessions.component />}
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
