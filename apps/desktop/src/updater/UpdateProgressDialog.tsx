import { useState, useCallback, useEffect, useRef } from 'react';
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  type UpdateCheckResult,
  type UpdateError,
  type GitHubProxy,
} from './auto-update.js';
import { UpdateErrorDialog } from './UpdateErrorDialog.js';

type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'up-to-date';

async function tauriInvoke<T>(cmd: string): Promise<T> {
  const tauri = (
    window as Window & {
      __TAURI__?: { core: { invoke: (c: string) => Promise<T> } };
    }
  ).__TAURI__;
  if (!tauri) throw new Error('Not running in Tauri');
  return tauri.core.invoke(cmd);
}

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
      setError(e as UpdateError);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!result) return;

    if (result.proxiedDownloadUrl && !result.update) {
      // Proxy path: open in browser for manual download + install
      // (native Tauri install is unavailable without the Update object)
      window.open(result.proxiedDownloadUrl, '_blank');
      setState('done');
      return;
    }

    if (!result.update) return;
    cancelledRef.current = false;
    setState('downloading');
    setProgress(0);
    setDownloaded(0);
    setTotal(null);
    setError(null);

    try {
      await downloadUpdate(result.update, (p) => {
        if (cancelledRef.current) return;
        setProgress(p.percent);
        setDownloaded(p.downloaded);
        setTotal(p.total);
      });
      if (cancelledRef.current) return;
      setProgress(100);
      setState('installing');
      await installUpdate(result.update);
      if (cancelledRef.current) return;
      setState('done');
    } catch (e) {
      if (cancelledRef.current) return;
      setError(e as UpdateError);
    }
  }, [result]);

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

  const isProxyMode = !!proxyUsed;
  const proxyHint = proxyUsed ? `（通过 ${proxyUsed.name} 加速）` : '';
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
    done: isProxyMode
      ? '已通过代理下载完成，请手动安装更新包。'
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
          border: '1px solid hsl(var(--border))',
          borderRadius: 12,
          padding: '1.5rem',
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600 }}>软件更新</div>
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
              border: '1px solid hsl(var(--border))',
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
          {state === 'done' && !isProxyMode && (
            <button
              type="button"
              onClick={() => tauriInvoke('restart_app')}
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
          {state === 'done' && isProxyMode && (
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
