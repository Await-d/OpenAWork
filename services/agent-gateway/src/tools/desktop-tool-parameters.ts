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
          'hover',
          'check',
          'select',
          'find',
          'frames',
          'evaluate',
          'console',
          'network_list',
          'network_get',
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
      // check
      checked: { type: 'boolean' },
      // select
      values: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
      // find (1..100) 与 console (1..200) 共用同一属性，取并集上界
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      // evaluate
      script: { type: 'string', maxLength: 20000 },
      args: { type: 'array', maxItems: 20 },
      // console
      level: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
      clear: { type: 'boolean' },
      // network_list / network_get（与 console 共用 limit）
      urlContains: { type: 'string' },
      method: { type: 'string' },
      requestId: { type: 'string' },
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
        enum: [
          'status',
          'screenshot',
          'click',
          'type',
          'key',
          'hotkey',
          'scroll',
          'wait',
          'drag',
          'mouse_move',
          'long_press',
        ],
      },
      delayMs: { type: 'integer', minimum: 0, maximum: 5000 },
      x: { type: 'number' },
      y: { type: 'number' },
      // box：[x1, y1, x2, y2] 绝对截图像素矩形，落点取中心；与 x/y 二选一。
      box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
      // drag 的起点与终点坐标。
      fromX: { type: 'number' },
      fromY: { type: 'number' },
      toX: { type: 'number' },
      toY: { type: 'number' },
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
