import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

import { settingsRoutes } from '../routes/settings.js';

describe('settings audit routes', () => {
  beforeEach(() => {
    sqliteAllMock.mockReset();
    sqliteGetMock.mockReset();
    sqliteRunMock.mockReset();
  });

  it('returns sanitized dev logs scoped to the current user', async () => {
    sqliteAllMock.mockImplementation((query: string, params: unknown[]) => {
      expect(query).toContain('INNER JOIN sessions ON sessions.id = audit_logs.session_id');
      expect(query).toContain('WHERE sessions.user_id = ?');
      expect(query).toContain('SELECT audit_logs.id');
      expect(query).toContain('ORDER BY audit_logs.created_at DESC');
      expect(params).toEqual(['user-a']);

      return [
        {
          id: 1,
          session_id: 'session-a',
          tool_name: 'web_search',
          request_id: 'req-a',
          input_json: JSON.stringify({
            apiKey: 'secret-a',
            nested: { token: 'token-a', keep: 'visible' },
          }),
          output_json: JSON.stringify({
            message: 'Tool failed for current user',
            secret: 'hide-me',
            long: 'x'.repeat(1205),
          }),
          is_error: 1,
          duration_ms: 42,
          created_at: '2026-03-26T12:00:00.000Z',
        },
      ];
    });

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/settings/dev-logs' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as {
      logs: Array<{
        toolName: string;
        requestId: string;
        input: { apiKey?: string; nested?: { token?: string; keep?: string } };
        output: { secret?: string; long?: string };
      }>;
    };

    expect(payload.logs).toHaveLength(1);
    expect(payload.logs[0]).toMatchObject({
      toolName: 'web_search',
      requestId: 'req-a',
      input: {
        apiKey: '[REDACTED]',
        nested: { token: '[REDACTED]', keep: 'visible' },
      },
      output: { secret: '[REDACTED]' },
    });
    expect(payload.logs[0]?.output.long?.endsWith('…[truncated]')).toBe(true);

    await app.close();
  });

  it('returns sanitized diagnostics scoped to the current user', async () => {
    sqliteAllMock.mockImplementation((query: string, params: unknown[]) => {
      if (query.includes('SELECT DISTINCT date(audit_logs.created_at) AS date')) {
        expect(params).toEqual(['user-a']);
        return [{ date: '2026-03-26' }];
      }

      expect(query).toContain('INNER JOIN sessions ON sessions.id = audit_logs.session_id');
      expect(query).toContain('SELECT audit_logs.id');
      expect(query).toContain('WHERE sessions.user_id = ? AND audit_logs.is_error = 1');
      expect(query).toContain('ORDER BY audit_logs.created_at DESC');
      expect(params).toEqual(['user-a']);

      return [
        {
          id: 7,
          session_id: 'session-a',
          tool_name: 'bash',
          request_id: 'req-diag',
          input_json: JSON.stringify({ password: 'secret-password' }),
          output_json: JSON.stringify({ message: 'Bash failed', cookie: 'sensitive-cookie' }),
          is_error: 1,
          duration_ms: 21,
          created_at: '2026-03-26T12:01:00.000Z',
        },
      ];
    });

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/settings/diagnostics' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as {
      diagnostics: Array<{
        toolName: string;
        requestId: string;
        message: string;
        input: { password?: string };
        output: { cookie?: string };
      }>;
    };

    expect(payload.diagnostics).toEqual([
      expect.objectContaining({
        toolName: 'bash',
        requestId: 'req-diag',
        message: 'Bash failed',
        input: expect.objectContaining({ password: '[REDACTED]' }),
        output: expect.objectContaining({ cookie: '[REDACTED]' }),
      }),
    ]);

    await app.close();
  });
});
