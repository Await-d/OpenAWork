import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentCoreModule from '@openAwork/agent-core';

const mocks = vi.hoisted(() => ({
  root: `/tmp/workspace-safety-${Math.random().toString(36).slice(2)}`,
  sqliteGetMock: vi.fn(),
  loadRulesMock: vi.fn(async () => ({
    builtinPatterns: [],
    gitignorePatterns: [],
    agentignorePatterns: [],
    userGlobalPatterns: [],
  })),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: mocks.root,
  WORKSPACE_ROOTS: [mocks.root],
  sqliteGet: mocks.sqliteGetMock,
}));

vi.mock('@openAwork/agent-core', async () => {
  const actual = await vi.importActual<typeof AgentCoreModule>('@openAwork/agent-core');
  return {
    ...actual,
    defaultIgnoreManager: {
      ...actual.defaultIgnoreManager,
      loadRules: mocks.loadRulesMock,
    },
  };
});

import {
  ensureIgnoreRulesLoadedForPath,
  hasWorkspacePermanentPermission,
  persistWorkspacePermanentPermission,
} from '../workspace-safety.js';

describe('workspace-safety', () => {
  beforeEach(() => {
    mocks.sqliteGetMock.mockReset();
    mocks.loadRulesMock.mockClear();
  });

  it('loads ignore rules for the matching workspace root', async () => {
    await ensureIgnoreRulesLoadedForPath(join(mocks.root, 'apps', 'web'));
    expect(mocks.loadRulesMock).toHaveBeenCalledWith(mocks.root);
  });

  it('persists and re-reads permanent workspace permissions', () => {
    mkdirSync(mocks.root, { recursive: true });
    mocks.sqliteGetMock.mockReturnValue({
      metadata_json: JSON.stringify({ workingDirectory: mocks.root }),
    });

    persistWorkspacePermanentPermission({
      sessionId: 'session-a',
      toolName: 'bash',
      scope: mocks.root,
    });
    const file = JSON.parse(
      readFileSync(join(mocks.root, '.openawork.permissions.json'), 'utf8'),
    ) as {
      permanentGrants: Array<{ toolName: string; scope: string }>;
    };
    expect(file.permanentGrants[0]).toMatchObject({ toolName: 'bash', scope: mocks.root });
    expect(hasWorkspacePermanentPermission('session-a', 'bash', mocks.root)).toBe(true);
  });
});
