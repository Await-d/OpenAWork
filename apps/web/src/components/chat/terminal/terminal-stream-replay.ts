/**
 * 终端输出回放状态机（契约 §3.2）。纯函数式对象，不依赖 React / xterm，
 * 让「哪段该写、哪段该丢」成为可单测的确定性逻辑。
 *
 * 三条规则：
 *  1. snapshot 只应用**首次**：EventSource 自动重连会重发 snapshot，
 *     若再次 reset 会清掉用户正在输入的半行命令 → 返回 null 表示丢弃；
 *  2. output 带 `seq` 时按单调序号去重：`seq <= lastSeq` 是重复 chunk → 丢弃；
 *  3. `data` 缺省时回退旧后端的「累积 tail + 总字节」语义，按字节差取增量。
 */

import type {
  TerminalStreamOutputPayload,
  TerminalStreamSnapshotPayload,
} from '../../conversation-runtime/terminals/terminals-api.js';

export interface TerminalSnapshotWrite {
  /** 是否清空本地缓冲（首次 snapshot 必须 reset）。 */
  reset: boolean;
  text: string;
}

export interface TerminalStreamReplay {
  applySnapshot(payload: TerminalStreamSnapshotPayload): TerminalSnapshotWrite | null;
  applyOutput(payload: TerminalStreamOutputPayload): string;
}

export function createTerminalStreamReplay(): TerminalStreamReplay {
  let lastSeq = 0;
  let lastBytes = 0;
  let snapshotApplied = false;

  return {
    applySnapshot(payload) {
      if (snapshotApplied) {
        return null;
      }
      snapshotApplied = true;
      lastSeq = payload.seq;
      lastBytes = payload.outputBytesTotal;
      return { reset: true, text: payload.data };
    },

    applyOutput(payload) {
      if (typeof payload.seq === 'number' && payload.seq > 0) {
        if (payload.seq <= lastSeq) {
          return '';
        }
        lastSeq = payload.seq;
        if (typeof payload.data === 'string') {
          lastBytes = payload.outputBytesTotal;
          return payload.data;
        }
      }

      const grown = payload.outputBytesTotal - lastBytes;
      if (grown <= 0) {
        return '';
      }
      lastBytes = payload.outputBytesTotal;
      const tail = payload.outputTail ?? '';
      return grown <= tail.length ? tail.slice(tail.length - grown) : tail;
    },
  };
}
