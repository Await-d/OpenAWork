import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTeamClient } from '../team.js';

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('team client runtime APIs', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the aggregated team runtime read model', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        auditLogs: [],
        members: [],
        messages: [],
        sessionShares: [],
        sessions: [],
        sharedSessions: [],
        tasks: [],
      }),
    );

    const client = createTeamClient('http://gateway.test');
    const result = await client.getRuntime('token-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/team/runtime');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(result).toEqual({
      auditLogs: [],
      members: [],
      messages: [],
      sessionShares: [],
      sessions: [],
      sharedSessions: [],
      tasks: [],
    });
  });

  it('throws on team runtime load failure', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(500, { error: 'runtime failed' }));

    const client = createTeamClient('http://gateway.test');

    await expect(client.getRuntime('token-2')).rejects.toThrow('Failed to load team runtime: 500');
  });
});
