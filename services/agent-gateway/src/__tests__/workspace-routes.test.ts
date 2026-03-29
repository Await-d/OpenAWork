import Fastify from 'fastify';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth.js', () => ({ requireAuth: async () => undefined }));
vi.mock('../db.js', () => {
  const root = tmpdir();
  return {
    WORKSPACE_ACCESS_MODE: 'restricted',
    WORKSPACE_ACCESS_RESTRICTED: true,
    WORKSPACE_BROWSER_ROOT: '/',
    WORKSPACE_ROOT: root,
    WORKSPACE_ROOTS: [root, join(root, 'secondary-root')],
  };
});
vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    workflowLogger: { succeed: () => undefined, fail: () => undefined },
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

import { workspaceRoutes } from '../routes/workspace.js';

let app: ReturnType<typeof Fastify>;
let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-workspace-'));
  await mkdir(join(workspaceRoot, 'src'));

  app = Fastify();
  await app.register(workspaceRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('workspaceRoutes', () => {
  it('returns both the default root and all allowed workspace roots', async () => {
    const response = await app.inject({ method: 'GET', url: '/workspace/root' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accessMode: 'restricted',
      root: tmpdir(),
      restricted: true,
      roots: [tmpdir(), join(tmpdir(), 'secondary-root')],
    });
  });

  it('creates a new file without overwriting an existing file', async () => {
    const targetPath = join(workspaceRoot, 'src', 'notes.md');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/workspace/file',
      payload: { path: targetPath, content: '# notes\n' },
    });

    expect(createResponse.statusCode).toBe(200);
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('# notes\n');

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/workspace/file',
      payload: { path: targetPath, content: 'overwrite' },
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(JSON.parse(duplicateResponse.body)).toEqual({ error: 'File already exists' });
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('# notes\n');
  });

  it('creates a new directory and rejects missing parent directories', async () => {
    const targetPath = join(workspaceRoot, 'docs');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/workspace/directory',
      payload: { path: targetPath },
    });

    expect(createResponse.statusCode).toBe(200);
    const directoryStat = await stat(targetPath);
    expect(directoryStat.isDirectory()).toBe(true);

    const missingParentResponse = await app.inject({
      method: 'POST',
      url: '/workspace/directory',
      payload: { path: join(workspaceRoot, 'missing', 'nested') },
    });

    expect(missingParentResponse.statusCode).toBe(404);
    expect(JSON.parse(missingParentResponse.body)).toEqual({ error: 'Parent directory not found' });
  });

  it('rejects paths outside the configured workspace root', async () => {
    const outsidePath = join('/opt', 'openawork-outside.txt');

    const createFileResponse = await app.inject({
      method: 'POST',
      url: '/workspace/file',
      payload: { path: outsidePath, content: 'blocked' },
    });

    expect(createFileResponse.statusCode).toBe(403);
    expect(JSON.parse(createFileResponse.body)).toEqual({ error: 'Forbidden' });

    const createDirectoryResponse = await app.inject({
      method: 'POST',
      url: '/workspace/directory',
      payload: { path: join('/opt', 'openawork-outside-directory') },
    });

    expect(createDirectoryResponse.statusCode).toBe(403);
    expect(JSON.parse(createDirectoryResponse.body)).toEqual({ error: 'Forbidden' });
  });
});
