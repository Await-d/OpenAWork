import { describe, expect, it } from 'vitest';
import { detectTerminalDevServer } from './detect-terminal-dev-server.js';

describe('detectTerminalDevServer', () => {
  it('非 dev-server 启动命令会标记 handled', () => {
    const result = detectTerminalDevServer({
      detectedTerminalIds: new Set(),
      event: { type: 'terminal_started', terminalId: 't1', command: 'ls -la' },
    });

    expect(result.shouldMarkTerminalHandled).toBe(true);
    expect(result.detectedUrl).toBeUndefined();
  });

  it('terminal output 命中地址时返回 detectedUrl', () => {
    const result = detectTerminalDevServer({
      detectedTerminalIds: new Set(),
      event: {
        type: 'terminal_output',
        terminalId: 't1',
        outputTail: 'Local: http://localhost:5173/',
      },
    });

    expect(result.shouldMarkTerminalHandled).toBe(true);
    expect(result.detectedUrl).toBe('http://localhost:5173/');
  });
});
