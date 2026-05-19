/**
 * Agent accent color map — ported from oh-my-opencode's agent color system.
 *
 * Each builtin agent has a hex accent color that is applied to the chat message
 * header (avatar border, display name, provider pill) to visually distinguish
 * which agent generated the response.
 */

export const BUILTIN_AGENT_COLORS: Record<string, string> = {
  build: 'var(--fg-muted, #7b8a9e)',
  plan: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  general: 'var(--aux, var(--aux, #8b9cf5))',
  explore: 'var(--success, var(--success, #3dd49a))',
  sisyphus: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  hephaestus: 'var(--contrast, var(--warning, #f0b429))',
  prometheus: 'var(--danger, var(--danger, #f06b7e))',
  oracle: 'var(--accent, var(--accent, #5cd4c0))',
  zeus: 'var(--warning, var(--warning, #f0b429))',
  librarian: 'var(--accent, var(--accent, #5cd4c0))',
  metis: 'var(--aux, var(--aux, #8b9cf5))',
  momus: 'var(--warning, var(--warning, #f0b429))',
  atlas: 'var(--chart-7, var(--chart-7, #67e8f9))',
};

const FALLBACK_PALETTE = [
  'oklch(0.64 0.18 250)',
  'oklch(0.66 0.16 160)',
  'oklch(0.68 0.17 35)',
  'oklch(0.7 0.16 300)',
  'oklch(0.72 0.12 95)',
];

/**
 * Resolve the accent color for a given agentId.
 * Returns the hex color from the builtin map, or a deterministic oklch fallback.
 */
export function resolveAgentAccentColor(agentId: string | undefined | null): string | undefined {
  if (!agentId) return undefined;
  const builtin = BUILTIN_AGENT_COLORS[agentId];
  if (builtin) return builtin;

  // Deterministic fallback for custom agents
  let hash = 0;
  for (const char of agentId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length] ?? FALLBACK_PALETTE[0];
}
