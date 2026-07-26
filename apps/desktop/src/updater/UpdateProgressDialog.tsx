import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  checkForUpdate,
  clearProxyCache,
  downloadUpdate,
  installUpdate,
  toUpdateError,
  UpdateError,
  type UpdateCheckResult,
  type GitHubProxy,
} from './auto-update.js';
import { downloadAndInstallProxyUpdate } from './proxy-update.js';
import { UpdateErrorDialog } from './UpdateErrorDialog.js';
import { restartDesktopApp, stopDesktopGateway } from '../utils/tauri-gateway.js';

type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'done' | 'up-to-date';

export interface UpdateProgressDialogProps {
  autoCheck?: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const spinnerKeyframes = `
@keyframes updater-spin {
  to { transform: rotate(360deg); }
}
`;

function Spinner() {
  return (
    <>
      <style>{spinnerKeyframes}</style>
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid hsl(var(--muted) / 0.4)',
          borderTopColor: 'hsl(var(--primary))',
          borderRadius: '50%',
          animation: 'updater-spin 0.8s linear infinite',
          margin: '8px auto',
        }}
      />
    </>
  );
}

export function UpdateProgressDialog({ autoCheck = false, onClose }: UpdateProgressDialogProps) {
  const [state, setState] = useState<UpdateState>(autoCheck ? 'checking' : 'idle');
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [proxyUsed, setProxyUsed] = useState<GitHubProxy | null>(null);
  const autoCheckStartedRef = useRef(false);
  const cancelledRef = useRef(false);
  /** Aborts the active native/proxy download when the user cancels. */
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGatewayBeforeInstall = useCallback(async () => {
    try {
      await stopDesktopGateway();
    } catch (stopError) {
      const message = stopError instanceof Error ? stopError.message : String(stopError);
      throw new UpdateError('unknown', `安装更新前停止本地网关失败：${message}`);
    }
  }, []);

  const handleCheck = useCallback(async () => {
    cancelledRef.current = false;
    setState('checking');
    setError(null);
    setProxyUsed(null);
    try {
      console.log('[updater] 开始检查更新…');
      const r = await checkForUpdate();
      if (cancelledRef.current) return;
      console.log(
        '[updater] 检查结果:',
        JSON.stringify({
          available: r.available,
          version: r.version,
          installMode: r.installMode,
          proxyUsed: r.proxyUsed?.name,
        }),
      );
      setResult(r);
      setReleaseNotes(r.notes);
      setProxyUsed(r.proxyUsed);
      setState(r.available ? 'available' : 'up-to-date');
    } catch (e) {
      console.error('[updater] 检查更新失败:', e);
      setError(toUpdateError(e));
    }
  }, []);

  const openManualDownload = useCallback((downloadUrl: string) => {
    window.open(downloadUrl, '_blank');
    setResult((prev) =>
      prev
        ? {
            ...prev,
            installMode: 'manual',
            proxiedDownloadUrl: downloadUrl,
          }
        : prev,
    );
    setProgress(100);
    setState('done');
  }, []);

  const handleDownload = useCallback(async () => {
    if (!result) return;
    cancelledRef.current = false;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setState('downloading');
    setProgress(0);
    setDownloaded(0);
    setTotal(null);
    setError(null);
    console.log(
      '[updater] 开始下载:',
      JSON.stringify({
        hasUpdate: !!result.update,
        installMode: result.installMode,
        proxyUsed: result.proxyUsed?.name,
      }),
    );

    try {
      if (!result.update) {
        if (!result.proxyUsed) {
          throw new UpdateError('unknown', '当前更新缺少可安装句柄。');
        }
        if (result.installMode === 'manual') {
          if (!result.proxiedDownloadUrl) {
            throw new UpdateError('unknown', '当前代理模式缺少可下载的更新地址。');
          }
          openManualDownload(result.proxiedDownloadUrl);
          return;
        }
        try {
          await stopGatewayBeforeInstall();
          // Proxy path currently runs download+install in one Rust command and
          // cannot be hard-aborted mid-flight; cancelledRef still suppresses UI.
          await downloadAndInstallProxyUpdate(result.proxyUsed, result.channel, (p) => {
            if (cancelledRef.current) return;
            setProgress(p.percent);
            setDownloaded(p.downloaded);
            setTotal(p.total);
          });
        } catch (proxyInstallError) {
          // Auto-install via Rust updater can fail when the selected proxy
          // only serves metadata well. Fall back to opening the download URL
          // so the user can still finish the upgrade manually.
          clearProxyCache();
          if (result.proxiedDownloadUrl && !cancelledRef.current) {
            openManualDownload(result.proxiedDownloadUrl);
            return;
          }
          throw proxyInstallError;
        }
        if (cancelledRef.current) return;
        setProgress(100);
        setState('done');
        return;
      }

      await downloadUpdate(
        result.update,
        (p) => {
          if (cancelledRef.current) return;
          setProgress(p.percent);
          setDownloaded(p.downloaded);
          setTotal(p.total);
        },
        { signal: abortController.signal },
      );
      if (cancelledRef.current || abortController.signal.aborted) return;
      setProgress(100);
      setState('installing');
      await installUpdate(result.update, {
        beforeInstall: stopGatewayBeforeInstall,
      });
      if (cancelledRef.current) return;
      setState('done');
    } catch (e) {
      console.error('[updater] 下载/安装失败:', e);
      if (cancelledRef.current || abortController.signal.aborted) return;
      const classified = toUpdateError(e);
      if (classified.kind === 'cancelled') return;
      setError(classified);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, [openManualDownload, result, stopGatewayBeforeInstall]);

  const handleCancelOrClose = useCallback(() => {
    // Installing: only dismiss the dialog. Hard-closing the native Update after
    // gateway stop can leave a half-installed state with no local gateway.
    if (state === 'installing') {
      onClose();
      return;
    }

    cancelledRef.current = true;

    // Downloading (native): abort signal only — downloadUpdate's abort listener
    // calls update.close(). Avoid double-close from the UI layer.
    // Downloading (proxy-auto): soft cancel — Rust command cannot hard-abort;
    // we only stop updating UI and close the dialog.
    const controller = abortControllerRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    onClose();
  }, [onClose, state]);

  useEffect(() => {
    if (!autoCheck || autoCheckStartedRef.current) return;
    autoCheckStartedRef.current = true;
    console.log('[updater] UpdateProgressDialog 已挂载，autoCheck=true，开始自动检查');
    void handleCheck();
  }, [autoCheck, handleCheck]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      // Abort only — native update.close() is handled by downloadUpdate's
      // signal listener. Do not close Update here or we risk tearing down
      // resources during install if the dialog unmounts mid-install.
      const controller = abortControllerRef.current;
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    };
  }, []);

  if (error) {
    return (
      <UpdateErrorDialog
        kind={error.kind}
        message={error.message}
        onRetry={() => {
          setError(null);
          setState('idle');
        }}
        onDismiss={onClose}
      />
    );
  }

  const proxyHint = proxyUsed ? `（通过 ${proxyUsed.name} 加速）` : '';
  const isManualProxyMode = result?.installMode === 'manual';
  const statusMessage =
    state === 'available'
      ? `发现新版本 ${result?.version ?? ''}${proxyHint}。`
      : state === 'downloading'
        ? result?.update
          ? `下载中${proxyHint}… ${progress}%`
          : result?.installMode === 'proxy-auto'
            ? `下载安装中${proxyHint}… ${progress}%（代理安装无法中途停止，关闭仅隐藏进度）`
            : `下载中${proxyHint}… ${progress}%`
        : state === 'done'
          ? isManualProxyMode
            ? '已切换为手动安装：更新包已在浏览器中打开。请先完全退出 OpenAWork，再运行下载的安装包。'
            : '更新已下载，重启应用以应用更新。'
          : state === 'checking'
            ? '正在检查更新…'
            : state === 'installing'
              ? '下载完成，正在安装更新…'
              : state === 'up-to-date'
                ? '当前已是最新版本。'
                : '检查更新以获取最新功能和修复。';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留备用
  const STATUS_MSG: Record<UpdateState, string> = {
    idle: '检查更新以获取最新功能和修复。',
    checking: '正在检查更新…',
    available: `发现新版本 ${result?.version ?? ''}${proxyHint}。`,
    downloading: result?.update
      ? `下载中${proxyHint}… ${progress}%`
      : result?.installMode === 'proxy-auto'
        ? `下载安装中${proxyHint}… ${progress}%（代理安装无法中途停止，关闭仅隐藏进度）`
        : `下载中${proxyHint}… ${progress}%`,
    installing: '下载完成，正在安装更新…',
    done: isManualProxyMode
      ? '已切换为手动安装：更新包已在浏览器中打开。请先完全退出 OpenAWork，再运行下载的安装包。'
      : '更新已下载，重启应用以应用更新。',
    'up-to-date': '当前已是最新版本。',
  };

  return createPortal(
    <div
      data-openawork-update-dialog="true"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: 0,
        margin: 0,
        width: '100vw',
        height: '100vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancelOrClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleCancelOrClose();
      }}
    >
      <div
        style={{
          background: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border-default))',
          borderRadius: 12,
          padding: '1.25rem',
          width: 'min(640px, calc(100vw - 24px))',
          maxHeight: 'min(78vh, 760px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
          boxShadow: '0 24px 80px hsl(220 40% 2% / 0.42)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>软件更新</span>
          {result?.channel && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                background:
                  result.channel === 'preview'
                    ? 'hsl(var(--primary) / 0.15)'
                    : 'hsl(142 71% 45% / 0.15)',
                color: result.channel === 'preview' ? 'hsl(var(--primary))' : 'hsl(142 71% 45%)',
                fontWeight: 600,
              }}
            >
              {result.channel === 'preview' ? '预览版' : '发行版'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div
            style={{
              fontSize: 14,
              color: 'hsl(var(--muted-foreground))',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {statusMessage}
          </div>

          {state === 'available' && releaseNotes ? (
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'hsl(var(--foreground))',
                  letterSpacing: '0.02em',
                }}
              >
                发布日志
              </div>
              <div
                style={{
                  maxHeight: 'min(42vh, 360px)',
                  overflowY: 'auto',
                  padding: '0.875rem 1rem',
                  borderRadius: 10,
                  background: 'hsl(var(--muted) / 0.35)',
                  border: '1px solid hsl(var(--border-default))',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'hsl(var(--foreground))',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {releaseNotes}
              </div>
            </section>
          ) : null}
        </div>

        {state === 'checking' && <Spinner />}

        {(state === 'downloading' || state === 'installing') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                height: 6,
                background: 'hsl(var(--muted) / 0.5)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'hsl(var(--primary))',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              <span>{progress}%</span>
              <span>
                {formatBytes(downloaded)}
                {total ? ` / ${formatBytes(total)}` : ''}
              </span>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            marginTop: 'auto',
            paddingTop: 4,
          }}
        >
          <button
            type="button"
            onClick={handleCancelOrClose}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid hsl(var(--border-default))',
              borderRadius: 6,
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              fontSize: 13,
              flex: '0 0 auto',
            }}
          >
            {state === 'downloading'
              ? result?.update
                ? '取消更新'
                : result?.installMode === 'proxy-auto'
                  ? '关闭进度'
                  : '取消更新'
              : '关闭'}
          </button>
          {(state === 'idle' || state === 'up-to-date') && (
            <button
              type="button"
              onClick={handleCheck}
              style={{
                padding: '6px 14px',
                background: 'hsl(var(--primary))',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              立即检查
            </button>
          )}
          {state === 'available' && (
            <button
              type="button"
              onClick={handleDownload}
              style={{
                padding: '6px 14px',
                background: 'hsl(var(--primary))',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              更新
            </button>
          )}
          {state === 'done' && !isManualProxyMode && (
            <button
              type="button"
              onClick={() => void restartDesktopApp()}
              style={{
                padding: '6px 14px',
                background: 'hsl(142 71% 45%)',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              重启
            </button>
          )}
          {state === 'done' && isManualProxyMode && (
            <button
              type="button"
              onClick={handleCancelOrClose}
              style={{
                padding: '6px 14px',
                background: 'hsl(142 71% 45%)',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
