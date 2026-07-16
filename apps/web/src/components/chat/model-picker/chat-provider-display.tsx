import React from 'react';
import { resolveProviderVisual } from '@openAwork/shared-ui';

interface ProviderIdentityInput {
  providerId?: string | null;
  providerName?: string | null;
  providerType?: string | null;
}

interface ResolvedProviderIdentity {
  accentKey: string;
  displayName: string;
  fallbackGlyph?: React.ReactNode;
  logoUrl?: string;
  normalizedId: string;
  normalizedType: string;
  visualKey: string;
}

function resolveFallbackAccent(providerId: string): string {
  const palette = [
    'var(--aux)',
    'var(--success)',
    'var(--complement)',
    'var(--chart-5)',
    'var(--contrast)',
  ];
  let hash = 0;
  for (const char of providerId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length] ?? palette[0]!;
}

function formatProviderDisplayName(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeProviderLabel(value: string): string {
  return resolveProviderIdentity({ providerId: value }).displayName;
}

export function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveProviderIdentity({
  providerId,
  providerName,
  providerType,
}: ProviderIdentityInput): ResolvedProviderIdentity {
  const normalizedId = normalizeProviderKey(providerId ?? '');
  const normalizedType = normalizeProviderKey(providerType ?? '');
  const trimmedName = providerName?.trim() ?? '';

  // 统一走 catalog 的视觉解析(单一事实来源)，新增平台无需改本文件。
  const visual = resolveProviderVisual({ providerType, providerId, providerName });
  const visualKey = visual.type ?? normalizedType ?? normalizedId;
  const displayName =
    trimmedName ||
    visual.displayName ||
    (normalizedType
      ? formatProviderDisplayName(normalizedType)
      : normalizedId
        ? formatProviderDisplayName(normalizedId)
        : '助手');
  const accentKey =
    normalizedId || normalizedType || normalizeProviderKey(displayName) || 'assistant';

  return {
    accentKey,
    displayName,
    fallbackGlyph: visual.fallbackGlyph,
    logoUrl: visual.logoUrl,
    normalizedId,
    normalizedType,
    visualKey,
  };
}

export function ProviderMark({
  providerId,
  providerName,
  providerType,
  size = 12,
}: ProviderIdentityInput & { size?: number }) {
  const providerIdentity = React.useMemo(
    () => resolveProviderIdentity({ providerId, providerName, providerType }),
    [providerId, providerName, providerType],
  );
  const imageKey = `${providerIdentity.visualKey}:${providerIdentity.logoUrl ?? ''}`;
  const [failedImageKey, setFailedImageKey] = React.useState<string | null>(null);

  if (providerIdentity.logoUrl && failedImageKey !== imageKey) {
    return (
      <img
        src={providerIdentity.logoUrl}
        alt={providerIdentity.visualKey || providerIdentity.displayName}
        width={size}
        height={size}
        style={{
          objectFit: 'contain',
          filter: 'var(--provider-logo-filter, none)',
          flexShrink: 0,
        }}
        onError={() => {
          setFailedImageKey(imageKey);
        }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={providerIdentity.displayName}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--fg-default)',
        fontSize: Math.max(9, Math.round(size * 0.8)),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {providerIdentity.fallbackGlyph ??
        (providerIdentity.visualKey || providerIdentity.displayName).slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ProviderAvatar({
  providerId,
  providerName,
  providerType,
  size = 32,
}: ProviderIdentityInput & { providerId: string; size?: number }) {
  const providerIdentity = React.useMemo(
    () => resolveProviderIdentity({ providerId, providerName, providerType }),
    [providerId, providerName, providerType],
  );
  const imageKey = `${providerIdentity.visualKey}:${providerIdentity.logoUrl ?? ''}`;
  const [failedImageKey, setFailedImageKey] = React.useState<string | null>(null);

  if (providerIdentity.logoUrl && failedImageKey !== imageKey) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-overlay) 100%)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <img
          src={providerIdentity.logoUrl}
          alt={providerIdentity.visualKey || providerIdentity.displayName}
          width={size * 0.62}
          height={size * 0.62}
          style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
          onError={() => {
            setFailedImageKey(imageKey);
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(180deg, color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 16%, var(--bg-overlay) 84%) 0%, color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 10%, var(--bg-overlay) 90%) 100%)`,
        color: 'var(--fg-strong)',
        border: `1px solid color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 34%, var(--border-subtle) 66%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.36,
        fontWeight: 700,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {providerIdentity.fallbackGlyph ??
        (providerIdentity.visualKey || providerIdentity.displayName).slice(0, 2).toUpperCase()}
    </div>
  );
}

export function UserAvatar({
  email,
  displayName,
  size = 32,
}: {
  email: string;
  displayName?: string;
  size?: number;
}) {
  const preferredLabel = displayName?.trim() || email;
  const initials = preferredLabel ? (preferredLabel[0]?.toUpperCase() ?? 'U') : 'U';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-hover) 100%)',
        color: 'var(--fg-on-accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.4,
        fontWeight: 700,
        border: '1px solid color-mix(in oklab, var(--accent) 78%, white 22%)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {initials}
    </div>
  );
}
