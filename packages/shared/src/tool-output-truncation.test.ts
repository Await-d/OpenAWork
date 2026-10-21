import { describe, expect, it } from 'vitest';
import {
  findToolOutputTruncation,
  findToolOutputTruncationDeep,
  formatToolOutputTruncationMarker,
  stripToolOutputTruncation,
  stripToolOutputTruncationDeep,
} from './tool-output-truncation.js';

describe('formatToolOutputTruncationMarker', () => {
  it('生成带前导换行的标记，与服务端截断点形态一致', () => {
    expect(formatToolOutputTruncationMarker(42)).toBe('\n…[truncated, 42 chars omitted]');
  });
});

describe('findToolOutputTruncation', () => {
  it('识别标记并回传省略字符数', () => {
    const text = `head${formatToolOutputTruncationMarker(1234)}`;
    expect(findToolOutputTruncation(text)).toEqual({ omittedChars: 1234 });
  });

  it('无标记时返回 null（区别于省略 0 字符）', () => {
    expect(findToolOutputTruncation('plain output')).toBeNull();
  });

  it('累加多处标记的省略量', () => {
    const text = `a${formatToolOutputTruncationMarker(10)}b${formatToolOutputTruncationMarker(5)}`;
    expect(findToolOutputTruncation(text)).toEqual({ omittedChars: 15 });
  });

  it('标记位于字符串开头（整个叶子被截断）时也能识别', () => {
    expect(findToolOutputTruncation('…[truncated, 7 chars omitted]')).toEqual({ omittedChars: 7 });
  });
});

describe('stripToolOutputTruncation', () => {
  it('剥离标记并保留正文', () => {
    const text = `head${formatToolOutputTruncationMarker(99)}`;
    expect(stripToolOutputTruncation(text)).toBe('head');
  });

  it('无标记时原样返回同一引用', () => {
    const text = 'plain output';
    expect(stripToolOutputTruncation(text)).toBe(text);
  });
});

describe('findToolOutputTruncationDeep', () => {
  it('扫描嵌套对象与数组里的叶子字符串', () => {
    const output = {
      exitCode: 0,
      stdout: `head${formatToolOutputTruncationMarker(300)}`,
      diffs: [{ after: `x${formatToolOutputTruncationMarker(20)}` }],
    };
    expect(findToolOutputTruncationDeep(output)).toEqual({ omittedChars: 320 });
  });

  it('无标记时返回 null', () => {
    expect(findToolOutputTruncationDeep({ stdout: 'ok' })).toBeNull();
  });
});

describe('stripToolOutputTruncationDeep', () => {
  it('剥离嵌套标记并保持结构，回传总省略量', () => {
    const output = {
      exitCode: 0,
      stdout: `head${formatToolOutputTruncationMarker(300)}`,
      diffs: [{ after: `x${formatToolOutputTruncationMarker(20)}` }],
    };
    const result = stripToolOutputTruncationDeep(output);
    expect(result).not.toBeNull();
    expect(result!.omittedChars).toBe(320);
    expect(result!.value).toEqual({ exitCode: 0, stdout: 'head', diffs: [{ after: 'x' }] });
  });

  it('无标记时返回 null（调用方可沿用原引用，避免多余渲染）', () => {
    const output = { stdout: 'ok' };
    expect(stripToolOutputTruncationDeep(output)).toBeNull();
  });

  it('剥离裸字符串输出', () => {
    const text = `body${formatToolOutputTruncationMarker(11)}`;
    expect(stripToolOutputTruncationDeep(text)).toEqual({ omittedChars: 11, value: 'body' });
  });
});
