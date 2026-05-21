/**
 * Agent accent color map — ported from oh-my-opencode's agent color system.
 *
 * Each builtin agent has a hex accent color that is applied to the chat message
 * header (avatar border, display name, provider pill) to visually distinguish
 * which agent generated the response.
 */

export const BUILTIN_AGENT_COLORS: Record<string, string> = {
  build: 'var(--fg-muted)',
  plan: 'var(--chart-5)',
  general: 'var(--aux)',
  explore: 'var(--success)',
  sisyphus: 'var(--chart-5)',
  hephaestus: 'var(--contrast)',
  prometheus: 'var(--danger)',
  oracle: 'var(--accent)',
  zeus: 'var(--warning)',
  librarian: 'var(--accent)',
  metis: 'var(--aux)',
  momus: 'var(--warning)',
  atlas: 'var(--chart-7)',
};

const FALLBACK_PALETTE = [
  'var(--aux)',
  'var(--success)',
  'var(--complement)',
  'var(--chart-5)',
  'var(--contrast)',
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
