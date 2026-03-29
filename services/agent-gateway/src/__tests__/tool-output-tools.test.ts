import { describe, expect, it } from 'vitest';
import { buildReadToolOutputResponse } from '../tool-output-tools.js';

describe('buildReadToolOutputResponse', () => {
  it('returns selected text lines for large string outputs', () => {
    const output = ['line-1', 'line-2', 'line-3', 'line-4'].join('\n');
    const result = buildReadToolOutputResponse({
      toolCallId: 'call-text-1',
      output,
      isError: false,
      request: { toolCallId: 'call-text-1', lineStart: 2, lineCount: 2 },
      sizeBytes: Buffer.byteLength(output, 'utf8'),
    });

    expect(result).toMatchObject({
      toolCallId: 'call-text-1',
      fullOutputPreserved: true,
      outputType: 'string',
      totalLines: 4,
      selection: { mode: 'lines', lineStart: 2, lineCount: 2 },
      output: 'line-2\nline-3',
    });
  });

  it('supports jsonPath and item pagination for structured outputs', () => {
    const output = {
      data: {
        items: [
          { id: 'a', value: 1 },
          { id: 'b', value: 2 },
          { id: 'c', value: 3 },
        ],
      },
    };
    const result = buildReadToolOutputResponse({
      toolCallId: 'call-array-1',
      output,
      isError: false,
      request: {
        toolCallId: 'call-array-1',
        jsonPath: 'data.items',
        itemStart: 1,
        itemCount: 2,
      },
      sizeBytes: Buffer.byteLength(JSON.stringify(output), 'utf8'),
    });

    expect(result).toMatchObject({
      toolCallId: 'call-array-1',
      outputType: 'array',
      totalItems: 3,
      selection: { mode: 'items', jsonPath: 'data.items', itemStart: 1, itemCount: 2 },
      output: [
        { id: 'b', value: 2 },
        { id: 'c', value: 3 },
      ],
    });
  });

  it('returns top-level keys and guidance when an object selection is still too large', () => {
    const output = {
      data: {
        summary: 'ready',
        huge: 'x'.repeat(9000),
      },
    };
    const result = buildReadToolOutputResponse({
      toolCallId: 'call-object-1',
      output,
      isError: false,
      request: { toolCallId: 'call-object-1', jsonPath: 'data' },
      sizeBytes: Buffer.byteLength(JSON.stringify(output), 'utf8'),
    });

    expect(result).toMatchObject({
      toolCallId: 'call-object-1',
      outputType: 'object',
      selection: { mode: 'keys', jsonPath: 'data' },
      topLevelKeys: ['summary', 'huge'],
    });
    expect(result.note).toContain('jsonPath');
  });
});
