/**
 * 控制台调用栈展示格式化的单测。
 *
 * 重点钉住四件容易悄悄坏掉的事：0-based → 1-based 的坐标转换、sourceMappedStack
 * 优先与逐帧回落、未映射判定、长位置串截断与帧数上限。
 */

import { describe, expect, it } from 'vitest';
import type {
  ConsoleSourceMappedStackFrame,
  ConsoleStackFrame,
} from './browser-console-types.js';
import {
  buildConsoleStackView,
  CONSOLE_STACK_LOCATION_MAX_CHARS,
  CONSOLE_STACK_MAX_FRAMES,
  toDisplayPosition,
  toStackFrameView,
  truncateStackLocation,
} from './browser-console-stack.js';

const BUNDLE_URL = 'http://localhost:5173/assets/bundle.js';

function rawFrame(overrides: Partial<ConsoleStackFrame> = {}): ConsoleStackFrame {
  return { url: BUNDLE_URL, line: 0, column: 8, functionName: 'boom', ...overrides };
}

function resolvedFrame(
  overrides: Partial<ConsoleSourceMappedStackFrame> = {},
): ConsoleSourceMappedStackFrame {
  return {
    url: BUNDLE_URL,
    line: 0,
    column: 8,
    functionName: 'boom',
    source: 'console.error',
    sourceLine: 0,
    sourceColumn: 8,
    sourceName: 'original.ts',
    mapped: true,
    ...overrides,
  };
}

