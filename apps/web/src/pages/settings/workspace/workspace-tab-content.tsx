import React, { useRef, useState } from 'react';
import {
  ArtifactPreview,
  FileFilterSettings,
  FileTreePanel,
  type ArtifactItem,
  type FileTreeNode,
  type SSHConnectionEntry,
  type SSHAuthType,
} from '@openAwork/shared-ui';
import type { DevtoolsSourceState } from '../state/settings-types.js';
import { InlineFailureNotice } from '../devtools/devtools-workbench-primitives.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { DesktopControlActionResult, DesktopControlStatus } from '@openAwork/web-client';
import {
  SettingsSegmentedRow,
  type SettingsSegmentedOption,
} from '../shared/settings-segmented-row.js';
import { SystemDesktopControlCard } from './system-desktop-control-card.js';
import {
  WORKSPACE_ACTION_BTN,
  WORKSPACE_CARD,
  WORKSPACE_FIELD_INPUT,
  WORKSPACE_GHOST_BTN,
  WORKSPACE_ROW,
  WORKSPACE_SECTION_SUB,
  WORKSPACE_SECTION_TITLE,
} from './workspace-styles.js';

interface GitHubTriggerConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecretForHmacVerification: string;
  repoFullNameOwnerSlashRepo: string;
  events: string[];
  agentPromptTemplate: string;
  autoApproveWithoutUserConfirmation: boolean;
}

export interface WorkspaceSshDialog {
  id: string;
  connectionId: string;
  cwd: string;
  lastFilePath: string | null;
  lastOpenedAt: number;
  title?: string | null;
  pinned?: boolean;
}

interface WorkspaceTabContentProps {
  filePatterns: string[];
  setFilePatterns: React.Dispatch<React.SetStateAction<string[]>>;
  desktopAutomationEnabled: boolean;
  desktopAutomationSourceState: DevtoolsSourceState;
  desktopControlEnabled: boolean;
  desktopControlStatus: DesktopControlStatus | null;
  desktopControlSourceState: DevtoolsSourceState;
  sshConnections: SSHConnectionEntry[];
  sshSourceState: DevtoolsSourceState;
  sshNodes: FileTreeNode[];
  sshCurrentPath: string;
  sshPreview: (ArtifactItem & { content?: string }) | null;
  /**
   * 最近 N 个 SSH 对话（按 lastOpenedAt 降序）。重启后由 `/ssh/dialogs`
   * 端点回灌；未启用持久化的旧 gateway 会下发空数组，UI 会自动隐藏。
   */
  sshDialogs: WorkspaceSshDialog[];
  activeSshConnectionId: string | null;
  onSelectSshDialog: (connectionId: string, cwd: string) => void;
  onAddSshConnection: (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => void;
  onConnectSsh: (id: string) => void;
  onDisconnectSsh: (id: string) => void;
  onBrowseSshPath: (path: string) => void;
  onUploadSshFile: (file: File) => void;
  githubTriggers: Array<{ repo: string; events: string[] }>;
  providerUpdatesDetail: string;
  onSaveGitHubTrigger: (config: GitHubTriggerConfig) => Promise<void>;
  onDesktopAutomationStart: (url?: string) => Promise<void>;
  onDesktopAutomationGoto: (url: string) => Promise<void>;
  onDesktopAutomationClick: (selector: string) => Promise<void>;
  onDesktopAutomationType: (selector: string, text: string) => Promise<void>;
  onDesktopAutomationScreenshot: () => Promise<string>;
  onDesktopControlScreenshot: (delayMs?: number) => Promise<DesktopControlActionResult>;
  onDesktopControlClick: (x: number, y: number) => Promise<DesktopControlActionResult>;
  onDesktopControlType: (text: string) => Promise<DesktopControlActionResult>;
  onDesktopControlKey: (key: string) => Promise<DesktopControlActionResult>;
  onDesktopControlHotkey: (keys: readonly string[]) => Promise<DesktopControlActionResult>;
  onDesktopControlScroll: (scrollX: number, scrollY: number) => Promise<DesktopControlActionResult>;
  onDesktopControlWait: (ms?: number) => Promise<DesktopControlActionResult>;
}

const DASHED_CARD: React.CSSProperties = {
  borderRadius: 8,
  border: '1px dashed var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 94%, var(--bg-base))',
  padding: '8px 10px',
};

const BADGE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 15,
  height: 15,
  borderRadius: 8,
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 9,
  fontWeight: 700,
  padding: '0 4px',
  marginLeft: 5,
};

