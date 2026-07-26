import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import { BrandLogo } from '@openAwork/shared-ui';
import { useAuthStore } from '../../stores/auth/auth.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import { isTauri, tauriInvoke } from '../settings/shared/settings-page-helpers.js';
import type { SettingsVersionInfo } from '../settings/state/settings-types.js';
import {
  checkForUpdate,
  clearProxyCache,
  downloadUpdate,
  installUpdate,
  toUpdateError,
  UpdateError,
  type UpdateCheckResult,
  type GitHubProxy,
} from '../../../../desktop/src/updater/auto-update.js';
import { downloadAndInstallProxyUpdate } from '../../../../desktop/src/updater/proxy-update.js';
import {
  restartDesktopApp,
  stopDesktopGateway,
} from '../../../../desktop/src/utils/tauri-gateway.js';

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

/* ── 更新检查区块 ──────────────────────────────────────────────────────── */

interface UpdateSectionProps {
  versionInfo: SettingsVersionInfo;
  onCheckVersion: () => void;
  isTauriEnv: boolean;
}

type DesktopUpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'done' | 'up-to-date';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function inlineUpdateStateLabel(state: DesktopUpdateState): string {
  switch (state) {
    case 'idle':
      return '待检查';
    case 'checking':
      return '检查中';
    case 'available':
      return '发现更新';
    case 'downloading':
      return '下载中';
    case 'installing':
      return '安装中';
    case 'done':
      return '已完成';
    case 'up-to-date':
      return '已最新';
  }
}

function inlineUpdateErrorTitle(kind: UpdateError['kind']): string {
  switch (kind) {
    case 'network':
      return '连接失败';
    case 'signature':
      return '校验失败';
    case 'permission':
      return '权限不足';
    case 'no_update':
      return '暂无更新';
    case 'cancelled':
      return '已取消';
    case 'unknown':
      return '更新出错';
  }
}

function InlineUpdateStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: 'var(--spacing-3) var(--spacing-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-base) 42%, var(--bg-overlay))',
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: accent ? 'var(--contrast)' : 'var(--fg-strong)',
          fontVariantNumeric: 'tabular-nums',
          fontFamily:
            label === '目标版本'
              ? 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)'
              : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function UpdateSection({ versionInfo, onCheckVersion, isTauriEnv }: UpdateSectionProps) {
  const [desktopState, setDesktopState] = useState<DesktopUpdateState>('idle');
  const [desktopProgress, setDesktopProgress] = useState(0);
  const [desktopDownloaded, setDesktopDownloaded] = useState(0);
  const [desktopTotal, setDesktopTotal] = useState<number | null>(null);
  const [desktopError, setDesktopError] = useState<UpdateError | null>(null);
  const [desktopResult, setDesktopResult] = useState<UpdateCheckResult | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [proxyUsed, setProxyUsed] = useState<GitHubProxy | null>(null);
  const desktopAbortControllerRef = useRef<AbortController | null>(null);
  const desktopCancelRequestedRef = useRef(false);

  const stopGatewayBeforeInstall = useCallback(async () => {
    try {
      await stopDesktopGateway();
    } catch (stopError) {
      const message = stopError instanceof Error ? stopError.message : String(stopError);
      throw new UpdateError('unknown', `安装更新前停止本地网关失败：${message}`);
    }
  }, []);

  const runInlineDesktopCheck = useCallback(async () => {
    if (!isTauriEnv) return;
    setDesktopState('checking');
    setDesktopError(null);
    setDesktopProgress(0);
    setDesktopDownloaded(0);
    setDesktopTotal(null);
    setProxyUsed(null);
    try {
      console.log('[about-inline-update] 开始检查更新…');
      const result = await checkForUpdate();
      setDesktopResult(result);
      setReleaseNotes(result.notes);
      setProxyUsed(result.proxyUsed);
      setDesktopState(result.available ? 'available' : 'up-to-date');
    } catch (error) {
      console.error('[about-inline-update] 检查更新失败:', error);
      setDesktopError(toUpdateError(error));
      setDesktopState('idle');
    }
  }, [isTauriEnv]);

  const handleDesktopDownload = useCallback(async () => {
    if (!desktopResult) return;
    const abortController = new AbortController();
    desktopAbortControllerRef.current = abortController;
    desktopCancelRequestedRef.current = false;
    setDesktopError(null);
    setDesktopState('downloading');
    setDesktopProgress(0);
    setDesktopDownloaded(0);
    setDesktopTotal(null);

    try {
      if (!desktopResult.update) {
        if (!desktopResult.proxyUsed) {
          throw new UpdateError('unknown', '当前更新缺少可安装句柄。');
        }
        if (desktopResult.installMode === 'manual') {
          if (!desktopResult.proxiedDownloadUrl) {
            throw new UpdateError('unknown', '当前代理模式缺少可下载的更新地址。');
          }
          window.open(desktopResult.proxiedDownloadUrl, '_blank', 'noopener,noreferrer');
          setDesktopState('done');
          setDesktopProgress(100);
          return;
        }

        try {
          await stopGatewayBeforeInstall();
          if (desktopCancelRequestedRef.current) return;
          await downloadAndInstallProxyUpdate(
            desktopResult.proxyUsed,
            desktopResult.channel,
            (progress) => {
              if (desktopCancelRequestedRef.current) return;
              setDesktopProgress(progress.percent);
              setDesktopDownloaded(progress.downloaded);
              setDesktopTotal(progress.total);
            },
          );
          if (desktopCancelRequestedRef.current) return;
        } catch (proxyInstallError) {
          if (desktopCancelRequestedRef.current) return;
          clearProxyCache();
          if (desktopResult.proxiedDownloadUrl) {
            window.open(desktopResult.proxiedDownloadUrl, '_blank', 'noopener,noreferrer');
            setDesktopState('done');
            setDesktopProgress(100);
            return;
          }
          throw proxyInstallError;
        }

        setDesktopProgress(100);
        setDesktopState('done');
        return;
      }

      await downloadUpdate(
        desktopResult.update,
        (progress) => {
          if (desktopCancelRequestedRef.current) return;
          setDesktopProgress(progress.percent);
          setDesktopDownloaded(progress.downloaded);
          setDesktopTotal(progress.total);
        },
        { signal: abortController.signal },
      );
      if (desktopCancelRequestedRef.current || abortController.signal.aborted) return;
      setDesktopProgress(100);
      setDesktopState('installing');
      await installUpdate(desktopResult.update, {
        beforeInstall: stopGatewayBeforeInstall,
      });
      setDesktopState('done');
    } catch (error) {
      console.error('[about-inline-update] 下载/安装失败:', error);
      if (desktopCancelRequestedRef.current || abortController.signal.aborted) return;
      setDesktopError(toUpdateError(error));
      setDesktopState(desktopResult.available ? 'available' : 'idle');
    } finally {
      if (desktopAbortControllerRef.current === abortController) {
        desktopAbortControllerRef.current = null;
      }
    }
  }, [desktopResult, stopGatewayBeforeInstall]);

  const handleCancelDesktopDownload = useCallback(() => {
    if (desktopState !== 'downloading') return;
    desktopCancelRequestedRef.current = true;
    desktopAbortControllerRef.current?.abort();
    setDesktopProgress(0);
    setDesktopDownloaded(0);
    setDesktopTotal(null);
    setDesktopError(null);
    setDesktopState(desktopResult?.available ? 'available' : 'idle');
  }, [desktopResult, desktopState]);

  useEffect(() => {
    return () => {
      desktopCancelRequestedRef.current = true;
      desktopAbortControllerRef.current?.abort();
    };
  }, []);

  const handlePrimaryCheck = useCallback(() => {
    if (isTauriEnv) {
      void runInlineDesktopCheck();
      void onCheckVersion();
      return;
    }
    void onCheckVersion();
  }, [isTauriEnv, onCheckVersion, runInlineDesktopCheck]);

  const hasUpdate = versionInfo.updateAvailable && versionInfo.latestVersion;
  const isLatest =
    versionInfo.latestVersion && !versionInfo.updateAvailable && !versionInfo.checkError;
  const primaryBusy = isTauriEnv
    ? desktopState === 'checking' ||
      desktopState === 'downloading' ||
      desktopState === 'installing' ||
      versionInfo.checking
    : versionInfo.checking;
  const primaryLabel =
    desktopState === 'downloading'
      ? '下载中…'
      : desktopState === 'installing'
        ? '安装中…'
        : primaryBusy
          ? '检查中…'
          : '检查更新';
  const inlineHasUpdate = desktopState === 'available' && desktopResult?.version;
  const inlineShowPanel = isTauriEnv && (desktopResult || desktopError || desktopState !== 'idle');
  const inlineStatusMessage =
    desktopState === 'available'
      ? `发现新版本 ${desktopResult?.version ?? ''}${proxyUsed ? `（通过 ${proxyUsed.name} 加速）` : ''}。`
      : desktopState === 'downloading'
        ? `下载中… ${desktopProgress}%`
        : desktopState === 'installing'
          ? '下载完成，正在安装更新…'
          : desktopState === 'done'
            ? desktopResult?.installMode === 'manual'
              ? '已打开手动下载链接，请先完全退出 OpenAWork，再运行下载的安装包。'
              : '更新已处理完成，可立即重启应用。'
            : desktopState === 'up-to-date'
              ? '当前已是最新版本。'
              : desktopState === 'checking'
                ? '正在检查更新…'
                : '点击上方按钮检查当前桌面端更新。';

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border-default)',
        borderRadius: 14,
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, var(--bg-overlay)), var(--bg-overlay) 52%)',
        padding: '4px 20px 18px',
        boxShadow: '0 4px 18px -14px color-mix(in oklch, black 80%, transparent)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 装饰光斑 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -36,
          top: -44,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-subtle), transparent 68%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '14px 0 10px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent)',
              boxShadow: 'var(--shadow-glow)',
              flexShrink: 0,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12" />
              <path d="m8 11 4 4 4-4" />
              <path d="M5 21h14" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--fg-strong)',
                letterSpacing: '-0.01em',
              }}
            >
              更新检查
            </h2>
            <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
              {isTauriEnv
                ? '直接在当前关于页内检查、查看发布日志并下载安装桌面更新'
                : '通过 GitHub Releases 检查是否有新版本发布（默认预览渠道）'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={primaryBusy}
            onClick={() => void handlePrimaryCheck()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--fg-on-accent)',
              fontSize: 12,
              fontWeight: 600,
              cursor: primaryBusy ? 'wait' : 'pointer',
              opacity: primaryBusy ? 0.7 : 1,
              transition: 'opacity 120ms ease',
            }}
          >
            {primaryLabel}
          </button>
          {isTauriEnv && (
            <button
              type="button"
              disabled={versionInfo.checking}
              onClick={() => void onCheckVersion()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-default)',
                fontSize: 12,
                fontWeight: 600,
                cursor: versionInfo.checking ? 'wait' : 'pointer',
              }}
            >
              {versionInfo.checking ? '刷新中…' : '刷新版本状态'}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              window.open(
                'https://github.com/Await-d/OpenAWork/releases',
                '_blank',
                'noopener,noreferrer',
              )
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            GitHub 发布记录
          </button>
        </div>
      </div>

      {/* 版本状态指标 */}
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
        }}
      >
        <div
          style={{
            minWidth: 0,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in srgb, var(--bg-base) 38%, var(--bg-overlay))',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>当前版本</div>
          <div
            translate="no"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
            }}
          >
            v{versionInfo.currentVersion}
          </div>
        </div>
        <div
          style={{
            minWidth: 0,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in srgb, var(--bg-base) 38%, var(--bg-overlay))',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>最新版本</div>
          <div
            translate="no"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: hasUpdate
                ? 'var(--contrast)'
                : isLatest
                  ? 'var(--fg-strong)'
                  : 'var(--fg-muted)',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
            }}
          >
            {versionInfo.latestVersion
              ? `v${versionInfo.latestVersion}`
              : versionInfo.checking
                ? '检查中…'
                : '—'}
          </div>
        </div>
        <div
          style={{
            minWidth: 0,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in srgb, var(--bg-base) 38%, var(--bg-overlay))',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>上次检查</div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {versionInfo.checkedAt
              ? new Date(versionInfo.checkedAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </div>
        </div>
      </div>

      {/* 状态提示 */}
      {hasUpdate && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--contrast) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--contrast) 30%, transparent)',
            fontSize: 12,
            color: 'var(--contrast)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          有新版本 v{versionInfo.latestVersion} 可用
          {isTauriEnv ? '，请点击下方按钮下载安装。' : '，请前往 GitHub 发布记录下载。'}
        </div>
      )}
      {isLatest && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            fontSize: 12,
            color: 'var(--accent)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          已是最新版本
        </div>
      )}
      {versionInfo.checkError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--complement) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--complement) 30%, transparent)',
            fontSize: 12,
            color: 'var(--complement)',
          }}
        >
          {versionInfo.checkError}
        </div>
      )}

      {inlineShowPanel && (
        <section
          style={{
            marginTop: 'var(--spacing-4)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-default)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--bg-overlay)), var(--bg-overlay))',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 'var(--spacing-4)',
              flexWrap: 'wrap',
              padding: 'var(--spacing-4) var(--spacing-5)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span
                style={{
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                桌面端更新
              </span>
              <strong style={{ fontSize: 16, color: 'var(--fg-strong)' }}>
                {desktopResult?.version ? `OpenAWork v${desktopResult.version}` : '更新检查'}
              </strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6 }}>
                {inlineStatusMessage}
              </span>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--accent-border)',
                background: 'var(--accent-muted)',
                color: 'var(--fg-default)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {inlineUpdateStateLabel(desktopState)}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-4)',
              padding: 'var(--spacing-5)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 'var(--spacing-3)',
              }}
            >
              <InlineUpdateStat
                label="目标版本"
                value={desktopResult?.version ? `v${desktopResult.version}` : '—'}
                accent={desktopState === 'available'}
              />
              <InlineUpdateStat
                label="更新通道"
                value={desktopResult?.channel === 'stable' ? '发行版' : '预览版'}
              />
              <InlineUpdateStat
                label="下载进度"
                value={
                  desktopState === 'downloading' || desktopState === 'installing'
                    ? `${desktopProgress}%`
                    : desktopState === 'done'
                      ? '100%'
                      : '—'
                }
              />
            </div>

            {(desktopState === 'downloading' || desktopState === 'installing') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    height: 8,
                    borderRadius: 'var(--radius-pill)',
                    overflow: 'hidden',
                    background: 'var(--accent-subtle)',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${desktopProgress}%`,
                      background: 'var(--accent)',
                      transition: 'width 180ms ease',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--spacing-3)',
                    fontSize: 12,
                    color: 'var(--fg-muted)',
                  }}
                >
                  <span>{desktopProgress}%</span>
                  <span>
                    {formatBytes(desktopDownloaded)}
                    {desktopTotal ? ` / ${formatBytes(desktopTotal)}` : ''}
                  </span>
                </div>
              </div>
            )}

            {desktopError ? (
              <div
                role="alert"
                style={{
                  padding: 'var(--spacing-3) var(--spacing-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid color-mix(in srgb, var(--complement) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--complement) 8%, transparent)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <strong style={{ fontSize: 13, color: 'var(--complement)' }}>
                  {inlineUpdateErrorTitle(desktopError.kind)}
                </strong>
                <span style={{ fontSize: 12, lineHeight: 1.6 }}>{desktopError.message}</span>
              </div>
            ) : null}

            {releaseNotes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--spacing-3)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--fg-default)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    发布日志
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>可滚动查看</span>
                </div>
                <div
                  style={{
                    maxHeight: 280,
                    overflowY: 'auto',
                    padding: 'var(--spacing-4)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: 'color-mix(in srgb, var(--bg-base) 42%, var(--bg-overlay))',
                    color: 'var(--fg-default)',
                    fontSize: 13,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {releaseNotes}
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: 'flex',
                gap: 'var(--spacing-2)',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                paddingTop: 'var(--spacing-2)',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              {desktopState === 'downloading' && (
                <button
                  type="button"
                  onClick={() => handleCancelDesktopDownload()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid color-mix(in srgb, var(--complement) 35%, transparent)',
                    background: 'color-mix(in srgb, var(--complement) 8%, transparent)',
                    color: 'var(--complement)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  取消下载
                </button>
              )}
              {(desktopState === 'idle' || desktopState === 'up-to-date' || desktopError) && (
                <button
                  type="button"
                  onClick={() => void runInlineDesktopCheck()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--accent-border)',
                    background: 'var(--accent-muted)',
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  重新检查
                </button>
              )}
              {inlineHasUpdate && (
                <button
                  type="button"
                  onClick={() => void handleDesktopDownload()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--fg-on-accent)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  下载更新 v{desktopResult?.version}
                </button>
              )}
              {desktopState === 'done' && desktopResult?.installMode !== 'manual' && (
                <button
                  type="button"
                  onClick={() => void restartDesktopApp()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    background: 'var(--bg-overlay)',
                    color: 'var(--fg-default)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  重启应用
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </section>
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
