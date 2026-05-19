import { PRESENTED_TO_CANONICAL } from './claude-code-tool-surface-profiles.js';

export { PRESENTED_TO_CANONICAL };

export function resolveCanonicalName(presentedName: string): string {
  return PRESENTED_TO_CANONICAL[presentedName] ?? presentedName;
}
