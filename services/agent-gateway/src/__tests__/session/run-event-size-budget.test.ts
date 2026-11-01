import { describe, expect, it } from 'vitest';
import {
  assertRunEventSize,
  RUN_EVENT_MAX_BYTES,
  RunEventSizeError,
} from '../../session/run-event-size-budget.js';

describe('run event pre-serialization budget', () => {
  it('accepts normal text and nested tool output without mutation', () => {
    const event = Object.freeze({
      type: 'tool_result',
      output: Object.freeze({ path: '文件.ts', rows: Object.freeze([1, 2, 3]) }),
    });
    expect(() => assertRunEventSize(event)).not.toThrow();
  });
  it.each(['x', '中', '\u0000'])('rejects a large %j string before serialization', (text) => {
    expect(() => assertRunEventSize({ delta: text.repeat(RUN_EVENT_MAX_BYTES) })).toThrow(
      RunEventSizeError,
    );
  });
  it('bounds node traversal and depth', () => {
    expect(() => assertRunEventSize(new Array(40000).fill(1))).toThrow(RunEventSizeError);
    expect(() => assertRunEventSize(new Array(40000))).toThrow(RunEventSizeError);
    let value: unknown = 0;
    for (let depth = 0; depth < 80; depth += 1) value = { nested: value };
    expect(() => assertRunEventSize(value)).toThrow(RunEventSizeError);
  });
  it('checks non-enumerable serialization hooks and array elements without invoking getters', () => {
    const value = Object.defineProperty({}, 'toJSON', {
      get: () => {
        throw new Error('hook invoked');
      },
    });
    expect(() => assertRunEventSize(value)).toThrow(RunEventSizeError);
    const array = Object.defineProperty([], '0', {
      value: 'x'.repeat(RUN_EVENT_MAX_BYTES + 1),
      enumerable: false,
    });
    expect(() => assertRunEventSize(array)).toThrow(RunEventSizeError);
    const accessor = Object.defineProperty([], '0', {
      get: () => {
        throw new Error('index invoked');
      },
    });
    expect(() => assertRunEventSize(accessor)).toThrow(RunEventSizeError);
  });

  it('does not invoke custom serialization or getters', () => {
    const value = {
      get content(): string {
        throw new Error('getter invoked');
      },
    };
    expect(() => assertRunEventSize(value)).toThrow(RunEventSizeError);
    expect(() => assertRunEventSize({ toJSON: () => 'custom' })).toThrow(RunEventSizeError);
  });
});
