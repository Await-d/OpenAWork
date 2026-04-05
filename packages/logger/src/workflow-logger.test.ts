import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from './types.js';
import { WorkflowLogger } from './workflow-logger.js';

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

describe('WorkflowLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the final workflow branch as terminal even when ip and user agent follow', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new WorkflowLogger();
    const context: RequestContext = {
      requestId: 'req-1',
      method: 'GET',
      path: '/health',
      ip: '127.0.0.1',
      userAgent: 'vitest',
      startTime: Date.now(),
    };

    const requestStep = logger.start('request.handle');
    const authStep = logger.startChild(requestStep, 'auth.verify');

    vi.advanceTimersByTime(5);
    logger.succeed(authStep);
    vi.advanceTimersByTime(20);
    logger.succeed(requestStep);

    logger.flush(context, 200);

    const output = stripAnsi(String(logSpy.mock.calls[0]?.[0] ?? ''));
    expect(output).toContain('🟢 200 GET /health 25ms');
    expect(output).toContain('│   └── [成功] request.handle (25ms)');
    expect(output).toContain('│       └── [成功] auth.verify (5ms)');
    expect(output).toContain('├── ip: 127.0.0.1');
    expect(output).toContain('└── ua: vitest');
  });

  it('treats 1xx and 3xx responses as non-error request headers', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cases = [
      { statusCode: 101, expectedEmoji: '🟢' },
      { statusCode: 302, expectedEmoji: '🟢' },
      { statusCode: 404, expectedEmoji: '🟡' },
      { statusCode: 500, expectedEmoji: '🔴' },
    ];

    for (const testCase of cases) {
      const logger = new WorkflowLogger();
      const context: RequestContext = {
        requestId: `req-${testCase.statusCode}`,
        method: 'GET',
        path: `/${testCase.statusCode}`,
        startTime: Date.now(),
      };
      logger.flush(context, testCase.statusCode);
      vi.advanceTimersByTime(1);
    }

    const outputs = logSpy.mock.calls.map((call) => stripAnsi(String(call[0] ?? '')));
    expect(outputs[0]).toContain('🟢 101 GET /101');
    expect(outputs[1]).toContain('🟢 302 GET /302');
    expect(outputs[2]).toContain('🟡 404 GET /404');
    expect(outputs[3]).toContain('🔴 500 GET /500');
  });
});
