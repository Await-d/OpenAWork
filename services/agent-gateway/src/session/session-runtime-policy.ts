export interface SessionRuntimePolicy {
  readonly includeCapabilityContext: boolean;
  readonly includeLspGuidance: boolean;
  readonly includePinnedSkillsPrompt: boolean;
  readonly includeDynamicWorkspaceTools: boolean;
  readonly includeFlatMcpToolDefinitions: boolean;
}

const DEFAULT_SESSION_RUNTIME_POLICY: SessionRuntimePolicy = {
  includeCapabilityContext: true,
  includeLspGuidance: true,
  includePinnedSkillsPrompt: true,
  includeDynamicWorkspaceTools: true,
  includeFlatMcpToolDefinitions: true,
};

export function isChannelManagedSessionMetadata(metadata: Record<string, unknown>): boolean {
  return metadata['source'] === 'channel';
}

export function resolveSessionRuntimePolicy(
  _metadata: Record<string, unknown>,
): SessionRuntimePolicy {
  return DEFAULT_SESSION_RUNTIME_POLICY;
}
