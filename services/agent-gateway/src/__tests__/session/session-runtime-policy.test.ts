import { describe, expect, it } from 'vitest';
import {
  isChannelManagedSessionMetadata,
  resolveSessionRuntimePolicy,
} from '../../session/session-runtime-policy.js';

describe('session runtime policy', () => {
  it('Given channel session metadata When resolving policy Then it matches the default chat runtime policy', () => {
    const metadata = {
      source: 'channel',
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        tools: {
          read: true,
          mcp: true,
        },
      },
    };

    expect(isChannelManagedSessionMetadata(metadata)).toBe(true);
    expect(resolveSessionRuntimePolicy(metadata)).toEqual({
      includeCapabilityContext: true,
      includeLspGuidance: true,
      includePinnedSkillsPrompt: true,
      includeDynamicWorkspaceTools: true,
      includeFlatMcpToolDefinitions: true,
    });
  });

  it('Given normal desktop session metadata When resolving policy Then full workbench context remains enabled', () => {
    const metadata = {
      source: 'desktop',
      workingDirectory: '/workspace/demo',
    };

    expect(isChannelManagedSessionMetadata(metadata)).toBe(false);
    expect(resolveSessionRuntimePolicy(metadata)).toEqual({
      includeCapabilityContext: true,
      includeLspGuidance: true,
      includePinnedSkillsPrompt: true,
      includeDynamicWorkspaceTools: true,
      includeFlatMcpToolDefinitions: true,
    });
  });
});
