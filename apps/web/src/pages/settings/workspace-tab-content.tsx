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
import type { DevtoolsSourceState } from '../settings-types.js';
import { InlineFailureNotice } from './devtools-workbench-primitives.js';

interface GitHubTriggerConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecretForHmacVerification: string;
  repoFullNameOwnerSlashRepo: string;
  events: string[];
  agentPromptTemplate: string;
  autoApproveWithoutUserConfirmation: boolean;
}

interface WorkspaceTabContentProps {
  filePatterns: string[];
  setFilePatterns: React.Dispatch<React.SetStateAction<string[]>>;
  desktopAutomationEnabled: boolean;
  desktopAutomationSourceState: DevtoolsSourceState;
  sshConnections: SSHConnectionEntry[];
  sshSourceState: DevtoolsSourceState;
  sshNodes: FileTreeNode[];
  sshCurrentPath: string;
  sshPreview: (ArtifactItem & { content?: string }) | null;
  onAddSshConnection: (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => void;
  onConnectSsh: (id: string) => void;
  onDisconnectSsh: (id: string) => void;
  onBrowseSshPath: (path: string) => void;
  onUploadSshFile: (file: File) => void;
  githubTriggers: Array<{ repo: string; events: string[] }>;
  providerUpdatesDetail: string;
  versionInfo: {
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    checkError: string | null;
    checkedAt: string | null;
    checking: boolean;
  };
  onCheckVersion: () => Promise<void>;
  onSaveGitHubTrigger: (config: GitHubTriggerConfig) => Promise<void>;
  onDesktopAutomationStart: (url?: string) => Promise<void>;
  onDesktopAutomationGoto: (url: string) => Promise<void>;
  onDesktopAutomationClick: (selector: string) => Promise<void>;
  onDesktopAutomationType: (selector: string, text: string) => Promise<void>;
  onDesktopAutomationScreenshot: () => Promise<string>;
}

const CARD: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
  padding: '8px 10px',
};

const DASHED_CARD: React.CSSProperties = {
  borderRadius: 8,
  border: '1px dashed var(--border)',
  background: 'color-mix(in srgb, var(--surface) 94%, var(--bg))',
  padding: '8px 10px',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text)',
  margin: 0,
  lineHeight: 1.3,
  letterSpacing: '0.01em',
};

const SECTION_SUB: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-3)',
  margin: 0,
  marginTop: 2,
  lineHeight: 1.4,
};

const BADGE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 15,
  height: 15,
  borderRadius: 8,
  background: 'var(--accent)',
  color: 'var(--accent-text)',
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

const ACTION_BTN: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  fontSize: 10,
  fontWeight: 600,
  padding: '4px 9px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const GHOST_BTN: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 10,
  padding: '4px 8px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const DANGER_BTN: React.CSSProperties = {
  ...GHOST_BTN,
  color: 'var(--danger)',
  borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
};

const FIELD_INPUT: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--bg) 70%, var(--surface))',
  color: 'var(--text)',
  fontSize: 10,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