const ACTIVE_BADGE: React.CSSProperties = {
  ...BADGE,
  background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  color: 'var(--accent)',
  border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
};

const DANGER_BTN: React.CSSProperties = {
  ...WORKSPACE_GHOST_BTN,
  color: 'var(--danger)',
  borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
};

function eventPillStyle(event: string): React.CSSProperties {
  let bg = 'color-mix(in srgb, var(--fg-muted) 18%, transparent)';
  let color = 'var(--fg-default)';
  if (event.startsWith('push')) {
    bg = 'color-mix(in srgb, var(--aux) 18%, transparent)';
    color = 'var(--aux)';
  } else if (event.startsWith('pull_request')) {
    bg = 'color-mix(in srgb, var(--chart-5) 18%, transparent)';
    color = 'var(--chart-5)';
  } else if (event.startsWith('issues')) {
    bg = 'color-mix(in srgb, var(--warning) 18%, transparent)';
    color = 'var(--warning)';
  } else if (event.startsWith('workflow_run')) {
    bg = 'color-mix(in srgb, var(--success) 18%, transparent)';
    color = 'var(--success)';
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 7px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: bg,
    color,
  };
}

const TRIGGER_SCHEMA = `POST /github/triggers
{
  "appId": "<github-app-id>",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
  "webhookSecretForHmacVerification": "<webhook-secret>",
  "repoFullNameOwnerSlashRepo": "org/repo",
  "events": ["push", "pull_request.opened"],
  "agentPromptTemplate": "分析 {{repo}} 的 {{event}} 事件",
  "autoApproveWithoutUserConfirmation": false
}`;

const EMPTY_SSH_FORM = {
  host: '',
  port: '22',
  username: '',
  name: '',
  authType: 'password' as const,
};

function CapabilityGrid({ enabled }: { enabled: boolean }) {
  const items = ['打开页面', '点击操作', '表单输入', '截图'];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '4px 8px',
        marginTop: 8,
      }}
    >
      {items.map((cap) => (
        <div
          key={cap}
          style={{
            ...WORKSPACE_ROW,
            fontSize: 10,
            color: enabled ? 'var(--accent)' : 'var(--fg-muted)',
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 700 }}>{enabled ? '✓' : '○'}</span>
          <span>{cap}</span>
        </div>
      ))}
    </div>
  );
}

