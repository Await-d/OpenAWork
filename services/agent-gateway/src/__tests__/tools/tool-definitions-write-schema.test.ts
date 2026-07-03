import { describe, expect, it } from 'vitest';

import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';

describe('buildGatewayToolDefinitions write schema', () => {
  it('requires content plus either path or filePath for the model-visible write tool', () => {
    const writeTool = buildGatewayToolDefinitions().find((tool) => tool.function.name === 'write');

    expect(writeTool).toBeDefined();
    expect(writeTool?.function.parameters.type).toBe('object');
    expect(writeTool?.function.parameters.required).toEqual(['content']);
    expect(writeTool?.function.parameters.anyOf).toEqual([
      { required: ['path'] },
      { required: ['filePath'] },
    ]);
    expect(writeTool?.function.parameters.properties).toMatchObject({
      path: { type: 'string' },
      content: { type: 'string' },
      filePath: { type: 'string' },
    });
  });
});
