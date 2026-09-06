import { describe, expect, it } from 'vitest';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import { rewriteLegacyToolRequest } from '../../tools/legacy-tool-name-rewrite.js';

describe('model-visible tool execution parity', () => {
  it('routes every static model-visible tool through a canonical executable name', () => {
    const visibleNames = buildGatewayToolDefinitions().map((tool) => tool.function.name);
    const canonicalNames = visibleNames.map(
      (toolName) => rewriteLegacyToolRequest(toolName, {}).toolName,
    );

    expect(visibleNames).toContain('execute_shell');
    expect(canonicalNames).toContain('bash');
  });
});
