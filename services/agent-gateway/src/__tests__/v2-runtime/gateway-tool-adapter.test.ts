import { describe, expect, it } from 'vitest';
import {
  type GatewayToolFunctionShape,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
} from '../../v2-runtime/upstream/index.js';

function buildGatewayTool(
  name: string,
  description: string,
  parameters: GatewayToolFunctionShape['function']['parameters'] = {
    type: 'object',
    properties: { query: { type: 'string' }, numResults: { type: 'integer' } },
    required: ['query'],
    additionalProperties: false,
  },
): GatewayToolFunctionShape {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
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

  it('preserves object types for root anyOf branches used by gateway tools', async () => {
    const set = wrapGatewayToolsForAiSdkDeclarationsOnly([
      buildGatewayTool('codegraph_node', 'inspect codegraph nodes', {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          file: { type: 'string' },
        },
        required: [],
        anyOf: [
          { type: 'object', required: ['symbol'] },
          { type: 'object', required: ['file'] },
        ],
        additionalProperties: false,
      }),
    ]);
    const node = set['codegraph_node'];
    expect(node).toBeDefined();
    if (!node || typeof node.inputSchema !== 'object' || node.inputSchema === null) {
      throw new Error('expected codegraph_node schema to be wrapped');
    }
    if (!('jsonSchema' in node.inputSchema)) {
      throw new Error('expected wrapped schema to expose jsonSchema');
    }

    const schema = await Promise.resolve(node.inputSchema.jsonSchema);
    expect(schema.type).toBe('object');
    expect(schema.anyOf).toEqual([
      { type: 'object', required: ['symbol'] },
      { type: 'object', required: ['file'] },
    ]);
  });
});
