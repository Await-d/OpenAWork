import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionsClient, HttpError } from '../sessions.js';

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sessions client change tracking APIs', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests session file changes with includeText query support', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        fileChanges: {
          fileDiffs: [
            {
              file: 'src/app.ts',
              before: 'old',
              after: 'new',
              additions: 1,
              deletions: 1,
              status: 'modified',
            },
          ],
          snapshots: [],
          summary: {
            snapshotCount: 0,
            sourceKinds: ['structured_tool_diff'],
            totalAdditions: 1,
            totalDeletions: 1,
            totalFileDiffs: 1,
            weakestGuaranteeLevel: 'strong',
          },
        },
      }),
    );

    const client = createSessionsClient('http://gateway.test');
    const result = await client.getFileChanges('token-1', 'session-1', { includeText: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/sessions/session-1/file-changes?includeText=1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(result.fileDiffs[0]?.before).toBe('old');
    expect(result.summary.totalFileDiffs).toBe(1);
  });

  it('requests snapshot comparison with encoded query params', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        comparison: [
          {
            file: 'src/app.ts',
            changed: true,
            fromExists: true,
            toExists: true,
            fromStatus: 'modified',
            toStatus: 'modified',
            before: 'old',
            after: 'new',
          },
        ],
        from: {
          snapshotRef: 'req:req-1',
          scopeKind: 'request',
          createdAt: '2026-04-03T00:00:00.000Z',
          summary: { files: 1, additions: 1, deletions: 1 },
        },
        to: {
          snapshotRef: 'req:req-2',
          scopeKind: 'request',
          createdAt: '2026-04-03T00:01:00.000Z',
          summary: { files: 1, additions: 2, deletions: 1 },
        },
      }),
    );

    const client = createSessionsClient('http://gateway.test');
    const result = await client.compareSnapshots('token-2', 'session-2', {
      from: 'req:req-1',
      to: 'req:req-2',
      includeText: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/sessions/session-2/snapshots/compare?from=req%3Areq-1&to=req%3Areq-2&includeText=1',
    );
    expect(result.comparison[0]?.after).toBe('new');
    expect(result.to.snapshotRef).toBe('req:req-2');
  });

  it('preserves structured restore apply errors in HttpError.data', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(409, {
        error: 'Restore apply blocked by current workspace state',
        validateOnly: true,
        mode: 'backup',
      }),
    );

    const client = createSessionsClient('http://gateway.test');

    let thrown: HttpError | undefined;
    try {
      await client.applyRestore('token-3', 'session-3', {
        backupId: 'backup-1',
        forceConflicts: false,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        thrown = error;
      } else {
        throw error;
      }
    }

    expect(thrown).toBeInstanceOf(HttpError);
    expect(thrown?.status).toBe(409);
    expect(thrown?.data).toEqual({
      error: 'Restore apply blocked by current workspace state',
      mode: 'backup',
      validateOnly: true,
    });
  });
});
