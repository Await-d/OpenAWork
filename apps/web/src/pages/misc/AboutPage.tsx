import { useMemo, useState } from 'react';
import { toast } from '../../components/common/ToastNotification.js';

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

interface InfoRow {
  label: string;
  value: string;
  /** Optional: when set, the value renders as a clickable external link. */
  href?: string;
  /** Whether to render the value in a monospace font. */
  mono?: boolean;
}

function InfoCardRow({ row }: { row: InfoRow }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 12,
        alignItems: 'baseline',
        padding: '10px 0',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{row.label}</span>
      <span
        style={{
          color: 'var(--text)',
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
  // Generic fallback: most self-hosted git platforms accept /commit/<hash>.
  return `${trimmed}/commit/${fullHash}`;
}

export default function AboutPage() {
  const [copying, setCopying] = useState(false);

  const version = __APP_VERSION__;
  const buildVersion = __APP_BUILD_VERSION__;
  const buildTime = __APP_BUILD_TIME__;
  const gitHash = __APP_GIT_HASH__;
  const gitBranch = __APP_GIT_BRANCH__;
  const gitTag = __APP_GIT_TAG__;
  const repositoryUrl = __APP_REPOSITORY_URL__;
  const commits = __APP_RECENT_COMMITS__;

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
    setCopying(true);
    try {
      await navigator.clipboard.writeText(summary);
      toast('已复制构建信息到剪贴板', 'success');
    } catch {
      toast('复制失败,请手动选中文本', 'error');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        padding: '32px 40px 56px',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
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
            }}
          >
            <svg width="56" height="56" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="aboutLogoBg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop
                    offset="0%"
                    style={{ stopColor: 'color-mix(in oklch, var(--accent) 100%, white 16%)' }}
                  />
                  <stop offset="100%" style={{ stopColor: 'var(--accent)' }} />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="8" fill="url(#aboutLogoBg)" />
              <path
                d="M 16,3 C 26,3 29,12 16,16"
                stroke="var(--accent-text)"
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
                transform="rotate(0, 16, 16)"
              />
              <path
                d="M 16,3 C 26,3 29,12 16,16"
                stroke="var(--accent-text)"
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
                transform="rotate(120, 16, 16)"
              />
              <path
                d="M 16,3 C 26,3 29,12 16,16"
                stroke="var(--accent-text)"
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
                transform="rotate(240, 16, 16)"
              />
              <circle cx="16" cy="16" r="2.8" fill="var(--accent-text)" />
            </svg>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--text)',
              }}
            >
              OpenAWork
            </h1>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
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
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
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

        {/* Info card */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface)',
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
                color: 'var(--text)',
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
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface)',
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
                  color: 'var(--text)',
                  letterSpacing: '-0.01em',
                }}
              >
                最近更新
              </h2>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
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
            <p style={{ color: 'var(--text-3)', fontSize: 12, padding: '12px 0' }}>
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
                    'linear-gradient(180deg, color-mix(in oklch, var(--accent) 60%, transparent), color-mix(in oklch, var(--border) 80%, transparent))',
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
                        background: idx === 0 ? 'var(--accent)' : 'var(--surface)',
                        border:
                          idx === 0
                            ? '2px solid color-mix(in oklch, var(--accent) 80%, transparent)'
                            : '2px solid color-mix(in oklch, var(--border) 90%, transparent)',
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
                          color: 'var(--text)',
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
                          color: 'var(--text-3)',
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
                              color: 'var(--text-3)',
                              textDecoration: 'none',
                              fontFamily:
                                'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                              padding: '0 5px',
                              borderRadius: 4,
                              background: 'var(--bg-2)',
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
                              background: 'var(--bg-2)',
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
                        color: 'var(--text-3)',
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
            color: 'var(--text-3)',
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
