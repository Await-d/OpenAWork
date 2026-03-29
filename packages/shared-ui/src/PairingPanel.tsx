import { useState } from 'react';
import { QRCodeDisplay } from './QRCodeDisplay.js';
import { QRCodeScanner } from './QRCodeScanner.js';

export type PairingMode = 'host' | 'client';

export interface PairedDevice {
  id: string;
  name: string;
  connectedAt: number;
}

export interface PairingHostProps {
  qrData: string;
  expiresAt: number;
  pairedDevices?: PairedDevice[];
  onRefreshToken?: () => void;
  onDisconnect?: (deviceId: string) => void;
}

export interface PairingClientProps {
  onScanned?: (data: string) => void;
  onManualCode?: (code: string) => void;
  connecting?: boolean;
  error?: string;
}

export interface PairingPanelProps {
  mode?: PairingMode;
  onModeChange?: (mode: PairingMode) => void;
  host?: PairingHostProps;
  client?: PairingClientProps;
}

function HostView({ host }: { host: PairingHostProps }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted, #64748b)', textAlign: 'center' }}>
        在其他设备上扫描此二维码以连接
      </div>
      <QRCodeDisplay
        qrData={host.qrData}
        expiresAt={host.expiresAt}
        onRefresh={host.onRefreshToken}
        size={180}
      />
      {host.pairedDevices && host.pairedDevices.length > 0 && (
        <div style={{ width: '100%' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-muted, #64748b)',
              marginBottom: 6,
            }}
          >
            已配对设备
          </div>
          {host.pairedDevices.map((d) => (
            <div
              key={d.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 8px',
                background: 'var(--color-surface, #1e293b)',
                borderRadius: 5,
                border: '1px solid var(--color-border, #334155)',
                marginBottom: 4,
              }}
            >
              <div>
                <div style={{ fontSize: 12 }}>{d.name}</div>
                <div style={{ fontSize: 10, color: 'var(--color-muted, #64748b)' }}>
                  已连接 {new Date(d.connectedAt).toLocaleTimeString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => host.onDisconnect?.(d.id)}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  border: '1px solid #f87171',
                  color: '#f87171',
                  background: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}
      {(!host.pairedDevices || host.pairedDevices.length === 0) && (
        <div style={{ fontSize: 12, color: 'var(--color-muted, #64748b)' }}>暂无已连接设备</div>
      )}
    </div>
  );
}

function ClientView({ client }: { client: PairingClientProps }) {
  const [manualCode, setManualCode] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted, #64748b)', textAlign: 'center' }}>
        扫描主机设备上显示的二维码
      </div>
      <QRCodeScanner onScan={client.onScanned ?? (() => undefined)} />
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="或手动输入码"
          style={{
            flex: 1,
            background: 'var(--color-surface, #1e293b)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 4,
            padding: '4px 8px',
            color: 'inherit',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={() => {
            client.onManualCode?.(manualCode);
            setManualCode('');
          }}
          disabled={!manualCode}
          style={{
            padding: '4px 10px',
            background: 'var(--color-accent, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: manualCode ? 'pointer' : 'default',
            opacity: manualCode ? 1 : 0.5,
            fontSize: 12,
          }}
        >
          连接
        </button>
      </div>
      {client.connecting && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-accent, #6366f1)' }}>
          连接中…
        </div>
      )}
      {client.error && (
        <div style={{ textAlign: 'center', fontSize: 12, color: '#f87171' }}>{client.error}</div>
      )}
    </div>
  );
}

export function PairingPanel({ mode = 'host', onModeChange, host, client }: PairingPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 360 }}>
      <div
        style={{
          display: 'flex',
          gap: 0,
          background: 'var(--color-surface, #1e293b)',
          borderRadius: 6,
          padding: 2,
          border: '1px solid var(--color-border, #334155)',
        }}
      >
        {(['host', 'client'] as PairingMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange?.(m)}
            style={{
              flex: 1,
              padding: '4px 0',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: mode === m ? 600 : 400,
              background: mode === m ? 'var(--color-accent, #6366f1)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--color-muted, #64748b)',
            }}
          >
            {m === 'host' ? '主机（桌面端）' : '客户端（移动端）'}
          </button>
        ))}
      </div>
      {mode === 'host' && host && <HostView host={host} />}
      {mode === 'client' && client && <ClientView client={client} />}
    </div>
  );
}
