/**
 * 260516-team-phase-e · T-07
 *
 * Workflow 包选择器：创建 session 时选择 workflow 包。
 */

import { type CSSProperties } from 'react';

const SELECTOR_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  cursor: 'pointer',
  transition: 'border-color 150ms ease, background 150ms ease',
};

export interface WorkflowPackage {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: 'builtin' | 'custom' | 'forked';
}

export interface WorkflowPackageSelectorProps {
  packages: WorkflowPackage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function WorkflowPackageSelector({
  packages,
  selectedId,
  onSelect,
}: WorkflowPackageSelectorProps) {
  return (
    <div style={SELECTOR_STYLE}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        选择 Workflow 包
      </span>
      {packages.map((pkg) => {
        const isSelected = pkg.id === selectedId;
        return (
          <div
            key={pkg.id}
            role="button"
            tabIndex={0}
            style={{
              ...CARD_STYLE,
              borderColor: isSelected
                ? 'color-mix(in srgb, var(--accent) 60%, transparent)'
                : 'color-mix(in srgb, var(--border-default) 72%, transparent)',
              background: isSelected
                ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
                : CARD_STYLE.background,
            }}
            onClick={() => onSelect(pkg.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(pkg.id);
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>{pkg.name}</strong>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
                }}
              >
                {pkg.source}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--fg-default)' }}>{pkg.description}</span>
            {pkg.tags.length > 0 ? (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {pkg.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
