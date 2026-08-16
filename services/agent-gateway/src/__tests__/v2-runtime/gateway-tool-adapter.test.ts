import { describe, expect, it } from 'vitest';
import {
  type GatewayToolFunctionShape,
  wrapGatewayToolsForNativeDeclarationsOnly,
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
    function: { name, description, parameters, strict: false },
  };
}

describe('wrapGatewayToolsForNativeDeclarationsOnly', () => {
  it('preserves flat MCP JSON-schema declarations', () => {
    const set = wrapGatewayToolsForNativeDeclarationsOnly([
      buildGatewayTool('mcp__websearch__web_search_exa', 'exa search'),
    ]);
    const search = set['mcp__websearch__web_search_exa'];
    expect(search?.name).toBe('mcp__websearch__web_search_exa');
    expect(search?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('preserves root anyOf branches used by gateway tools', () => {
    const set = wrapGatewayToolsForNativeDeclarationsOnly([
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
    expect(set['codegraph_node']?.inputSchema).toMatchObject({
      type: 'object',
      anyOf: [
        { type: 'object', required: ['symbol'] },
        { type: 'object', required: ['file'] },
      ],
    });
  });
});
