import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { createSettingsClient } from '@openAwork/web-client';
import { BrandLogo } from '@openAwork/shared-ui';
import { useAuthStore } from '../../stores/auth/auth.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import { isTauri, tauriInvoke } from '../settings/shared/settings-page-helpers.js';
import type { SettingsVersionInfo } from '../settings/state/settings-types.js';
import type { DesktopUpdateState } from './about/desktop-update-section.js';
import { runAboutActionOnce, UpdateSection } from './about/desktop-update-section.js';

type UpdateChannel = 'preview' | 'stable';

async function resolveUpdateChannel(): Promise<UpdateChannel> {
  if (!isTauri) return 'preview';
  try {
    const channel = await tauriInvoke<string>('current_update_channel');
    return channel === 'stable' ? 'stable' : 'preview';
  } catch {
    return 'preview';
  }
}

/* ── 工具函数 ──────────────────────────────────────────────────────────── */

function formatDate(input: string): string {
  if (!input) return '—';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(input: string): string {
  if (!input) return '';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  const years = Math.floor(months / 12);
  return `${years} 年前`;
}

function buildCommitUrl(repositoryUrl: string, fullHash: string): string | null {
  if (!repositoryUrl || !fullHash) return null;
  const trimmed = repositoryUrl.replace(/\.git$/, '').replace(/\/+$/, '');
  if (/^https?:\/\/(www\.)?github\.com\//.test(trimmed)) {
    return `${trimmed}/commit/${fullHash}`;
  }
  if (/^https?:\/\/(www\.)?gitlab\.com\//.test(trimmed)) {
    return `${trimmed}/-/commit/${fullHash}`;
  }
  if (/^https?:\/\/(www\.)?bitbucket\.org\//.test(trimmed)) {
    return `${trimmed}/commits/${fullHash}`;
  }
  return `${trimmed}/commit/${fullHash}`;
}

/* ── 类型 ──────────────────────────────────────────────────────────────── */

interface InfoRow {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}

/* ── 子组件 ────────────────────────────────────────────────────────────── */

function InfoCardRow({ row }: { row: InfoRow }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr',
        gap: 12,
        alignItems: 'baseline',
        padding: '9px 0',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{row.label}</span>
      <span
        style={{
          color: 'var(--fg-strong)',
          fontSize: 13,
          fontFamily: row.mono
            ? 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)'
            : undefined,
          wordBreak: 'break-all',
        }}
      >
        {row.href ? (
          <a
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-hover-underline"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            {row.value}
          </a>
        ) : (
          row.value || '—'
        )}
      </span>
    </div>
  );
}

/* ── 主页面 ────────────────────────────────────────────────────────────── */

