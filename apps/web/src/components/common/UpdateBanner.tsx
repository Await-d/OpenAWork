import { useState, useEffect } from 'react';

declare const __APP_VERSION__: string;

function getAppVersion(): string {
  try {
    return __APP_VERSION__;
  } catch {
    return 'dev';
  }
}

export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return;
      setReg(r);
      r.addEventListener('updatefound', () => {
        const worker = r.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });
    });
  }, []);

  const handleReload = () => {
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  };

  const version = getAppVersion();

  if (!updateAvailable) {
    if (version === 'dev') return null;
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 8,
          left: 8,
          fontSize: 10,
          color: 'var(--text-3)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ pointerEvents: 'none' }}>v{version}</span>
        <a
          href="https://github.com/Await-d/OpenAWork"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub 仓库"
          style={{ color: 'var(--text-3)', lineHeight: 1, display: 'flex', alignItems: 'center' }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="currentColor"
            role="img"
            aria-label="GitHub 仓库"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--surface)',
        border: '1px solid var(--accent-muted)',
        borderRadius: 10,
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 9998,
        boxShadow: 'var(--shadow-md)',
        fontSize: 12,
        color: 'var(--text)',
      }}
    >
      <span>发现新版本</span>
      <button
        type="button"
        onClick={handleReload}
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-text)',
          border: 'none',
          borderRadius: 6,
          padding: '4px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        刷新
      </button>
    </div>
  );
}
