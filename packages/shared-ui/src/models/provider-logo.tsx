import type { SyntheticEvent } from 'react';

import { resolveProviderVisual } from './provider-catalog-ui.js';

export function ProviderLogo({ type, size = 28 }: { type: string; size?: number }) {
  const visual = resolveProviderVisual({ providerType: type });
  const url = visual.logoUrl;
  const glyph = visual.fallbackGlyph ?? type.slice(0, 2);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={type}
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
          style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
          onError={(e: SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.round(size * 0.45),
            fontWeight: 700,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
          }}
        >
          {glyph}
        </span>
      )}
    </div>
  );
}
