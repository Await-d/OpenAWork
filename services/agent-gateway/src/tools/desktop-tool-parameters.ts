export function buildDesktopAutomationParameters() {
  return {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
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
      },
      url: { type: 'string' },
      selector: { type: 'string' },
      text: { type: 'string' },
      key: { type: 'string' },
      direction: { type: 'string', enum: ['up', 'down'] },
      amount: { type: 'integer', minimum: 1, maximum: 10000 },
      ms: { type: 'integer', minimum: 0, maximum: 60000 },
    },
    required: ['action'],
    additionalProperties: false,
  };
}

export function buildDesktopControlParameters() {
  return {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'screenshot', 'click', 'type', 'key', 'hotkey', 'scroll', 'wait'],
      },
      delayMs: { type: 'integer', minimum: 0, maximum: 5000 },
      x: { type: 'number' },
      y: { type: 'number' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clickAction: { type: 'string', enum: ['click', 'double_click', 'down', 'up'] },
      text: { type: 'string' },
      key: { type: 'string' },
      keys: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
      scrollX: { type: 'number' },
      scrollY: { type: 'number' },
      ms: { type: 'integer', minimum: 0, maximum: 10000 },
    },
    required: ['action'],
    additionalProperties: false,
  };
}
