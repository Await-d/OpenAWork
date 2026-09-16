// @vitest-environment jsdom
/**
 * 输出回放状态机：snapshot 首次语义、seq 单调去重、旧 tail-diff 兼容。
 */

import { describe, expect, it } from 'vitest';
import { createTerminalStreamReplay } from './terminal-stream-replay.js';
import type {
  TerminalStreamOutputPayload,
  TerminalStreamSnapshotPayload,
} from '../../conversation-runtime/terminals/terminals-api.js';

function snapshot(
  overrides: Partial<TerminalStreamSnapshotPayload> = {},
): TerminalStreamSnapshotPayload {
  return { terminalId: 'term_1', seq: 0, data: '', outputBytesTotal: 0, status: 'running', ...overrides };
}

function output(overrides: Partial<TerminalStreamOutputPayload> = {}): TerminalStreamOutputPayload {
  return { outputBytesTotal: 0, ...overrides };
}

describe('createTerminalStreamReplay', () => {
  it('首次 snapshot 要求 reset 并写入全文', () => {
    const replay = createTerminalStreamReplay();

    expect(replay.applySnapshot(snapshot({ seq: 12, data: 'ring buffer', outputBytesTotal: 11 }))).toEqual(
      { reset: true, text: 'ring buffer' },
    );
  });

  it('重复 snapshot（重连重发）被丢弃，避免清掉用户半输入', () => {
    const replay = createTerminalStreamReplay();

    replay.applySnapshot(snapshot({ seq: 1, data: 'history', outputBytesTotal: 7 }));

    expect(replay.applySnapshot(snapshot({ seq: 1, data: 'history', outputBytesTotal: 7 }))).toBeNull();
    expect(replay.applySnapshot(snapshot({ seq: 99, data: 'reconnect', outputBytesTotal: 20 }))).toBeNull();
  });

  it('seq 单调递增时写入增量，重复或更旧的 seq 丢弃', () => {
    const replay = createTerminalStreamReplay();
    replay.applySnapshot(snapshot({ seq: 1, data: 'a', outputBytesTotal: 1 }));

    expect(replay.applyOutput(output({ seq: 2, data: 'b', outputBytesTotal: 2 }))).toBe('b');
    expect(replay.applyOutput(output({ seq: 2, data: 'b', outputBytesTotal: 2 }))).toBe('');
    expect(replay.applyOutput(output({ seq: 1, data: 'old', outputBytesTotal: 1 }))).toBe('');
    expect(replay.applyOutput(output({ seq: 3, data: 'c', outputBytesTotal: 3 }))).toBe('c');
  });

  it('seq 存在但 data 缺省时仍回退 tail-diff（半升级后端）', () => {
    const replay = createTerminalStreamReplay();
    replay.applySnapshot(snapshot({ seq: 1, data: 'hello', outputBytesTotal: 5 }));

    expect(replay.applyOutput(output({ seq: 2, outputTail: 'hello world', outputBytesTotal: 11 }))).toBe(
      ' world',
    );
  });

  it('旧后端（无 seq / 无 data）按累积 tail 的字节差回放', () => {
    const replay = createTerminalStreamReplay();
    // 旧后端的 snapshot 经 terminals-api 归一化后就是 data + seq=0。
    replay.applySnapshot(snapshot({ seq: 0, data: 'hello', outputBytesTotal: 5 }));

    expect(replay.applyOutput(output({ outputTail: 'hello world', outputBytesTotal: 11 }))).toBe(' world');
    expect(replay.applyOutput(output({ outputTail: 'hello world', outputBytesTotal: 11 }))).toBe('');
    // tail 窗口滚过头：差值大于 tail 长度时整段写入并信任后端
    expect(replay.applyOutput(output({ outputTail: 'fresh tail', outputBytesTotal: 200 }))).toBe(
      'fresh tail',
    );
  });
});
