import React from 'react';

const PROVIDER_LOGO_URL: Record<string, string> = {
  anthropic: '/logo-anthropic.svg',
  claude: '/logo-claude.svg',
  openai: '/logo-openai.svg',
  gemini: '/logo-gemini.svg',
  googlegemini: '/logo-gemini.svg',
  ollama: '/logo-ollama.svg',
  openrouter: '/logo-openrouter.svg',
  deepseek: '/logo-deepseek.svg',
  moonshot: '/logo-moonshot.svg',
  qwen: '/logo-qwen.svg',
  mistralai: '/logo-mistralai.svg',
  mistral: '/logo-mistralai.svg',
};

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  anthropic: 'Anthropic',
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  googlegemini: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  qwen: 'Qwen',
  mistralai: 'Mistral AI',
  mistral: 'Mistral',
};

const PROVIDER_LOGOS_FALLBACK: Record<string, React.ReactNode> = {
  openai: '◎',
  anthropic: '◌',
  claude: '◌',
  gemini: '✦',
  googlegemini: '✦',
  deepseek: '◇',
  openrouter: '↗',
  moonshot: '☾',
  ollama: '◒',
  qwen: 'Q',
  mistral: 'M',
  mistralai: 'M',
};

const KNOWN_PROVIDER_KEYS = new Set<string>([
  ...Object.keys(PROVIDER_LOGO_URL),
  ...Object.keys(PROVIDER_DISPLAY_NAME),
  ...Object.keys(PROVIDER_LOGOS_FALLBACK),
]);

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
    'oklch(0.64 0.18 250)',
    'oklch(0.66 0.16 160)',
    'oklch(0.68 0.17 35)',
    'oklch(0.7 0.16 300)',
    'oklch(0.72 0.12 95)',
  ];
  let hash = 0;
  for (const char of providerId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length] ?? palette[0]!;
}

function formatProviderDisplayName(value: string): string {
  const normalized = value.trim().toLowerCase();
  const knownDisplayName = PROVIDER_DISPLAY_NAME[normalized];
  if (knownDisplayName) {
    return knownDisplayName;
  }

  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveKnownProviderKey(
  value?: string | null,
  options?: { allowTokenFallback?: boolean },
): string | undefined {
  const normalized = normalizeProviderKey(value ?? '');
  if (!normalized) {
    return undefined;
  }

  if (KNOWN_PROVIDER_KEYS.has(normalized)) {
    return normalized;
  }

  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (compact && KNOWN_PROVIDER_KEYS.has(compact)) {
    return compact;
  }

  if (options?.allowTokenFallback === false) {
    return undefined;
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (KNOWN_PROVIDER_KEYS.has(token)) {
      return token;
    }
  }

  return undefined;
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
  const visualKey =
    (resolveKnownProviderKey(providerType) ??
      resolveKnownProviderKey(providerId) ??
      resolveKnownProviderKey(providerName, { allowTokenFallback: false }) ??
      normalizedType) ||
    normalizedId;
  const displayName =
    trimmedName ||
    (normalizedType
      ? formatProviderDisplayName(normalizedType)
      : visualKey
        ? formatProviderDisplayName(visualKey)
        : normalizedId
          ? formatProviderDisplayName(normalizedId)
          : '助手');
  const accentKey =
    normalizedId || normalizedType || normalizeProviderKey(displayName) || 'assistant';

  return {
    accentKey,
    displayName,
    fallbackGlyph: PROVIDER_LOGOS_FALLBACK[visualKey],
    logoUrl: PROVIDER_LOGO_URL[visualKey],
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
        color: 'var(--text-2)',
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
          background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
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
        background: `linear-gradient(180deg, color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 16%, var(--surface) 84%) 0%, color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 10%, var(--bg-2) 90%) 100%)`,
        color: 'var(--text)',
        border: `1px solid color-mix(in oklch, ${resolveFallbackAccent(providerIdentity.accentKey)} 34%, var(--border-subtle) 66%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.36,
        fontWeight: 700,
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      }}
    >
      {providerIdentity.fallbackGlyph ??
        (providerIdentity.visualKey || providerIdentity.displayName).slice(0, 2).toUpperCase()}
    </div>
  );
}

export function UserAvatar({ email, size = 32 }: { email: string; size?: number }) {
  const initials = email ? (email[0]?.toUpperCase() ?? 'U') : 'U';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-hover) 100%)',
        color: 'var(--accent-text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.4,
        fontWeight: 700,
        border: '1px solid color-mix(in oklab, var(--accent) 78%, white 22%)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.18)',
      }}
    >
      {initials}
    </div>
  );
}
