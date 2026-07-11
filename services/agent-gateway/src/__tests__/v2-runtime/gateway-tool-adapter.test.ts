import { describe, expect, it } from 'vitest';
import {
  type GatewayToolFunctionShape,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
} from '../../v2-runtime/upstream/index.js';

function buildGatewayTool(name: string, description: string): GatewayToolFunctionShape {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, numResults: { type: 'integer' } },
        required: ['query'],
        additionalProperties: false,
      },
      strict: false,
    },
  };
}

describe('wrapGatewayToolsForAiSdkDeclarationsOnly', () => {
  it('wraps flat MCP JSON-schema declarations with the AI SDK schema marker', () => {
    const set = wrapGatewayToolsForAiSdkDeclarationsOnly([
      buildGatewayTool('mcp__websearch__web_search_exa', 'exa search'),
    ]);
    const search = set['mcp__websearch__web_search_exa'];
    expect(search).toBeDefined();
    if (!search) {
      throw new Error('expected flat MCP tool to be wrapped');
    }
    if (typeof search.inputSchema !== 'object' || search.inputSchema === null) {
      throw new Error('expected flat MCP tool inputSchema to be an object');
    }

    const schemaSymbolDescriptions = Object.getOwnPropertySymbols(search.inputSchema).map(
      (symbol) => symbol.description,
    );
    expect(schemaSymbolDescriptions).toContain('vercel.ai.schema');
  });
});