function eventPillStyle(event: string): React.CSSProperties {
  let bg = 'color-mix(in srgb, var(--text-3) 18%, transparent)';
  let color = 'var(--text-2)';
  if (event.startsWith('push')) {
    bg = 'color-mix(in srgb, #3b82f6 18%, transparent)';
    color = '#3b82f6';
  } else if (event.startsWith('pull_request')) {
    bg = 'color-mix(in srgb, #a855f7 18%, transparent)';
    color = '#a855f7';
  } else if (event.startsWith('issues')) {
    bg = 'color-mix(in srgb, #f97316 18%, transparent)';
    color = '#f97316';
  } else if (event.startsWith('workflow_run')) {
    bg = 'color-mix(in srgb, #22c55e 18%, transparent)';
    color = '#22c55e';
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
  "repo": "org/repo",
  "events": ["push", "pull_request.*"],
  "agentId": "<your-agent-id>"
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', marginTop: 8 }}>
      {items.map((cap) => (
        <div
          key={cap}
          style={{ ...ROW, fontSize: 10, color: enabled ? 'var(--accent)' : 'var(--text-3)' }}
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
      style={{ ...ROW, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}
    >
      <button
        type="button"
        onClick={() => onNavigate('/')}
        style={{ ...GHOST_BTN, padding: '2px 5px', fontSize: 10 }}
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
              style={{ ...GHOST_BTN, padding: '2px 5px', fontSize: 10 }}
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

export function WorkspaceTabContent({
  filePatterns,
  setFilePatterns,
  desktopAutomationEnabled,
  desktopAutomationSourceState,
  sshConnections,
  sshSourceState,
  sshNodes,
  sshCurrentPath,
  sshPreview,
  onAddSshConnection,
  onConnectSsh,
  onDisconnectSsh,
  onBrowseSshPath,
  onUploadSshFile,
  githubTriggers,
  providerUpdatesDetail,
  versionInfo,
  onCheckVersion,
  onSaveGitHubTrigger,
  onDesktopAutomationStart,
  onDesktopAutomationGoto,
  onDesktopAutomationClick,
  onDesktopAutomationType,
  onDesktopAutomationScreenshot,
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start' }}>
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={ROW}>
            <span style={SECTION_TITLE}>文件过滤规则</span>
            {filePatterns.length > 0 && <span style={BADGE}>{filePatterns.length}</span>}
            <span style={{ ...SECTION_SUB, marginTop: 0, marginLeft: 'auto' }}>
              .crushignore 规则
            </span>
          </div>
          <div style={{ borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
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
                  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: 'var(--text-2)',
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
                    color: 'var(--text-3)',
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
              borderTop: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 8, color: 'var(--accent)', fontWeight: 700 }}>●</span>
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
              规则已自动保存到 .crushignore
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={CARD}>
            {desktopAutomationSourceState.status === 'error' &&
            desktopAutomationSourceState.error ? (
              <InlineFailureNotice
                title="桌面自动化状态加载失败"
                message={desktopAutomationSourceState.error}
              />
            ) : null}
            <div style={{ ...ROW, justifyContent: 'space-between' }}>
              <div style={ROW}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: desktopAutomationEnabled ? '#22c55e' : 'var(--text-3)',
                    flexShrink: 0,
                  }}
                />
                <span style={SECTION_TITLE}>桌面自动化</span>
              </div>
            </div>
            <CapabilityGrid enabled={desktopAutomationEnabled} />
            <div
              style={{
                marginTop: 5,
                paddingTop: 5,
                borderTop: '1px solid var(--border)',
                fontSize: 10,
                color: desktopAutomationEnabled ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              当前模式：{desktopAutomationEnabled ? '桌面 Sidecar' : 'Web 降级'}
            </div>
            {desktopAutomationEnabled ? (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <span style={{ ...SECTION_SUB, fontWeight: 700, color: 'var(--text-2)' }}>
                  操作控制台
                </span>
                <div style={{ ...ROW, marginTop: 8, flexWrap: 'wrap', gap: 4 }}>
                  {(['open', 'goto', 'click', 'type', 'screenshot'] as AutomationActionType[]).map(
                    (act) => {
                      const labels: Record<AutomationActionType, string> = {
                        open: '打开页面',
                        goto: '跳转',
                        click: '点击',
                        type: '输入',
                        screenshot: '截图',
                      };
                      return (
                        <button
                          key={act}
                          type="button"
                          onClick={() => {
                            setAutomationAction(act);
                            setAutomationResult(null);
                            setScreenshotData(null);
                          }}
                          style={{
                            ...GHOST_BTN,
                            fontSize: 10,
                            background:
                              automationAction === act
                                ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                                : 'transparent',
                            borderColor:
                              automationAction === act ? 'var(--accent)' : 'var(--border)',
                            color: automationAction === act ? 'var(--accent)' : 'var(--text-2)',
                          }}
                        >
                          {labels[act]}
                        </button>
                      );
                    },
                  )}
                </div>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(automationAction === 'open' || automationAction === 'goto') && (
                    <input
                      style={FIELD_INPUT}
                      placeholder="https://..."
                      value={automationUrl}
                      onChange={(e) => setAutomationUrl(e.target.value)}
                    />
                  )}
                  {(automationAction === 'click' || automationAction === 'type') && (
                    <input
                      style={FIELD_INPUT}
                      placeholder="CSS 选择器"
                      value={automationSelector}
                      onChange={(e) => setAutomationSelector(e.target.value)}
                    />
                  )}
                  {automationAction === 'type' && (
                    <input
                      style={FIELD_INPUT}
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
                      ...ACTION_BTN,
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
                          ? 'color-mix(in srgb, #22c55e 15%, transparent)'
                          : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                        color: automationResult.ok ? '#22c55e' : 'var(--danger)',
                        border: `1px solid ${automationResult.ok ? 'color-mix(in srgb, #22c55e 35%, transparent)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'}`,
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
                        border: '1px solid var(--border)',
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
                  borderTop: '1px solid var(--border)',
                  fontSize: 10,
                  color: 'var(--text-3)',
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

          <div style={DASHED_CARD}>
            <div style={{ ...ROW, marginBottom: 8 }}>
              <span style={SECTION_TITLE}>GitHub 触发器</span>
              {githubTriggers.length > 0 && <span style={BADGE}>{githubTriggers.length}</span>}
              <button
                type="button"
                onClick={() => setShowTriggerForm((v) => !v)}
                style={{ ...ACTION_BTN, marginLeft: 'auto', fontSize: 10 }}
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
                <p style={{ ...SECTION_SUB, textAlign: 'center', margin: 0 }}>
                  尚未配置 GitHub 触发器
                </p>
                <p style={{ ...SECTION_SUB, textAlign: 'center', margin: 0 }}>
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
                      background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--text)',
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
                  border: '1px dashed var(--border)',
                  background: 'color-mix(in srgb, var(--surface) 60%, var(--bg))',
                }}
              >
                <input
                  style={FIELD_INPUT}
                  placeholder="org/repo"
                  value={triggerForm.repo}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, repo: e.target.value }))}
                />
                <input
                  style={FIELD_INPUT}
                  placeholder="App ID"
                  value={triggerForm.appId}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, appId: e.target.value }))}
                />
                <input
                  type="password"
                  style={FIELD_INPUT}
                  placeholder="Webhook Secret"
                  value={triggerForm.webhookSecret}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                />
                <textarea
                  rows={4}
                  style={{ ...FIELD_INPUT, resize: 'vertical', fontFamily: 'monospace' }}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                  value={triggerForm.privateKeyPem}
                  onChange={(e) => setTriggerForm((f) => ({ ...f, privateKeyPem: e.target.value }))}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...SECTION_SUB, color: 'var(--text-2)', fontWeight: 600 }}>
                    事件
                  </span>
                  {GITHUB_EVENTS.map((ev) => (
                    <label
                      key={ev}
                      style={{ ...ROW, fontSize: 10, color: 'var(--text-2)', cursor: 'pointer' }}
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
                  style={{ ...FIELD_INPUT, resize: 'vertical' }}
                  placeholder="分析 {{repo}} 仓库的 {{event}} 事件\u2026"
                  value={triggerForm.agentPromptTemplate}
                  onChange={(e) =>
                    setTriggerForm((f) => ({ ...f, agentPromptTemplate: e.target.value }))
                  }
                />
                <label style={{ ...ROW, fontSize: 10, color: 'var(--text-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={triggerForm.autoApprove}
                    onChange={(e) =>
                      setTriggerForm((f) => ({ ...f, autoApprove: e.target.checked }))
                    }
                  />
                  <span>自动批准（无需用户确认）</span>
                </label>
                <div style={{ ...ROW, justifyContent: 'flex-end', gap: 8 }}>
                  {isSubmittingTrigger && (
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>保存中\u2026</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowTriggerForm(false);
                      setTriggerForm(EMPTY_TRIGGER_FORM);
                    }}
                    style={GHOST_BTN}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveTrigger()}
                    disabled={isSubmittingTrigger}
                    style={{ ...ACTION_BTN, opacity: isSubmittingTrigger ? 0.6 : 1 }}
                  >
                    注册触发器
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowTriggerSchema((v) => !v)}
              style={{ ...GHOST_BTN, marginTop: 8, width: '100%', textAlign: 'left', fontSize: 10 }}
            >
              查看配置格式 {showTriggerSchema ? '▴' : '▾'}
            </button>
            {showTriggerSchema && (
              <pre
                style={{
                  margin: '6px 0 0',
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'color-mix(in srgb, var(--bg) 80%, var(--surface))',
                  border: '1px solid var(--border)',
                  fontSize: 10,
                  color: 'var(--text-2)',
                  overflowX: 'auto',
                  lineHeight: 1.6,
                }}
              >
                {TRIGGER_SCHEMA}
              </pre>
            )}
          </div>

          <div style={DASHED_CARD}>
            <div style={{ ...ROW, justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <div style={ROW}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: '1.5px solid var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 8,
                    color: 'var(--text-3)',
                    flexShrink: 0,
                  }}
                >
                  ↻
                </div>
                <span style={SECTION_TITLE}>应用版本</span>
              </div>
              <button
                type="button"
                disabled={versionInfo.checking}
                onClick={() => {
                  void onCheckVersion();
                }}
                style={{ ...GHOST_BTN, fontSize: 10, opacity: versionInfo.checking ? 0.6 : 1 }}
              >
                {versionInfo.checking ? '检查中…' : '检查更新'}
              </button>
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <span style={{ ...SECTION_SUB, margin: 0 }}>
                当前版本 v{versionInfo.currentVersion}
              </span>
              {versionInfo.latestVersion && !versionInfo.updateAvailable && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#22c55e',
                    fontWeight: 600,
                    background: 'color-mix(in srgb, #22c55e 12%, transparent)',
                    borderRadius: 5,
                    padding: '1px 7px',
                    border: '1px solid color-mix(in srgb, #22c55e 30%, transparent)',
                  }}
                >
                  已是最新
                </span>
              )}
              {versionInfo.updateAvailable && versionInfo.latestVersion && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#f59e0b',
                    fontWeight: 600,
                    background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
                    borderRadius: 5,
                    padding: '1px 7px',
                    border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
                  }}
                >
                  有新版本 v{versionInfo.latestVersion}
                </span>
              )}
            </div>
            <p style={{ ...SECTION_SUB, margin: '4px 0 0', color: 'var(--text-3)' }}>
              上次检查：
              {versionInfo.checkedAt ? new Date(versionInfo.checkedAt).toLocaleString() : '—'}
            </p>
            {versionInfo.checkError && (
              <p style={{ ...SECTION_SUB, margin: '4px 0 0', color: 'var(--danger, #ef4444)' }}>
                {versionInfo.checkError}
              </p>
            )}
            {versionInfo.updateAvailable && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
                  border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
                  fontSize: 11,
                  color: '#f59e0b',
                  fontWeight: 600,
                }}
              >
                有新版本可用，建议尽快更新。
              </div>
            )}
            {providerUpdatesDetail ? (
              <p style={{ ...SECTION_SUB, marginTop: 6 }}>{providerUpdatesDetail}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div style={CARD}>
        {sshSourceState.status === 'error' && sshSourceState.error ? (
          <InlineFailureNotice title="SSH 连接加载失败" message={sshSourceState.error} />
        ) : null}
        <div style={{ ...ROW, marginBottom: 8 }}>
          <span style={SECTION_TITLE}>SSH 连接</span>
          {sshConnections.length > 0 && <span style={BADGE}>{sshConnections.length}</span>}
          {connectedCount > 0 && <span style={ACTIVE_BADGE}>连接中 {connectedCount}</span>}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            style={{ ...ACTION_BTN, marginLeft: 'auto' }}
          >
            + 添加连接
          </button>
        </div>

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
                  border: '1px solid var(--border)',
                  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--text-3)',
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
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {conn.host}:{conn.port}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{conn.username}</div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background:
                      conn.status === 'connected'
                        ? 'color-mix(in srgb, #22c55e 18%, transparent)'
                        : 'color-mix(in srgb, var(--text-3) 15%, transparent)',
                    color: conn.status === 'connected' ? '#22c55e' : 'var(--text-3)',
                  }}
                >
                  {conn.status === 'connected' ? '已连接' : '断开'}
                </span>
                {conn.status === 'connected' ? (
                  <button type="button" onClick={() => onDisconnectSsh(conn.id)} style={DANGER_BTN}>
                    断开
                  </button>
                ) : (
                  <button type="button" onClick={() => onConnectSsh(conn.id)} style={ACTION_BTN}>
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
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              padding: 10,
              borderRadius: 7,
              border: '1px dashed var(--border)',
              background: 'color-mix(in srgb, var(--surface) 60%, var(--bg))',
              marginBottom: 8,
            }}
          >
            <input
              style={FIELD_INPUT}
              placeholder="主机名 / IP"
              value={sshForm.host}
              onChange={(e) => setSshForm((f) => ({ ...f, host: e.target.value }))}
            />
            <input
              style={FIELD_INPUT}
              placeholder="端口（默认 22）"
              value={sshForm.port}
              onChange={(e) => setSshForm((f) => ({ ...f, port: e.target.value }))}
            />
            <input
              style={FIELD_INPUT}
              placeholder="用户名"
              value={sshForm.username}
              onChange={(e) => setSshForm((f) => ({ ...f, username: e.target.value }))}
            />
            <input
              style={FIELD_INPUT}
              placeholder="标签（可选）"
              value={sshForm.name}
              onChange={(e) => setSshForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div
              style={{ gridColumn: 'span 2', display: 'flex', gap: 6, justifyContent: 'flex-end' }}
            >
              <button type="button" onClick={() => setShowAddForm(false)} style={GHOST_BTN}>
                取消
              </button>
              <button type="button" onClick={handleAddSsh} style={ACTION_BTN}>
                确认添加
              </button>
            </div>
          </div>
        )}

        {sshConnections.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <BreadcrumbPath path={sshCurrentPath || '/'} onNavigate={onBrowseSshPath} />
              <div style={{ ...CARD, padding: '4px 6px', maxHeight: 300, overflowY: 'auto' }}>
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
              <button type="button" onClick={() => fileInputRef.current?.click()} style={GHOST_BTN}>
                上传到当前目录
              </button>
            </div>
            <div style={{ ...CARD, padding: '6px 8px', maxHeight: 300, overflowY: 'auto' }}>
              {sshPreview ? (
                <ArtifactPreview
                  artifact={sshPreview}
                  onDownload={() => undefined}
                  onShare={() => undefined}
                />
              ) : (
                <p style={{ fontSize: 10, color: 'var(--text-3)', margin: 0 }}>
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
