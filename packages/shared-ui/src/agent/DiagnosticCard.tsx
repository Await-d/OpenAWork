import { color } from '../tokens.js';
import type { CSSProperties } from 'react';
export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  line: number;
  col: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface DiagnosticCardProps {
  filePath: string;
  diagnostics: Diagnostic[];
  onGoToLine?: (filePath: string, line: number, col: number) => void;
  style?: CSSProperties;
}

const SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: color.danger,
  warning: color.contrast,
  information: 'var(--aux))',
  hint: 'var(--fg-muted))',
};

const SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  error: '✗',
  warning: '⚠',
  information: 'ℹ',
  hint: '◉',
};

export function DiagnosticCard({ filePath, diagnostics, onGoToLine, style }: DiagnosticCardProps) {
  if (diagnostics.length === 0) return null;

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <div
      style={{
        border: `1px solid ${errors > 0 ? 'rgba(248,113,113,0.4)' : 'rgba(250,204,21,0.3)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        maxWidth: '100%',
        ...style,
      }}
    >
      <div
        style={{
          background: errors > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(250,204,21,0.08)',
          padding: '0.4rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--fg-muted))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {filePath.split('/').pop()}
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {errors > 0 && <span style={{ fontSize: 11, color: color.danger }}>✗ {errors}</span>}
          {warnings > 0 && <span style={{ fontSize: 11, color: color.contrast }}>⚠ {warnings}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {diagnostics.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onGoToLine?.(filePath, d.line, d.col)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '0.4rem 0.75rem',
              background: 'transparent',
              border: 'none',
              borderTop: i > 0 ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
              cursor: onGoToLine ? 'pointer' : 'default',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <span
              style={{
                color: SEVERITY_COLOR[d.severity],
                fontSize: 12,
                marginTop: 1,
                flexShrink: 0,
              }}
            >
              {SEVERITY_ICON[d.severity]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--fg-strong))',
                  wordBreak: 'break-word',
                }}
              >
                {d.message}
              </span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted))', marginLeft: 6 }}>
                L{d.line}:{d.col}
                {d.source ? ` (${d.source})` : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