describe('toDisplayPosition', () => {
  it('0-based 坐标 +1 转成人类可读位置', () => {
    expect(toDisplayPosition(0)).toBe(1);
    expect(toDisplayPosition(8)).toBe(9);
    expect(toDisplayPosition(41)).toBe(42);
  });

  it('负数 / 非有限值兜底为 1，保证展示稳定', () => {
    expect(toDisplayPosition(-1)).toBe(1);
    expect(toDisplayPosition(Number.NaN)).toBe(1);
    expect(toDisplayPosition(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('truncateStackLocation', () => {
  it('未超长的位置串原样返回', () => {
    expect(truncateStackLocation('original.ts:1:9')).toEqual({
      text: 'original.ts:1:9',
      truncated: false,
    });
  });

  it('超过上限时保留尾部坐标并标记截断', () => {
    const long = `http://example.test/${'a'.repeat(80)}/app.js:12:4`;
    const result = truncateStackLocation(long);

    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('…')).toBe(true);
    expect(result.text.endsWith('/app.js:12:4')).toBe(true);
    expect(result.text.length).toBe(CONSOLE_STACK_LOCATION_MAX_CHARS);
  });

  it('上限为 1 时退化为单个省略号', () => {
    expect(truncateStackLocation('original.ts:1:9', 1)).toEqual({ text: '…', truncated: true });
  });
});

describe('toStackFrameView', () => {
  it('mapped 帧展示源码位置（行列 +1）并保留函数名', () => {
    const view = toStackFrameView(resolvedFrame({ sourceLine: 0, sourceColumn: 8 }), undefined, 1);

    expect(view).toMatchObject({
      ordinal: 1,
      functionName: 'boom',
      location: 'original.ts:1:9',
      displayLocation: 'original.ts:1:9',
      truncated: false,
      unmapped: false,
    });
  });

  it('mapped 帧缺列号时只展示行列到行', () => {
    const view = toStackFrameView(resolvedFrame({ sourceColumn: null }));

    expect(view.location).toBe('original.ts:1');
  });

  it('mapped 为 true 但缺 sourceName / sourceLine 时回落原始位置', () => {
    const view = toStackFrameView(resolvedFrame({ sourceName: null, sourceLine: null }));

    expect(view.location).toBe(`${BUNDLE_URL}:1:9`);
    expect(view.unmapped).toBe(true);
  });

  it('原始帧展示打包后位置并标记未映射', () => {
    const view = toStackFrameView(rawFrame({ line: 11, column: 2 }), undefined, 3);

    expect(view.location).toBe(`${BUNDLE_URL}:12:3`);
    expect(view.unmapped).toBe(true);
    expect(view.ordinal).toBe(3);
  });

  it('原始帧未映射时优先使用同下标的回退帧', () => {
    const view = toStackFrameView(
      resolvedFrame({ mapped: false, line: 99, column: 99 }),
      rawFrame({ line: 4, column: 0 }),
    );

    expect(view.location).toBe(`${BUNDLE_URL}:5:1`);
  });

  it('函数名空白串按缺省处理', () => {
    expect(toStackFrameView(rawFrame({ functionName: '   ' })).functionName).toBeNull();
    expect(toStackFrameView(rawFrame({ functionName: undefined })).functionName).toBeNull();
  });
});

describe('buildConsoleStackView', () => {
  it('没有栈帧时返回 null（不渲染展开入口）', () => {
    expect(buildConsoleStackView({})).toBeNull();
    expect(buildConsoleStackView({ stack: [] })).toBeNull();
    expect(buildConsoleStackView({ sourceMappedStack: [] })).toBeNull();
  });

  it('优先使用 sourceMappedStack，逐帧 0-based → 1-based', () => {
    const view = buildConsoleStackView({ stack: [rawFrame()], sourceMappedStack: [resolvedFrame()] });

    expect(view).not.toBeNull();
    expect(view?.total).toBe(1);
    expect(view?.hiddenCount).toBe(0);
    expect(view?.hasMappedFrames).toBe(true);
    expect(view?.frames[0]?.location).toBe('original.ts:1:9');
    expect(view?.frames[0]?.unmapped).toBe(false);
  });

  it('sourceMappedStack 为空数组时整条回落原始帧', () => {
    const view = buildConsoleStackView({ stack: [rawFrame({ line: 3, column: 0 })], sourceMappedStack: [] });

    expect(view?.frames[0]?.location).toBe(`${BUNDLE_URL}:4:1`);
    expect(view?.frames[0]?.unmapped).toBe(true);
    expect(view?.hasMappedFrames).toBe(false);
  });

  it('逐帧回落：mapped:false 用同下标原始帧，其余帧仍展示源码位置', () => {
    const view = buildConsoleStackView({
      stack: [rawFrame({ line: 40, column: 1 }), rawFrame({ line: 7, column: 2 })],
      sourceMappedStack: [
        resolvedFrame({ mapped: false, sourceName: null, sourceLine: null, sourceColumn: null }),
        resolvedFrame({ sourceName: 'helper.ts', sourceLine: 6, sourceColumn: 2, functionName: 'inner' }),
      ],
    });

    expect(view?.frames[0]?.unmapped).toBe(true);
    expect(view?.frames[0]?.location).toBe(`${BUNDLE_URL}:41:2`);
    expect(view?.frames[1]?.unmapped).toBe(false);
    expect(view?.frames[1]?.location).toBe('helper.ts:7:3');
    expect(view?.hasMappedFrames).toBe(true);
  });

  it('长 URL 截断展示但完整值保留在 location 上', () => {
    const longUrl = `http://localhost:5173/${'chunk/'.repeat(30)}bundle.js`;
    const view = buildConsoleStackView({ stack: [rawFrame({ url: longUrl })] });

    expect(view?.frames[0]?.truncated).toBe(true);
    expect(view?.frames[0]?.displayLocation.startsWith('…')).toBe(true);
    expect(view?.frames[0]?.location).toBe(`${longUrl}:1:9`);
  });

  it('超过帧数上限时截断并给出剩余帧数', () => {
    const frames = Array.from({ length: 20 }, (_, index) =>
      rawFrame({ url: `http://localhost:5173/f${index}.js`, line: index, column: 0 }),
    );
    const view = buildConsoleStackView({ stack: frames });

    expect(view?.frames.length).toBe(CONSOLE_STACK_MAX_FRAMES);
    expect(view?.total).toBe(20);
    expect(view?.hiddenCount).toBe(8);
    expect(view?.frames[CONSOLE_STACK_MAX_FRAMES - 1]?.ordinal).toBe(CONSOLE_STACK_MAX_FRAMES);
  });
});
