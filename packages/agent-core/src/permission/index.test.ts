import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionManagerImpl } from './index.js';

describe('PermissionManagerImpl workspace persistence', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-permissions-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('writes permanent approvals into a workspace config file and reloads them on a new manager', async () => {
    const manager = new PermissionManagerImpl();

    const permissionPromise = manager.requestPermission({
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'web_search',
      scope: '/repo',
      reason: '需要访问仓库',
      riskLevel: 'medium',
      workspaceRoot,
    });

    await manager.reply('req-1', 'permanent');
    await permissionPromise;

    const configText = await readFile(join(workspaceRoot, '.openawork.permissions.json'), 'utf-8');
    expect(configText).toContain('web_search');

    const reloaded = new PermissionManagerImpl();
    expect(await reloaded.check('web_search', '/repo', 'session-2', workspaceRoot)).toBe(
      'permanent',
    );
  });

  it('does not persist once or session approvals to the workspace file', async () => {
    const manager = new PermissionManagerImpl();

    const oncePromise = manager.requestPermission({
      requestId: 'req-once',
      sessionId: 'session-1',
      toolName: 'web_search',
      scope: '/repo',
      reason: '需要访问仓库',
      riskLevel: 'medium',
      workspaceRoot,
    });
    await manager.reply('req-once', 'once');
    await oncePromise;

    const sessionPromise = manager.requestPermission({
      requestId: 'req-session',
      sessionId: 'session-1',
      toolName: 'web_search',
      scope: '/repo',
      reason: '需要访问仓库',
      riskLevel: 'medium',
      workspaceRoot,
    });
    await manager.reply('req-session', 'session');
    await sessionPromise;

    expect(await manager.check('web_search', '/repo', 'session-1', workspaceRoot)).toBe('session');

    const reloaded = new PermissionManagerImpl();
    expect(await reloaded.check('web_search', '/repo', 'session-1', workspaceRoot)).toBeNull();
  });
});
