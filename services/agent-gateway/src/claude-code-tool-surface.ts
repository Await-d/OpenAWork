import type { GatewayToolDefinition } from './tool-definitions.js';
import type { ClaudeCodeProfileName, ProfileToolSet } from './claude-code-tool-surface-profiles.js';
import {
  CLAUDE_CODE_PROFILE_NAMES,
  PRESENTED_TO_CANONICAL,
  PROFILE_TOOL_SETS,
} from './claude-code-tool-surface-profiles.js';

export type { ClaudeCodeProfileName, ProfileToolSet };
export { CLAUDE_CODE_PROFILE_NAMES, PRESENTED_TO_CANONICAL, PROFILE_TOOL_SETS };

export type ExposurePolicy = 'allow-all' | 'allowlist';

export interface ClaudeCodeToolSurface {
  profile: ClaudeCodeProfileName;
  policy: ExposurePolicy;
  allowedCanonicalNames: ReadonlySet<string> | null;
}

export function buildToolSurface(profile: ClaudeCodeProfileName): ClaudeCodeToolSurface {
  const toolSet = PROFILE_TOOL_SETS[profile];
  return {
    profile,
    policy: toolSet === null ? 'allow-all' : 'allowlist',
    allowedCanonicalNames: toolSet,
  };
}

export function isToolAllowed(surface: ClaudeCodeToolSurface, canonicalName: string): boolean {
  if (surface.policy === 'allow-all') return true;
  return surface.allowedCanonicalNames?.has(canonicalName) ?? false;
}

export function resolveCanonicalName(presentedName: string): string {
  return PRESENTED_TO_CANONICAL[presentedName] ?? presentedName;
}

export function filterToolDefinitionsForSurface(
  definitions: readonly GatewayToolDefinition[],
  surface: ClaudeCodeToolSurface,
): GatewayToolDefinition[] {
  if (surface.policy === 'allow-all') return [...definitions];
  return definitions.filter((def) =>
    isToolAllowed(surface, resolveCanonicalName(def.function.name)),
  );
}

export function isValidProfileName(name: string): name is ClaudeCodeProfileName {
  return (CLAUDE_CODE_PROFILE_NAMES as ReadonlyArray<string>).includes(name);
}
