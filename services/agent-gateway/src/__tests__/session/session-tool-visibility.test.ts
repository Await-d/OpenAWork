import { describe, expect, it } from 'vitest';
import { isGatewayToolEnabledForSessionMetadata } from '../../session/session-tool-visibility.js';

describe('session tool visibility', () => {
  it('disables desktop control tools for channel-managed sessions', () => {
    const metadata = { source: 'channel' };

    expect(isGatewayToolEnabledForSessionMetadata('desktop_automation', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('desktop_control', metadata)).toBe(false);
  });

  it('keeps desktop control tools visible for normal desktop sessions', () => {
    const metadata = { source: 'desktop' };

    expect(isGatewayToolEnabledForSessionMetadata('desktop_automation', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('desktop_control', metadata)).toBe(true);
  });

  it('Given channel-managed metadata disables MCP When checking flat and legacy MCP tools Then neither entry point is visible', () => {
    const metadata = {
      source: 'channel',
      channel: {
        tools: {
          mcp: false,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('mcp_call', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('mcp__omo__adapter_catalog', metadata)).toBe(
      false,
    );
  });
});
