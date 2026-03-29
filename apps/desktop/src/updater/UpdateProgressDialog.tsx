import { useState, useCallback } from 'react';
import {
  checkForUpdate,
  downloadAndInstall,
  type UpdateCheckResult,
  type UpdateError,
} from './auto-update.js';
import { UpdateErrorDialog } from './UpdateErrorDialog.js';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'done' | 'up-to-date';

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
  onClose: () => void;
}

export function UpdateProgressDialog({ onClose }: UpdateProgressDialogProps) {
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UpdateError | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    setState('checking');
    setError(null);
    try {
      const r = await checkForUpdate();
      setResult(r);
      setReleaseNotes(r.notes);
      setState(r.available ? 'available' : 'up-to-date');
    } catch (e) {
      setError(e as UpdateError);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!result?.update) return;
    setState('downloading');
    setProgress(0);
    setError(null);
    try {
      await downloadAndInstall(result.update, (p) => setProgress(p.percent));
      setState('done');
    } catch (e) {
      setError(e as UpdateError);
    }
  }, [result]);

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

  const STATUS_MSG: Record<UpdateState, string> = {
    idle: '检查更新以获取最新功能和修复。',
    checking: '正在检查更新…',
    available: `发现新版本 ${result?.version ?? ''}。${
      releaseNotes
        ? `\
\
${releaseNotes}`
        : ''
    }`,
    downloading: `下载中… ${progress}%`,
    done: '更新已下载，重启应用以应用更新。',
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
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
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

        {state === 'downloading' && (
          <div
            style={{
              height: 4,
              background: 'hsl(var(--muted) / 0.5)',
              borderRadius: 2,
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
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
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
            {state === 'downloading' ? '隐藏' : '关闭'}
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
          {state === 'done' && (
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
        </div>
      </div>
    </dialog>
  );
}
