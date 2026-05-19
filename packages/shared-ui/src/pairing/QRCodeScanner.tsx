import { color } from '../tokens.js';
import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface QRCodeScannerProps {
  onScan: (data: string) => void;
  onError?: (err: string) => void;
  style?: CSSProperties;
}

export function QRCodeScanner({ onScan, onError, style }: QRCodeScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [scanning, setScanning] = useState(false);

  async function startCamera() {
    setScanning(true);
    try {
      if (!('BarcodeDetector' in window)) {
        throw new Error('BarcodeDetector not supported in this browser');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const detector = new (
        window as unknown as {
          BarcodeDetector: new (opts: unknown) => {
            detect(img: unknown): Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector({ formats: ['qr_code'] });
      const frame = async () => {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          for (const t of stream.getTracks()) t.stop();
          setScanning(false);
          onScan(barcodes[0]!.rawValue);
          return;
        }
        if (scanning)
          requestAnimationFrame(() => {
            void frame();
          });
      };
      requestAnimationFrame(() => {
        void frame();
      });
    } catch (err) {
      setScanning(false);
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  function handleManualSubmit() {
    if (!manualInput.trim()) return;
    try {
      JSON.parse(manualInput);
      onScan(manualInput.trim());
      setManualInput('');
    } catch {
      onError?.('二维码数据格式无效');
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '1.5rem',
        background: 'var(--bg-overlay, #121721)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 12,
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => {
          void startCamera();
        }}
        disabled={scanning}
        style={{
          background: 'var(--accent, #5cd4c0)',
          color: color.fgOnAccent,
          border: 'none',
          borderRadius: 8,
          padding: '0.65rem',
          fontSize: 12,
          fontWeight: 600,
          cursor: scanning ? 'not-allowed' : 'pointer',
          opacity: scanning ? 0.7 : 1,
        }}
      >
        {scanning ? '扫描中…' : '扫描 QR 码'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-default, hsla(215, 18%, 50%, 0.12))' }} />
        <span style={{ fontSize: 11, color: 'var(--fg-muted, #7b8a9e)' }}>或手动输入</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-default, hsla(215, 18%, 50%, 0.12))' }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="粘贴 QR 数据 JSON…"
          style={{
            flex: 1,
            background: 'var(--bg-base, #080b12)',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            color: 'var(--fg-strong, #f1f4f8)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={!manualInput.trim()}
          style={{
            background: 'var(--accent, #5cd4c0)',
            color: color.fgOnAccent,
            border: 'none',
            borderRadius: 6,
            padding: '0.5rem 0.9rem',
            fontSize: 12,
            cursor: manualInput.trim() ? 'pointer' : 'not-allowed',
            opacity: manualInput.trim() ? 1 : 0.5,
          }}
        >
          连接
        </button>
      </div>
    </div>
  );
}
