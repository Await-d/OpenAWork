import Fastify from 'fastify';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth.js', () => ({ requireAuth: async () => undefined }));
vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'unrestricted',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-configured-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-configured-root'],
}));
vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    workflowLogger: { succeed: () => undefined, fail: () => undefined },
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

import { workspaceRoutes } from '../routes/workspace.js';

let app: ReturnType<typeof Fastify>;
let unrestrictedRoot: string;

beforeEach(async () => {
  unrestrictedRoot = await mkdtemp(join(tmpdir(), 'openawork-unrestricted-'));
  await mkdir(join(unrestrictedRoot, 'src'));

  app = Fastify();
  await app.register(workspaceRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(unrestrictedRoot, { recursive: true, force: true });
});

describe('workspaceRoutes in unrestricted mode', () => {
  it('reports unrestricted access mode from the filesystem root', async () => {
    const response = await app.inject({ method: 'GET', url: '/workspace/root' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accessMode: 'unrestricted',
      restricted: false,
      root: '/',
      roots: ['/'],
    });
  });

  it('allows reading and creating files outside configured roots without 403', async () => {
    const targetPath = join(unrestrictedRoot, 'src', 'notes.md');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/workspace/file',
      payload: { path: targetPath, content: '# notes\n' },
    });

    expect(createResponse.statusCode).toBe(200);
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('# notes\n');

    const validateResponse = await app.inject({
      method: 'GET',
      url: `/workspace/validate?path=${encodeURIComponent(unrestrictedRoot)}`,
    });

    expect(validateResponse.statusCode).toBe(200);
    expect(JSON.parse(validateResponse.body)).toEqual({ valid: true, path: unrestrictedRoot });
  });
});
