import { useState, useCallback, useEffect, useRef } from 'react';
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
      const r = await checkForUpdate();
      if (cancelledRef.current) return;
      setResult(r);
      setReleaseNotes(r.notes);
      setProxyUsed(r.proxyUsed);
      setState(r.available ? 'available' : 'up-to-date');
    } catch (e) {
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
    setState('downloading');
    setProgress(0);
    setDownloaded(0);
    setTotal(null);
    setError(null);

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

      await downloadUpdate(result.update, (p) => {
        if (cancelledRef.current) return;
        setProgress(p.percent);
        setDownloaded(p.downloaded);
        setTotal(p.total);
      });
      if (cancelledRef.current) return;
      setProgress(100);
      setState('installing');
      await installUpdate(result.update, {
        beforeInstall: stopGatewayBeforeInstall,
      });
      if (cancelledRef.current) return;
      setState('done');
    } catch (e) {
      if (cancelledRef.current) return;
      setError(toUpdateError(e));
    }
  }, [openManualDownload, result, stopGatewayBeforeInstall]);

  const handleClose = useCallback(() => {
    cancelledRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!autoCheck || autoCheckStartedRef.current) return;
    autoCheckStartedRef.current = true;
    void handleCheck();
  }, [autoCheck, handleCheck]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
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
  const STATUS_MSG: Record<UpdateState, string> = {
    idle: '检查更新以获取最新功能和修复。',
    checking: '正在检查更新…',
    available: `发现新版本 ${result?.version ?? ''}${proxyHint}。${
      releaseNotes
        ? `\
\
${releaseNotes}`
        : ''
    }`,
    downloading: `下载中${proxyHint}… ${progress}%`,
    installing: '下载完成，正在安装更新…',
    done: isManualProxyMode
      ? '已切换为手动安装：更新包已在浏览器中打开。请先完全退出 OpenAWork，再运行下载的安装包。'
      : '更新已下载，重启应用以应用更新。',
    'up-to-date': '当前已是最新版本。',
  };

  return (
    <dialog
      open
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        border: 'none',
        padding: 0,
        margin: 0,
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleClose();
      }}
    >
      <div
        style={{
          background: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border-default))',
          borderRadius: 12,
          padding: '1.5rem',
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
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
        <div
          style={{
            fontSize: 14,
            color: 'hsl(var(--muted-foreground))',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {STATUS_MSG[state]}
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid hsl(var(--border-default))',
              borderRadius: 6,
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {state === 'downloading' || state === 'installing' ? '取消显示' : '关闭'}
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
              }}
            >
              重启
            </button>
          )}
          {state === 'done' && isManualProxyMode && (
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: '6px 14px',
                background: 'hsl(142 71% 45%)',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
