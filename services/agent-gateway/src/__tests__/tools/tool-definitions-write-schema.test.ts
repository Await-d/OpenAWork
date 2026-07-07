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

  it('exposes all desktop automation actions and bounded action parameters', () => {
    const desktopAutomationTool = buildGatewayToolDefinitions().find(
      (tool) => tool.function.name === 'desktop_automation',
    );

    expect(desktopAutomationTool).toBeDefined();
    expect(desktopAutomationTool?.function.parameters.required).toEqual(['action']);
    expect(desktopAutomationTool?.function.parameters.properties.action).toMatchObject({
      enum: [
        'status',
        'start',
        'goto',
        'back',
        'forward',
        'reload',
        'click',
        'type',
        'press',
        'scroll',
        'wait',
        'content',
        'snapshot',
        'screenshot',
      ],
    });
    expect(desktopAutomationTool?.function.parameters.properties).toMatchObject({
      direction: { type: 'string', enum: ['up', 'down'] },
      amount: { type: 'integer', minimum: 1, maximum: 10000 },
      ms: { type: 'integer', minimum: 0, maximum: 60000 },
      key: { type: 'string' },
    });
  });

  it('exposes desktop control as a separate high-risk system-control schema', () => {
    const desktopControlTool = buildGatewayToolDefinitions().find(
      (tool) => tool.function.name === 'desktop_control',
    );

    expect(desktopControlTool).toBeDefined();
    expect(desktopControlTool?.function.parameters.required).toEqual(['action']);
    expect(desktopControlTool?.function.parameters.properties.action).toMatchObject({
      enum: ['status', 'screenshot', 'click', 'type', 'key', 'hotkey', 'scroll', 'wait'],
    });
    expect(desktopControlTool?.function.parameters.properties).toMatchObject({
      delayMs: { type: 'integer', minimum: 0, maximum: 5000 },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clickAction: { type: 'string', enum: ['click', 'double_click', 'down', 'up'] },
      keys: { type: 'array', minItems: 2, maxItems: 4 },
      ms: { type: 'integer', minimum: 0, maximum: 10000 },
    });
  });
});
