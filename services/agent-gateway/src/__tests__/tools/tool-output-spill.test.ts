/**
 * 工具输出全文落盘（D）回归：超限结果把全文写到 `<dataDir>/tool-outputs/`，
 * `read_tool_output` 由此取回；路径安全、会话删除清理、启动过期清理。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSpilledToolOutputsForSession,
  pruneStaleSpilledToolOutputs,
  readSpilledToolOutput,
  resolveToolOutputSpillPath,
  spillToolOutput,
} from '../../tools/tool-output-spill.js';
import { normalizeToolResultOutputForStorage } from '../../tools/tool-result-contract.js';

const SESSION_ID = 'session-aaaaaaaa-1111';
const TOOL_CALL_ID = 'call_bbbbbbbb-2222';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'openawork-spill-'));
  vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('tool-output-spill', () => {
  it('写入后可读回全文，路径位于 spill 根目录下', () => {
    const content = 'full-output\n'.repeat(1_000);
    const filePath = spillToolOutput({ sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID, content });

    expect(filePath).toBe(join(dataDir, 'tool-outputs', SESSION_ID, `${TOOL_CALL_ID}.txt`));
    expect(existsSync(filePath!)).toBe(true);
    expect(readFileSync(filePath!, 'utf8')).toBe(content);
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBe(content);
  });

  it('不安全 id 直接拒绝（防目录穿越）', () => {
    for (const [sessionId, toolCallId] of [
      ['../escape', TOOL_CALL_ID],
      [SESSION_ID, '../../etc/passwd'],
      [SESSION_ID, 'a/b'],
      ['', TOOL_CALL_ID],
    ] as const) {
      expect(resolveToolOutputSpillPath(sessionId, toolCallId)).toBeNull();
      expect(spillToolOutput({ sessionId, toolCallId, content: 'x' })).toBeNull();
      expect(readSpilledToolOutput(sessionId, toolCallId)).toBeNull();
    }
  });

  it('文件不存在时读回 null（调用方回退数据库输出）', () => {
    expect(readSpilledToolOutput(SESSION_ID, 'call_missing')).toBeNull();
  });

  it('会话删除清理整个会话目录', () => {
    spillToolOutput({ sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID, content: 'x' });
    const otherSession = 'session-cccccccc-3333';
    spillToolOutput({ sessionId: otherSession, toolCallId: TOOL_CALL_ID, content: 'y' });

    deleteSpilledToolOutputsForSession(SESSION_ID);

    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBeNull();
    expect(readSpilledToolOutput(otherSession, TOOL_CALL_ID)).toBe('y');
  });

  it('启动清理只删除过期目录', async () => {
    spillToolOutput({ sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID, content: 'old' });
    const freshSession = 'session-dddddddd-4444';
    spillToolOutput({ sessionId: freshSession, toolCallId: TOOL_CALL_ID, content: 'new' });

    const staleDir = join(dataDir, 'tool-outputs', SESSION_ID);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(staleDir, old, old);

    await pruneStaleSpilledToolOutputs();

    expect(existsSync(staleDir)).toBe(false);
    expect(readSpilledToolOutput(freshSession, TOOL_CALL_ID)).toBe('new');
  });
});

describe('normalizeToolResultOutputForStorage · 超限落盘', () => {
  it('带 spill 上下文时：返回截断结果，同时把全文写入文件', () => {
    const full = 'z'.repeat(200_000 + 5_000);
    const stored = normalizeToolResultOutputForStorage(full, {
      sessionId: SESSION_ID,
      toolCallId: TOOL_CALL_ID,
    });

    expect(typeof stored).toBe('string');
    expect((stored as string).length).toBeLessThan(full.length);
    expect(stored as string).toContain('[工具输出已截断');
    // 落盘的是**全文**，read_tool_output 不再受 200k 持久化上限约束。
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBe(full);
  });

  it('未超限 / 未提供 spill 上下文时不落盘', () => {
    expect(
      normalizeToolResultOutputForStorage('small', {
        sessionId: SESSION_ID,
        toolCallId: TOOL_CALL_ID,
      }),
    ).toBe('small');
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBeNull();

    const full = 'z'.repeat(200_001);
    normalizeToolResultOutputForStorage(full);
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBeNull();
  });
});
