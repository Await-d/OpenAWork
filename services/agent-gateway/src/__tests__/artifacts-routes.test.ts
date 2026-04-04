import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createArtifactMock: vi.fn(),
  getArtifactByIdMock: vi.fn(),
  legacyAddMock: vi.fn(),
  legacyListMock: vi.fn(),
  listArtifactVersionsMock: vi.fn(),
  listArtifactsBySessionMock: vi.fn(),
  revertArtifactToVersionMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  updateArtifactMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
}));

vi.mock('../artifact-content-store.js', () => ({
  createArtifact: mocks.createArtifactMock,
  getArtifactById: mocks.getArtifactByIdMock,
  listArtifactVersions: mocks.listArtifactVersionsMock,
  listArtifactsBySession: mocks.listArtifactsBySessionMock,
  revertArtifactToVersion: mocks.revertArtifactToVersionMock,
  updateArtifact: mocks.updateArtifactMock,
}));

vi.mock('@openAwork/artifacts', () => ({
  ArtifactManagerImpl: class MockArtifactManagerImpl {
    public list(sessionId: string): Promise<unknown[]> {
      return mocks.legacyListMock(sessionId);
    }

    public add(artifact: unknown): unknown {
      return mocks.legacyAddMock(artifact);
    }
  },
}));

import { artifactsRoutes } from '../routes/artifacts.js';

describe('artifacts routes', () => {
  beforeEach(() => {
    mocks.createArtifactMock.mockReset();
    mocks.getArtifactByIdMock.mockReset();
    mocks.legacyAddMock.mockReset();
    mocks.legacyListMock.mockReset();
    mocks.listArtifactVersionsMock.mockReset();
    mocks.listArtifactsBySessionMock.mockReset();
    mocks.revertArtifactToVersionMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.updateArtifactMock.mockReset();
    mocks.sqliteGetMock.mockReturnValue({ id: 'session-1' });
    mocks.legacyListMock.mockResolvedValue([]);
  });

  it('creates and lists content artifacts alongside legacy attachments', async () => {
    mocks.createArtifactMock.mockReturnValue({
      id: 'artifact-1',
      sessionId: 'session-1',
      userId: 'user-a',
      type: 'html',
      title: 'landing-page.html',
      content: '<html></html>',
      version: 1,
      parentVersionId: null,
      metadata: { mimeType: 'text/html' },
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:00:00.000Z',
    });
    mocks.listArtifactsBySessionMock.mockReturnValue([
      {
        id: 'artifact-1',
        sessionId: 'session-1',
        userId: 'user-a',
        type: 'html',
        title: 'landing-page.html',
        content: '<html></html>',
        version: 1,
        parentVersionId: null,
        metadata: {},
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ]);

    const app = Fastify();
    await app.register(artifactsRoutes);
    await app.ready();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/artifacts',
      payload: {
        sessionId: 'session-1',
        title: 'landing-page.html',
        content: '<!doctype html><html><body>Hello</body></html>',
        mimeType: 'text/html',
        createdBy: 'agent',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(mocks.createArtifactMock).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        sessionId: 'session-1',
        title: 'landing-page.html',
        createdBy: 'agent',
      }),
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: '/sessions/session-1/artifacts',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body)).toMatchObject({
      artifacts: [],
      contentArtifacts: [expect.objectContaining({ id: 'artifact-1' })],
    });

    await app.close();
  });

  it('updates artifacts, returns versions, and reverts through the store', async () => {
    mocks.getArtifactByIdMock.mockReturnValue({ id: 'artifact-1', content: '# Start', version: 1 });
    mocks.updateArtifactMock.mockReturnValue({
      id: 'artifact-1',
      content: '# Start\n\n- next',
      version: 2,
    });
    mocks.listArtifactVersionsMock.mockReturnValue([
      { id: 'version-2', versionNumber: 2 },
      { id: 'version-1', versionNumber: 1 },
    ]);
    mocks.revertArtifactToVersionMock.mockReturnValue({
      id: 'artifact-1',
      content: '# Start',
      version: 3,
    });

    const app = Fastify();
    await app.register(artifactsRoutes);
    await app.ready();

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/artifacts/artifact-1',
      payload: { content: '# Start\n\n- next', createdBy: 'user' },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(mocks.updateArtifactMock).toHaveBeenCalledWith(
      'user-a',
      'artifact-1',
      expect.objectContaining({ content: '# Start\n\n- next', createdBy: 'user' }),
    );

    const versionsResponse = await app.inject({
      method: 'GET',
      url: '/artifacts/artifact-1/versions',
    });
    expect(versionsResponse.statusCode).toBe(200);
    expect(
      (JSON.parse(versionsResponse.body) as { versions: Array<{ id: string }> }).versions,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'version-2' })]));

    const revertResponse = await app.inject({
      method: 'POST',
      url: '/artifacts/artifact-1/revert',
      payload: { versionId: 'version-1' },
    });
    expect(revertResponse.statusCode).toBe(200);
    expect(mocks.revertArtifactToVersionMock).toHaveBeenCalledWith('user-a', 'artifact-1', {
      versionId: 'version-1',
      createdBy: 'user',
      createdByNote: null,
    });

    await app.close();
  });

  it('returns 404 for missing session or artifact ownership', async () => {
    mocks.sqliteGetMock.mockReturnValue(undefined);
    mocks.getArtifactByIdMock.mockReturnValue(undefined);
    mocks.updateArtifactMock.mockReturnValue(undefined);
    mocks.revertArtifactToVersionMock.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(artifactsRoutes);
    await app.ready();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/artifacts',
      payload: { sessionId: 'missing-session', title: 'oops', content: '' },
    });
    expect(createResponse.statusCode).toBe(404);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/sessions/missing-session/artifacts',
    });
    expect(listResponse.statusCode).toBe(404);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/artifacts/missing-artifact',
    });
    expect(getResponse.statusCode).toBe(404);

    await app.close();
  });
});
