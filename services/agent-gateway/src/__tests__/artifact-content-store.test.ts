import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbExecMock: vi.fn(),
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  db: { exec: mocks.dbExecMock },
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  createArtifact,
  getArtifactById,
  listArtifactVersions,
  revertArtifactToVersion,
  updateArtifact,
} from '../artifact-content-store.js';

describe('artifact content store', () => {
  beforeEach(() => {
    mocks.dbExecMock.mockReset();
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
  });

  it('creates artifacts with detected types and initial version records', () => {
    const artifact = createArtifact('user-1', {
      sessionId: 'session-1',
      title: 'landing-page.html',
      content: '<!doctype html><html><body>Hello</body></html>',
      mimeType: 'text/html',
      createdBy: 'agent',
    });

    expect(artifact).toMatchObject({
      sessionId: 'session-1',
      userId: 'user-1',
      type: 'html',
      title: 'landing-page.html',
      version: 1,
      parentVersionId: null,
      metadata: { mimeType: 'text/html' },
    });
    expect(mocks.dbExecMock.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
    expect(mocks.sqliteRunMock.mock.calls[0]?.[0]).toContain('INSERT INTO artifacts');
    expect(mocks.sqliteRunMock.mock.calls[1]?.[0]).toContain('INSERT INTO artifact_versions');
  });

  it('maps artifact rows back into records', () => {
    mocks.sqliteGetMock.mockReturnValue({
      id: 'artifact-1',
      session_id: 'session-1',
      user_id: 'user-1',
      type: 'markdown',
      title: 'notes.md',
      content: '# Heading',
      version: 2,
      parent_version_id: 'version-1',
      metadata_json: JSON.stringify({ source: 'stream' }),
      created_at: '2026-04-04T00:00:00.000Z',
      updated_at: '2026-04-04T00:01:00.000Z',
    });

    expect(getArtifactById('user-1', 'artifact-1')).toEqual({
      id: 'artifact-1',
      sessionId: 'session-1',
      userId: 'user-1',
      type: 'markdown',
      title: 'notes.md',
      content: '# Heading',
      version: 2,
      parentVersionId: 'version-1',
      metadata: { source: 'stream' },
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:01:00.000Z',
    });
  });

  it('updates artifacts by appending a new version row with computed diff', () => {
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM artifacts')) {
        return {
          id: 'artifact-1',
          session_id: 'session-1',
          user_id: 'user-1',
          type: 'markdown',
          title: 'notes.md',
          content: '# Title',
          version: 1,
          parent_version_id: null,
          metadata_json: '{}',
          created_at: '2026-04-04T00:00:00.000Z',
          updated_at: '2026-04-04T00:00:00.000Z',
        };
      }
      return {
        id: 'version-1',
        artifact_id: 'artifact-1',
        version_number: 1,
        content: '# Title',
        diff_json: '[]',
        created_by: 'agent',
        created_by_note: null,
        created_at: '2026-04-04T00:00:00.000Z',
      };
    });

    const updated = updateArtifact('user-1', 'artifact-1', {
      content: '# Title\n\n- two',
      createdBy: 'user',
      createdByNote: 'expanded list',
    });

    expect(updated).toMatchObject({
      id: 'artifact-1',
      version: 2,
      parentVersionId: 'version-1',
      type: 'markdown',
    });
    expect(mocks.dbExecMock.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
    const versionInsertParams = mocks.sqliteRunMock.mock.calls[1]?.[1] as unknown[];
    expect(versionInsertParams[2]).toBe(2);
    expect(versionInsertParams[5]).toBe('user');
    expect(versionInsertParams[6]).toBe('expanded list');
    expect(JSON.parse(String(versionInsertParams[4]))).toContainEqual({
      lineNumber: 3,
      kind: 'added',
      after: '- two',
    });
  });

  it('lists and reverts versions through append-only history', () => {
    mocks.sqliteGetMock.mockImplementation((query: string, params?: unknown[]) => {
      if (query.includes('FROM artifacts')) {
        return {
          id: 'artifact-1',
          session_id: 'session-1',
          user_id: 'user-1',
          type: 'code',
          title: 'widget.ts',
          content: 'export const count = 2;',
          version: 2,
          parent_version_id: 'version-1',
          metadata_json: '{}',
          created_at: '2026-04-04T00:00:00.000Z',
          updated_at: '2026-04-04T00:02:00.000Z',
        };
      }
      if (query.includes('INNER JOIN artifacts')) {
        return {
          id: String(params?.[0]),
          artifact_id: 'artifact-1',
          version_number: 1,
          content: 'export const count = 1;',
          diff_json: JSON.stringify([
            { lineNumber: 1, kind: 'added', after: 'export const count = 1;' },
          ]),
          created_by: 'agent',
          created_by_note: null,
          created_at: '2026-04-04T00:00:00.000Z',
        };
      }
      return {
        id: 'version-2',
        artifact_id: 'artifact-1',
        version_number: 2,
        content: 'export const count = 2;',
        diff_json: JSON.stringify([
          {
            lineNumber: 1,
            kind: 'modified',
            before: 'export const count = 1;',
            after: 'export const count = 2;',
          },
        ]),
        created_by: 'user',
        created_by_note: null,
        created_at: '2026-04-04T00:02:00.000Z',
      };
    });
    mocks.sqliteAllMock.mockReturnValue([
      {
        id: 'version-2',
        artifact_id: 'artifact-1',
        version_number: 2,
        content: 'export const count = 2;',
        diff_json: JSON.stringify([
          {
            lineNumber: 1,
            kind: 'modified',
            before: 'export const count = 1;',
            after: 'export const count = 2;',
          },
        ]),
        created_by: 'user',
        created_by_note: null,
        created_at: '2026-04-04T00:02:00.000Z',
      },
      {
        id: 'version-1',
        artifact_id: 'artifact-1',
        version_number: 1,
        content: 'export const count = 1;',
        diff_json: JSON.stringify([
          { lineNumber: 1, kind: 'added', after: 'export const count = 1;' },
        ]),
        created_by: 'agent',
        created_by_note: null,
        created_at: '2026-04-04T00:00:00.000Z',
      },
    ]);

    expect(listArtifactVersions('user-1', 'artifact-1')).toEqual([
      expect.objectContaining({ versionNumber: 2 }),
      expect.objectContaining({ versionNumber: 1 }),
    ]);

    const reverted = revertArtifactToVersion('user-1', 'artifact-1', {
      versionId: 'version-1',
      createdBy: 'user',
      createdByNote: 'restore initial draft',
    });
    expect(reverted).toMatchObject({
      version: 3,
      content: 'export const count = 1;',
      parentVersionId: 'version-2',
    });
    const revertInsertParams = mocks.sqliteRunMock.mock.calls[1]?.[1] as unknown[];
    expect(revertInsertParams[2]).toBe(3);
    expect(revertInsertParams[6]).toBe('restore initial draft');
  });
});
