import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface AuditLogExportButtonProps {
  sessionId: string;
  onExport: (sessionId: string, format: 'json' | 'markdown') => Promise<string>;
  style?: CSSProperties;
}

export function AuditLogExportButton({ sessionId, onExport, style }: AuditLogExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<'json' | 'markdown'>('markdown');

  async function handleExport() {
    setLoading(true);
    try {
      const content = await onExport(sessionId, format);
      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${sessionId.slice(0, 8)}.${format === 'json' ? 'json' : 'md'}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', ...style }}>
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as 'json' | 'markdown')}
        style={{
          background: 'var(--bg-base))',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 6,
          padding: '0.35rem 0.5rem',
          color: 'var(--fg-strong))',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <option value="markdown">Markdown</option>
        <option value="json">JSON</option>
      </select>
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={loading}
        style={{
          background: 'var(--bg-overlay))',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 6,
          padding: '0.35rem 0.75rem',
          color: 'var(--fg-muted))',
          fontSize: 12,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '导出中…' : '导出审计日志'}
      </button>
    </div>
  );
}
