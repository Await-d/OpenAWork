/**
 * Agent accent color map — ported from oh-my-opencode's agent color system.
 *
 * Each builtin agent has a hex accent color that is applied to the chat message
 * header (avatar border, display name, provider pill) to visually distinguish
 * which agent generated the response.
 */

export const BUILTIN_AGENT_COLORS: Record<string, string> = {
  build: '#6B7280',
  plan: '#8B5CF6',
  general: '#3B82F6',
  explore: '#10B981',
  sisyphus: '#A855F7',
  hephaestus: '#F97316',
  prometheus: '#EF4444',
  oracle: '#6366F1',
  zeus: '#EAB308',
  librarian: '#14B8A6',
  metis: '#2563EB',
  momus: '#F59E0B',
  atlas: '#0EA5E9',
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
