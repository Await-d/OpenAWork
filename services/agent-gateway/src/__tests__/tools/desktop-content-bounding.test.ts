/**
 * desktop_automation `content` 源头裁剪回归:
 *   - 未超限:形状与旧实现一致(`{"content": <html>}`),不落盘;
 *   - 超限:只返回 UTF-8 安全预览 + 落盘,全文可由 `read_tool_output` 取回;
 *   - 落盘不可用时标注 `spillUnavailable`,绝不抛错。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boundDesktopContentOutput,
  DESKTOP_CONTENT_PREVIEW_MAX_BYTES,
} from '../../tools/desktop-content-bounding.js';
import {
  runDesktopAutomationTool,
  type DesktopAutomationManager,
} from '../../tools/desktop-automation.js';
import { readSpilledToolOutput } from '../../tools/tool-output-spill.js';

const SESSION_ID = 'session-desktop-content-1';
const TOOL_CALL_ID = 'call_desktop_content_1';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'openawork-desktop-content-'));
  vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

function createContentManager(html: string): DesktopAutomationManager {
  // 只实现 content;其余动作在本用例中不会被调用。
  return { content: async () => html } as unknown as DesktopAutomationManager;
}

describe('boundDesktopContentOutput', () => {
  it('未超限时保持既有形状且不落盘', () => {
    const html = '<html><body>ready</body></html>';

    const output = boundDesktopContentOutput({
      html,
      sessionId: SESSION_ID,
      toolCallId: TOOL_CALL_ID,
    });

    expect(JSON.parse(output)).toEqual({ content: html });
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBeNull();
  });

  it('超限时返回预览并把完整 HTML 落盘', () => {
    const html = 'x'.repeat(20_000);

    const parsed = JSON.parse(
      boundDesktopContentOutput({ html, sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID }),
    ) as {
      content: string;
      truncated: boolean;
      previewBytes: number;
      totalBytes: number;
      hint: string;
    };

    expect(parsed.truncated).toBe(true);
    expect(parsed.totalBytes).toBe(20_000);
    expect(Buffer.byteLength(parsed.content, 'utf8')).toBeLessThanOrEqual(
      DESKTOP_CONTENT_PREVIEW_MAX_BYTES,
    );
    expect(html.startsWith(parsed.content)).toBe(true);
    expect(parsed.hint).toContain('read_tool_output');
    // 全文(而非预览)被落盘,read_tool_output 可据此取回。
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBe(html);
  });

  it('预览按 UTF-8 边界截断,不产生半个多字节字符', () => {
    const html = '中'.repeat(4_000); // 12,000 字节,截断点必然落在字符中间

    const parsed = JSON.parse(
      boundDesktopContentOutput({ html, sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID }),
    ) as { content: string };

    expect(Buffer.byteLength(parsed.content, 'utf8')).toBeLessThanOrEqual(
      DESKTOP_CONTENT_PREVIEW_MAX_BYTES,
    );
    expect(parsed.content.includes('\uFFFD')).toBe(false);
    expect(html.startsWith(parsed.content)).toBe(true);
  });

  it('落盘不可用(不安全 toolCallId)时标注 spillUnavailable 且不抛错', () => {
    const html = 'x'.repeat(20_000);

    const parsed = JSON.parse(
      boundDesktopContentOutput({ html, sessionId: SESSION_ID, toolCallId: '../../etc/passwd' }),
    ) as { truncated: boolean; spillUnavailable?: boolean; hint: string };

    expect(parsed.truncated).toBe(true);
    expect(parsed.spillUnavailable).toBe(true);
    expect(parsed.hint).toContain('evaluate/find');
  });
});

describe('runDesktopAutomationTool · content 接线', () => {
  it('提供落盘上下文时走源头裁剪', async () => {
    const html = 'y'.repeat(20_000);

    const output = await runDesktopAutomationTool(
      { action: 'content' },
      createContentManager(html),
      { sessionId: SESSION_ID, toolCallId: TOOL_CALL_ID },
    );

    const parsed = JSON.parse(output) as { truncated?: boolean };
    expect(parsed.truncated).toBe(true);
    expect(readSpilledToolOutput(SESSION_ID, TOOL_CALL_ID)).toBe(html);
  });

  it('不提供落盘上下文时保持完整 HTML(不丢数据)', async () => {
    const html = 'z'.repeat(20_000);

    const output = await runDesktopAutomationTool(
      { action: 'content' },
      createContentManager(html),
    );

    expect(JSON.parse(output)).toEqual({ content: html });
  });
});