export default function AboutPage() {
  const [copying, setCopying] = useState(false);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const tauriEnv = isTauri;
  const version = __APP_VERSION__;
  const buildVersion = __APP_BUILD_VERSION__;
  const buildTime = __APP_BUILD_TIME__;
  const gitHash = __APP_GIT_HASH__;
  const gitBranch = __APP_GIT_BRANCH__;
  const gitTag = __APP_GIT_TAG__;
  const repositoryUrl = __APP_REPOSITORY_URL__;
  const commits = __APP_RECENT_COMMITS__;

  /* ── 版本检查状态 ── */
  const [versionInfo, setVersionInfo] = useState<SettingsVersionInfo>({
    currentVersion: version || '0.0.1',
    latestVersion: null,
    updateAvailable: false,
    checkError: null,
    checkedAt: null,
    checking: false,
  });

  const checkVersionUpdate = useCallback(async () => {
    if (!token) return;
    setVersionInfo((prev) => ({ ...prev, checking: true, checkError: null }));
    try {
      const channel = await resolveUpdateChannel();
      const data = (await createSettingsClient(gatewayUrl).getVersion(token, {
        channel,
      })) as SettingsVersionInfo;
      setVersionInfo({
        currentVersion: data.currentVersion,
        latestVersion: data.latestVersion,
        updateAvailable: data.updateAvailable,
        checkError: data.checkError,
        checkedAt: data.checkedAt,
        checking: false,
      });
    } catch {
      setVersionInfo((prev) => ({
        ...prev,
        checking: false,
        checkError: '检查失败，请稍后重试',
      }));
    }
  }, [gatewayUrl, token]);

  /* ── 页面加载时自动检查一次 ── */
  useEffect(() => {
    if (token) {
      void checkVersionUpdate();
    }
  }, [checkVersionUpdate, token]);

  /* ── 托盘「检查更新」入口：App.tsx 接事件后 navigate '/settings/about?check=1' ──
     这里读出参数传给 UpdateSection 触发一次自动检查，随后清掉参数，
     避免用户手动刷新 / 前进后退时重复触发。与 DesktopTabContent 处理
     `?show=pairing` 的写法保持一致。 */
  const [searchParams, setSearchParams] = useSearchParams();
  const autoCheckRequested = searchParams.get('check') === '1';
  useEffect(() => {
    if (!autoCheckRequested) return;
    const next = new URLSearchParams(searchParams);
    next.delete('check');
    setSearchParams(next, { replace: true });
  }, [autoCheckRequested, searchParams, setSearchParams]);

  /* ── 构建信息行 ── */
  const infoRows = useMemo<InfoRow[]>(() => {
    const rows: InfoRow[] = [
      { label: '版本号', value: version, mono: true },
      { label: '构建版本', value: buildVersion, mono: true },
      { label: '构建时间', value: formatDate(buildTime) },
      { label: 'Git 分支', value: gitBranch || '—', mono: true },
      { label: 'Git 提交', value: gitHash || '—', mono: true },
    ];
    if (gitTag) {
      rows.push({ label: 'Git 标签', value: gitTag, mono: true });
    }
    if (repositoryUrl) {
      rows.push({
        label: '仓库地址',
        value: repositoryUrl,
        href: repositoryUrl,
        mono: true,
      });
    }
    return rows;
  }, [buildTime, buildVersion, gitBranch, gitHash, gitTag, repositoryUrl, version]);

  const handleCopyBuildInfo = async () => {
    const summary = [
      `OpenAWork ${version}`,
      `Build ${buildVersion}`,
      `Built at ${buildTime}`,
      `Branch ${gitBranch} (${gitHash}${gitTag ? `, tag ${gitTag}` : ''})`,
      repositoryUrl ? `Repo ${repositoryUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    await runAboutActionOnce({
      setBusy: setCopying,
      onError: () => {
        toast('复制失败,请手动选中文本', 'error');
      },
      run: async () => {
        await navigator.clipboard.writeText(summary);
        toast('已复制构建信息到剪贴板', 'success');
      },
    });
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        paddingBottom: 40,
        background: 'var(--bg-base)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Hero */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span
            aria-hidden="true"
            style={{
              position: 'relative',
              width: 56,
              height: 56,
              borderRadius: 14,
              flexShrink: 0,
              boxShadow:
                '0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent), 0 12px 36px -16px color-mix(in oklch, var(--accent) 50%, transparent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BrandLogo size={56} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--fg-strong)',
              }}
            >
              OpenAWork
            </h1>
            <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
              AI Agent Workspace · 版本 {version}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void handleCopyBuildInfo()}
            disabled={copying}
            className="toolbar-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              fontSize: 12,
              fontWeight: 600,
              cursor: copying ? 'wait' : 'pointer',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            复制构建信息
          </button>
        </header>

        {/* 更新检查 */}
        <UpdateSection
          versionInfo={versionInfo}
          onCheckVersion={checkVersionUpdate}
          isTauriEnv={tauriEnv}
          autoStartCheck={autoCheckRequested}
        />

        {/* Info card */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border-default)',
            borderRadius: 14,
            background: 'var(--bg-overlay)',
            padding: '4px 18px 10px',
            boxShadow: '0 4px 18px -14px color-mix(in oklch, black 80%, transparent)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0 6px',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--fg-strong)',
                letterSpacing: '-0.01em',
              }}
            >
              应用信息
            </h2>
          </div>
          {infoRows.map((row) => (
            <InfoCardRow key={row.label} row={row} />
          ))}
        </section>

        {/* Recent commits */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border-default)',
            borderRadius: 14,
            background: 'var(--bg-overlay)',
            padding: '4px 18px 16px',
            boxShadow: '0 4px 18px -14px color-mix(in oklch, black 80%, transparent)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0 8px',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--fg-strong)',
                  letterSpacing: '-0.01em',
                }}
              >
                最近更新
              </h2>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                源自构建时刻冻结的 git log,共 {commits.length} 条
              </span>
            </div>
            {repositoryUrl && (
              <a
                href={`${repositoryUrl.replace(/\.git$/, '').replace(/\/+$/, '')}/commits/${gitBranch}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                查看完整历史 →
              </a>
            )}
          </div>

          {commits.length === 0 ? (
            <p style={{ color: 'var(--fg-muted)', fontSize: 12, padding: '12px 0' }}>
              当前构建未携带 git 提交信息。
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                position: 'relative',
              }}
            >
              {/* Vertical timeline */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 12,
                  bottom: 12,
                  width: 1,
                  background:
                    'linear-gradient(180deg, color-mix(in oklch, var(--accent) 60%, transparent), color-mix(in oklch, var(--border-default) 80%, transparent))',
                }}
              />
              {commits.map((commit, idx) => {
                const commitUrl = buildCommitUrl(repositoryUrl, commit.fullHash);
                return (
                  <li
                    key={commit.fullHash || `${commit.shortHash}-${idx}`}
                    style={{
                      position: 'relative',
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr auto',
                      gap: 12,
                      alignItems: 'baseline',
                      padding: '8px 0 8px 0',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'relative',
                        width: 11,
                        height: 11,
                        marginTop: 4,
                        borderRadius: '50%',
                        background: idx === 0 ? 'var(--accent)' : 'var(--bg-overlay)',
                        border:
                          idx === 0
                            ? '2px solid color-mix(in oklch, var(--accent) 80%, transparent)'
                            : '2px solid color-mix(in oklch, var(--border-default) 90%, transparent)',
                        boxShadow:
                          idx === 0
                            ? '0 0 0 4px color-mix(in oklch, var(--accent) 20%, transparent)'
                            : 'none',
                        zIndex: 1,
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <span
                        style={{
                          color: 'var(--fg-strong)',
                          fontSize: 13,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          wordBreak: 'break-word',
                        }}
                        title={commit.subject}
                      >
                        {commit.subject || '(无提交信息)'}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          color: 'var(--fg-muted)',
                          fontSize: 11,
                        }}
                      >
                        {commitUrl ? (
                          <a
                            href={commitUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-hover-color"
                            data-tone="accent"
                            style={{
                              color: 'var(--fg-muted)',
                              textDecoration: 'none',
                              fontFamily:
                                'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                              padding: '0 5px',
                              borderRadius: 4,
                              background: 'var(--bg-overlay)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {commit.shortHash}
                          </a>
                        ) : (
                          <span
                            style={{
                              fontFamily:
                                'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                              padding: '0 5px',
                              borderRadius: 4,
                              background: 'var(--bg-overlay)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {commit.shortHash}
                          </span>
                        )}
                        <span>{commit.author}</span>
                      </span>
                    </div>
                    <span
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                      }}
                      title={formatDate(commit.date)}
                    >
                      {formatRelative(commit.date)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer
          style={{
            color: 'var(--fg-muted)',
            fontSize: 11,
            textAlign: 'center',
            paddingTop: 4,
          }}
        >
          构建信息和提交日志在打包时一次性嵌入,运行期不会再次拉取。
        </footer>
      </div>
    </div>
  );
}