function BreadcrumbPath({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean);
  return (
    <div
      style={{
        ...WORKSPACE_ROW,
        flexWrap: 'wrap',
        fontSize: 10,
        color: 'var(--fg-muted)',
        marginBottom: 6,
      }}
    >
      <button
        type="button"
        onClick={() => onNavigate('/')}
        style={{ ...WORKSPACE_GHOST_BTN, padding: '2px 5px', fontSize: 10 }}
      >
        /
      </button>
      {parts.map((part, i) => {
        const target = '/' + parts.slice(0, i + 1).join('/');
        return (
          <React.Fragment key={target}>
            <span style={{ opacity: 0.4 }}>/</span>
            <button
              type="button"
              onClick={() => onNavigate(target)}
              style={{ ...WORKSPACE_GHOST_BTN, padding: '2px 5px', fontSize: 10 }}
            >
              {part}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

const GITHUB_EVENTS = [
  'push',
  'pull_request.opened',
  'pull_request.synchronize',
  'issues.opened',
  'workflow_run.completed',
] as const;

const EMPTY_TRIGGER_FORM = {
  repo: '',
  appId: '',
  webhookSecret: '',
  privateKeyPem: '',
  events: [] as string[],
  agentPromptTemplate: '',
  autoApprove: false,
};

type AutomationActionType = 'open' | 'goto' | 'click' | 'type' | 'screenshot';

const AUTOMATION_ACTION_OPTIONS: ReadonlyArray<SettingsSegmentedOption<AutomationActionType>> = [
  { value: 'open', label: '打开页面' },
  { value: 'goto', label: '跳转' },
  { value: 'click', label: '点击' },
  { value: 'type', label: '输入' },
  { value: 'screenshot', label: '截图' },
];

export function WorkspaceTabContent({
  filePatterns,
  setFilePatterns,
  desktopAutomationEnabled,
  desktopAutomationSourceState,
  desktopControlEnabled,
  desktopControlStatus,
  desktopControlSourceState,
  sshConnections,
  sshSourceState,
  sshNodes,
  sshCurrentPath,
  sshPreview,
  sshDialogs,
  activeSshConnectionId,
  onSelectSshDialog,
  onAddSshConnection,
  onConnectSsh,
  onDisconnectSsh,
  onBrowseSshPath,
  onUploadSshFile,
  githubTriggers,
  providerUpdatesDetail,
  onSaveGitHubTrigger,
  onDesktopAutomationStart,
  onDesktopAutomationGoto,
  onDesktopAutomationClick,
  onDesktopAutomationType,
  onDesktopAutomationScreenshot,
  onDesktopControlScreenshot,
  onDesktopControlClick,
  onDesktopControlType,
  onDesktopControlKey,
  onDesktopControlHotkey,
  onDesktopControlScroll,
  onDesktopControlWait,
}: WorkspaceTabContentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sshForm, setSshForm] = useState(EMPTY_SSH_FORM);
  const [showTriggerSchema, setShowTriggerSchema] = useState(false);
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [triggerForm, setTriggerForm] = useState(EMPTY_TRIGGER_FORM);
  const [isSubmittingTrigger, setIsSubmittingTrigger] = useState(false);
  const [automationAction, setAutomationAction] = useState<AutomationActionType>('open');
  const [automationUrl, setAutomationUrl] = useState('');
  const [automationSelector, setAutomationSelector] = useState('');
  const [automationText, setAutomationText] = useState('');
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationResult, setAutomationResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );
  const [screenshotData, setScreenshotData] = useState<string | null>(null);
  const connectedCount = sshConnections.filter((c) => c.status === 'connected').length;

  function handleAddSsh() {
    if (!sshForm.host || !sshForm.username) return;
    const entry: Omit<SSHConnectionEntry, 'id' | 'status'> = {
      name: sshForm.name || sshForm.host,
      host: sshForm.host,
      port: parseInt(sshForm.port, 10) || 22,
      username: sshForm.username,
      authType: sshForm.authType as SSHAuthType,
    };
    onAddSshConnection(entry);
    setSshForm(EMPTY_SSH_FORM);
    setShowAddForm(false);
  }

  async function handleSaveTrigger() {
    if (!triggerForm.repo || !triggerForm.appId) return;
    setIsSubmittingTrigger(true);
    try {
      await onSaveGitHubTrigger({
        appId: triggerForm.appId,
        privateKeyPem: triggerForm.privateKeyPem,
        webhookSecretForHmacVerification: triggerForm.webhookSecret,
        repoFullNameOwnerSlashRepo: triggerForm.repo,
        events: triggerForm.events,
        agentPromptTemplate: triggerForm.agentPromptTemplate,
        autoApproveWithoutUserConfirmation: triggerForm.autoApprove,
      });
      setTriggerForm(EMPTY_TRIGGER_FORM);
      setShowTriggerForm(false);
    } finally {
      setIsSubmittingTrigger(false);
    }
  }

  async function handleAutomationRun() {
    setAutomationLoading(true);
    setAutomationResult(null);
    setScreenshotData(null);
    try {
      if (automationAction === 'open') {
        await onDesktopAutomationStart(automationUrl || undefined);
        setAutomationResult({ ok: true, msg: '已启动' });
      } else if (automationAction === 'goto') {
        await onDesktopAutomationGoto(automationUrl);
        setAutomationResult({ ok: true, msg: '已跳转' });
      } else if (automationAction === 'click') {
        await onDesktopAutomationClick(automationSelector);
        setAutomationResult({ ok: true, msg: '已点击' });
      } else if (automationAction === 'type') {
        await onDesktopAutomationType(automationSelector, automationText);
        setAutomationResult({ ok: true, msg: '已输入' });
      } else if (automationAction === 'screenshot') {
        const base64 = await onDesktopAutomationScreenshot();
        setScreenshotData(base64);
        setAutomationResult({ ok: true, msg: '截图成功' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      setAutomationResult({ ok: false, msg });
    } finally {
      setAutomationLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SessionListPathFilterFeatureToggle />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 8,
          alignItems: 'start',
        }}
      >
        <div style={{ ...WORKSPACE_CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={WORKSPACE_ROW}>
            <h3 style={{ ...WORKSPACE_SECTION_TITLE, margin: 0 }}>文件过滤规则</h3>
            {filePatterns.length > 0 && <span style={BADGE}>{filePatterns.length}</span>}
            <span style={{ ...WORKSPACE_SECTION_SUB, marginTop: 0, marginLeft: 'auto' }}>
              .crushignore 规则
            </span>
          </div>
          <div
            style={{
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              overflow: 'hidden',
            }}
          >
            <FileFilterSettings
              patterns={filePatterns}
              onAdd={(p) => setFilePatterns((prev) => [...prev, p])}
              onRemove={(p) => setFilePatterns((prev) => prev.filter((x) => x !== p))}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {filePatterns.map((p) => (
              <div
                key={p}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                  border: '1px solid var(--border-default)',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: 'var(--fg-default)',
                }}
              >
                <span>{p}</span>
                <button
                  type="button"
                  onClick={() => setFilePatterns((prev) => prev.filter((x) => x !== p))}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--fg-muted)',
                    fontSize: 11,
                    padding: 0,
                    lineHeight: 1,
                    display: 'flex',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              paddingTop: 3,
              borderTop: '1px solid var(--border-default)',
            }}
          >
            <span style={{ fontSize: 8, color: 'var(--accent)', fontWeight: 700 }}>●</span>
            <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
              规则已自动保存到 .crushignore
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={WORKSPACE_CARD}>
            {desktopAutomationSourceState.status === 'error' &&
            desktopAutomationSourceState.error ? (
              <InlineFailureNotice
                title="桌面自动化状态加载失败"
                message={desktopAutomationSourceState.error}
              />
            ) : null}
            <div style={{ ...WORKSPACE_ROW, justifyContent: 'space-between' }}>
              <div style={WORKSPACE_ROW}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: desktopAutomationEnabled ? 'var(--success)' : 'var(--fg-muted)',
                    flexShrink: 0,
                  }}
                />
                <h3 style={{ ...WORKSPACE_SECTION_TITLE, margin: 0 }}>桌面自动化</h3>
              </div>
            </div>
            <CapabilityGrid enabled={desktopAutomationEnabled} />
            <div
              style={{
                marginTop: 5,
                paddingTop: 5,
                borderTop: '1px solid var(--border-default)',
                fontSize: 10,
                color: desktopAutomationEnabled ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              当前模式：{desktopAutomationEnabled ? '桌面 Sidecar' : 'Web 降级'}
            </div>
            {desktopAutomationEnabled ? (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid var(--border-default)',
                }}
              >
                <span
                  style={{ ...WORKSPACE_SECTION_SUB, fontWeight: 700, color: 'var(--fg-default)' }}
                >
                  操作控制台
                </span>
                <SettingsSegmentedRow
                  ariaLabel="桌面自动化动作"
                  options={AUTOMATION_ACTION_OPTIONS}
                  value={automationAction}
                  onChange={(next) => {
                    setAutomationAction(next);
                    setAutomationResult(null);
                    setScreenshotData(null);
                  }}
                />
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(automationAction === 'open' || automationAction === 'goto') && (
                    <input
                      style={WORKSPACE_FIELD_INPUT}
                      placeholder="https://..."
                      value={automationUrl}
                      onChange={(e) => setAutomationUrl(e.target.value)}
                    />
                  )}
                  {(automationAction === 'click' || automationAction === 'type') && (
                    <input
                      style={WORKSPACE_FIELD_INPUT}
                      placeholder="CSS 选择器"
                      value={automationSelector}
                      onChange={(e) => setAutomationSelector(e.target.value)}
                    />
                  )}
                  {automationAction === 'type' && (
                    <input
                      style={WORKSPACE_FIELD_INPUT}
                      placeholder="输入内容"
                      value={automationText}
                      onChange={(e) => setAutomationText(e.target.value)}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void handleAutomationRun()}
                    disabled={automationLoading}
                    style={{
                      ...WORKSPACE_ACTION_BTN,
                      opacity: automationLoading ? 0.6 : 1,
                      alignSelf: 'flex-start',
                    }}
                  >
                    {automationLoading
                      ? '执行中\u2026'
                      : {
                          open: '启动',
                          goto: '跳转',
                          click: '点击',
                          type: '输入',
                          screenshot: '截图',
                        }[automationAction]}
                  </button>
                  {automationResult && (
                    <div
                      style={{
                        fontSize: 10,
                        padding: '4px 8px',
                        borderRadius: 5,
                        background: automationResult.ok
                          ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                          : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                        color: automationResult.ok ? 'var(--success)' : 'var(--danger)',
                        border: `1px solid ${automationResult.ok ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'}`,
                      }}
                    >
                      {automationResult.msg}
                    </div>
                  )}
                  {screenshotData && (
                    <img
                      src={`data:image/png;base64,${screenshotData}`}
                      alt="截图"
                      style={{
                        maxWidth: '100%',
                        borderRadius: 6,
                        border: '1px solid var(--border-default)',
                        marginTop: 4,
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--border-default)',
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>🔒</span>
                <span>桌面 Sidecar 未启用，操作控制台不可用</span>
              </div>
            )}
          </div>

          <SystemDesktopControlCard
            desktopControlEnabled={desktopControlEnabled}
            desktopControlStatus={desktopControlStatus}
            desktopControlSourceState={desktopControlSourceState}
            onDesktopControlScreenshot={onDesktopControlScreenshot}
            onDesktopControlClick={onDesktopControlClick}
            onDesktopControlType={onDesktopControlType}
            onDesktopControlKey={onDesktopControlKey}
            onDesktopControlHotkey={onDesktopControlHotkey}
            onDesktopControlScroll={onDesktopControlScroll}
            onDesktopControlWait={onDesktopControlWait}
          />

          <div style={DASHED_CARD}>
            <div style={{ ...WORKSPACE_ROW, marginBottom: 8 }}>
              <h3 style={{ ...WORKSPACE_SECTION_TITLE, margin: 0 }}>GitHub 触发器</h3>
              {githubTriggers.length > 0 && <span style={BADGE}>{githubTriggers.length}</span>}
              <button
                type="button"
                onClick={() => setShowTriggerForm((v) => !v)}
                style={{ ...WORKSPACE_ACTION_BTN, marginLeft: 'auto', fontSize: 10 }}
              >
                + 注册触发器
              </button>
            </div>
            {githubTriggers.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '12px 0',
                }}
              >
                <span style={{ fontSize: 18, opacity: 0.5 }}>⚡</span>
                <p style={{ ...WORKSPACE_SECTION_SUB, textAlign: 'center', margin: 0 }}>
                  尚未配置 GitHub 触发器
                </p>
                <p style={{ ...WORKSPACE_SECTION_SUB, textAlign: 'center', margin: 0 }}>
                  通过 API 注册触发器后，此处会显示实时状态
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {githubTriggers.map((t) => (
                  <div
                    key={t.repo}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '6px 8px',
                      borderRadius: 7,
                      background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--fg-strong)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.repo}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {t.events.map((ev) => (
                        <span key={ev} style={eventPillStyle(ev)}>
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showTriggerForm && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px dashed var(--border-default)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
                }}
              >
                <input
                  style={WORKSPACE_FIELD_INPUT}
                  placeholder="org/repo"
                  value={triggerForm.repo}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, repo: e.target.value }))}
                />
                <input
                  style={WORKSPACE_FIELD_INPUT}
                  placeholder="App ID"
                  value={triggerForm.appId}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, appId: e.target.value }))}
                />
                <input
                  type="password"
                  style={WORKSPACE_FIELD_INPUT}
                  placeholder="Webhook Secret"
                  value={triggerForm.webhookSecret}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                />
                <textarea
                  rows={4}
                  style={{ ...WORKSPACE_FIELD_INPUT, resize: 'vertical', fontFamily: 'monospace' }}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                  value={triggerForm.privateKeyPem}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, privateKeyPem: e.target.value }))}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span
                    style={{
                      ...WORKSPACE_SECTION_SUB,
                      color: 'var(--fg-default)',
                      fontWeight: 600,
                    }}
                  >
                    事件
                  </span>
                  {GITHUB_EVENTS.map((ev) => (
                    <label
                      key={ev}
                      style={{
                        ...WORKSPACE_ROW,
                        fontSize: 10,
                        color: 'var(--fg-default)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={triggerForm.events.includes(ev)}
                        onChange={(e) =>
                          setTriggerForm((f) => ({
                            ...f,
                            events: e.target.checked
                              ? [...f.events, ev]
                              : f.events.filter((x) => x !== ev),
                          }))
                        }
                      />
                      <span style={eventPillStyle(ev)}>{ev}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  rows={3}
                  style={{ ...WORKSPACE_FIELD_INPUT, resize: 'vertical' }}
                  placeholder="分析 {{repo}} 仓库的 {{event}} 事件\u2026"
                  value={triggerForm.agentPromptTemplate}
                  onChange={(e) =>
                    setTriggerForm((f) => ({ ...f, agentPromptTemplate: e.target.value }))
                  }
                />
                <label
                  style={{
                    ...WORKSPACE_ROW,
                    fontSize: 10,
                    color: 'var(--fg-default)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={triggerForm.autoApprove}
                    onChange={(e) =>
                      setTriggerForm((f) => ({ ...f, autoApprove: e.target.checked }))
                    }
                  />
                  <span>自动批准（无需用户确认）</span>
                </label>
                <div style={{ ...WORKSPACE_ROW, justifyContent: 'flex-end', gap: 8 }}>
                  {isSubmittingTrigger && (
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>保存中\u2026</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowTriggerForm(false);
                      setTriggerForm(EMPTY_TRIGGER_FORM);
                    }}
                    style={WORKSPACE_GHOST_BTN}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveTrigger()}
                    disabled={isSubmittingTrigger}
                    style={{ ...WORKSPACE_ACTION_BTN, opacity: isSubmittingTrigger ? 0.6 : 1 }}
                  >
                    注册触发器
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowTriggerSchema((v) => !v)}
              style={{
                ...WORKSPACE_GHOST_BTN,
                marginTop: 8,
                width: '100%',
                textAlign: 'left',
                fontSize: 10,
              }}
            >
              查看配置格式 {showTriggerSchema ? '▴' : '▾'}
            </button>
            {showTriggerSchema && (
              <pre
                style={{
                  margin: '6px 0 0',
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'color-mix(in srgb, var(--bg-base) 80%, var(--bg-overlay))',
                  border: '1px solid var(--border-default)',
                  fontSize: 10,
                  color: 'var(--fg-default)',
                  overflowX: 'auto',
                  lineHeight: 1.6,
                }}
              >
                {TRIGGER_SCHEMA}
              </pre>
            )}
          </div>

          {providerUpdatesDetail ? (
            <p style={{ ...WORKSPACE_SECTION_SUB, marginTop: 6 }}>{providerUpdatesDetail}</p>
          ) : null}
        </div>
      </div>

      <div style={WORKSPACE_CARD}>
        {sshSourceState.status === 'error' && sshSourceState.error ? (
          <InlineFailureNotice title="SSH 连接加载失败" message={sshSourceState.error} />
        ) : null}
        <div style={{ ...WORKSPACE_ROW, marginBottom: 8 }}>
          <h3 style={{ ...WORKSPACE_SECTION_TITLE, margin: 0 }}>SSH 连接</h3>
          {sshConnections.length > 0 && <span style={BADGE}>{sshConnections.length}</span>}
          {connectedCount > 0 && <span style={ACTIVE_BADGE}>连接中 {connectedCount}</span>}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            style={{ ...WORKSPACE_ACTION_BTN, marginLeft: 'auto' }}
          >
            + 添加连接
          </button>
        </div>

        {sshDialogs.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 8,
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px dashed var(--border-default)',
              background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', alignSelf: 'center' }}>
              最近 SSH 对话
            </span>
            {sshDialogs.slice(0, 8).map((dialog) => {
              const conn = sshConnections.find((c) => c.id === dialog.connectionId);
              const label = conn?.name || conn?.host || dialog.connectionId.slice(0, 6);
              const isActive = activeSshConnectionId === dialog.connectionId;
              const tooltip = `${label}\n${dialog.cwd || '/'}${dialog.lastFilePath ? `\n${dialog.lastFilePath}` : ''}`;
              return (
                <button
                  key={dialog.id}
                  type="button"
                  title={tooltip}
                  onClick={() => onSelectSshDialog?.(dialog.connectionId, dialog.cwd || '/')}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: isActive
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border-default)',
                    color: isActive ? 'var(--accent)' : 'var(--fg-default)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                      : 'transparent',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {dialog.pinned ? '📌' : '🖥'} {label}
                  <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                    {(dialog.cwd || '/').replace(/\/$/, '') || '/'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {sshConnections.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
            {sshConnections.map((conn) => (
              <div
                key={conn.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 7,
                  border: '1px solid var(--border-default)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    flexShrink: 0,
                  }}
                >
                  {'>_'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--fg-strong)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {conn.host}:{conn.port}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>{conn.username}</div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background:
                      conn.status === 'connected'
                        ? 'color-mix(in srgb, var(--success) 18%, transparent)'
                        : 'color-mix(in srgb, var(--fg-muted) 15%, transparent)',
                    color: conn.status === 'connected' ? 'var(--success)' : 'var(--fg-muted)',
                  }}
                >
                  {conn.status === 'connected' ? '已连接' : '断开'}
                </span>
                {conn.status === 'connected' ? (
                  <button type="button" onClick={() => onDisconnectSsh(conn.id)} style={DANGER_BTN}>
                    断开
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConnectSsh(conn.id)}
                    style={WORKSPACE_ACTION_BTN}
                  >
                    连接
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showAddForm && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 6,
              padding: 10,
              borderRadius: 7,
              border: '1px dashed var(--border-default)',
              background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
              marginBottom: 8,
            }}
          >
            <input
              style={WORKSPACE_FIELD_INPUT}
              placeholder="主机名 / IP"
              value={sshForm.host}
              onChange={(e) => setSshForm((f) => ({ ...f, host: e.target.value }))}
            />
            <input
              style={WORKSPACE_FIELD_INPUT}
              placeholder="端口（默认 22）"
              value={sshForm.port}
              onChange={(e) => setSshForm((f) => ({ ...f, port: e.target.value }))}
            />
            <input
              style={WORKSPACE_FIELD_INPUT}
              placeholder="用户名"
              value={sshForm.username}
              onChange={(e) => setSshForm((f) => ({ ...f, username: e.target.value }))}
            />
            <input
              style={WORKSPACE_FIELD_INPUT}
              placeholder="标签（可选）"
              value={sshForm.name}
              onChange={(e) => setSshForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div
              style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, justifyContent: 'flex-end' }}
            >
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={WORKSPACE_GHOST_BTN}
              >
                取消
              </button>
              <button type="button" onClick={handleAddSsh} style={WORKSPACE_ACTION_BTN}>
                确认添加
              </button>
            </div>
          </div>
        )}

        {sshConnections.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <BreadcrumbPath path={sshCurrentPath || '/'} onNavigate={onBrowseSshPath} />
              <div
                style={{ ...WORKSPACE_CARD, padding: '4px 6px', maxHeight: 300, overflowY: 'auto' }}
              >
                <FileTreePanel
                  nodes={sshNodes}
                  onFileClick={(p) => onBrowseSshPath(p)}
                  viewMode="tree"
                />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadSshFile(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={WORKSPACE_GHOST_BTN}
              >
                上传到当前目录
              </button>
            </div>
            <div
              style={{ ...WORKSPACE_CARD, padding: '6px 8px', maxHeight: 300, overflowY: 'auto' }}
            >
              {sshPreview ? (
                <ArtifactPreview
                  artifact={sshPreview}
                  onDownload={() => undefined}
                  onShare={() => undefined}
                />
              ) : (
                <p style={{ fontSize: 10, color: 'var(--fg-muted)', margin: 0 }}>
                  选择远程文件以预览。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * T-PATH-04 (workflow 260509): admin-style toggle that disables the
 * sidebar's "仅当前目录" feature outright. Off → useSessions drops
 * the `path=` query AND the SessionSidebar hides the per-tab toggle,
 * effectively pinning the legacy global session listing for users
 * who don't want the path-scoping UX.
 */
function SessionListPathFilterFeatureToggle(): React.ReactElement {
  const enabled = useUIStateStore((s) => s.sessionListPathFilterFeatureEnabled);
  const setEnabled = useUIStateStore((s) => s.setSessionListPathFilterFeatureEnabled);
  return (
    <div
      style={{
        ...WORKSPACE_CARD,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{ flex: 1 }}>
        <h3 style={{ ...WORKSPACE_SECTION_TITLE, margin: 0 }}>会话路径过滤</h3>
        <p style={{ ...WORKSPACE_SECTION_SUB, marginTop: 4 }}>
          开启后，侧边栏会出现「仅当前目录」开关，可把会话列表限定在当前选中的工作区目录下。
          关闭则全局停用，所有 list 调用回到无过滤模式。
        </p>
      </div>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--fg-default)',
          cursor: 'pointer',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ margin: 0 }}
        />
        启用
      </label>
    </div>
  );
}
