import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockSessionRow {
  id: string;
  metadata_json: string;
  state_status: string;
}

let sessionRows: MockSessionRow[] = [];

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/tmp/openawork-guardrails',
  WORKSPACE_ROOTS: ['/tmp/openawork-guardrails'],
  sqliteAll: () => sessionRows,
  sqliteGet: () => undefined,
  sqliteRun: () => undefined,
}));

import { getTaskSessionLimitError } from '../tool-sandbox.js';
import { createTaskRuntimeGuardContext, recordTaskToolCallOrThrow } from '../routes/stream.js';

describe('task tool guardrails', () => {
  beforeEach(() => {
    sessionRows = [];
  });

  it('blocks spawning a new child session when the task depth limit is exceeded', () => {
    sessionRows = [
      { id: 'root', metadata_json: '{}', state_status: 'idle' },
      {
        id: 'child-1',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'root' }),
        state_status: 'idle',
      },
      {
        id: 'child-2',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'child-1' }),
        state_status: 'idle',
      },
      {
        id: 'child-3',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'child-2' }),
        state_status: 'idle',
      },
      {
        id: 'child-4',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'child-3' }),
        state_status: 'idle',
      },
    ];

    expect(
      getTaskSessionLimitError({
        currentSessionId: 'child-4',
        isNewChildSession: true,
        userId: 'user-1',
      }),
    ).toContain('子代理嵌套深度已达到上限');
  });

  it('blocks spawning when too many child sessions are already running under the same root', () => {
    sessionRows = [
      { id: 'root', metadata_json: '{}', state_status: 'idle' },
      {
        id: 'child-1',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'root' }),
        state_status: 'running',
      },
      {
        id: 'child-2',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'root' }),
        state_status: 'running',
      },
      {
        id: 'child-3',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'root' }),
        state_status: 'running',
      },
      {
        id: 'child-4',
        metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'root' }),
        state_status: 'running',
      },
    ];

    expect(
      getTaskSessionLimitError({
        currentSessionId: 'root',
        isNewChildSession: true,
        userId: 'user-1',
      }),
    ).toContain('正在运行的子代理已达到上限');
  });

  it('does not cap total tool calls for task-created sessions', () => {
    const guard = createTaskRuntimeGuardContext(JSON.stringify({ createdByTool: 'task' }));
    expect(guard).not.toBeNull();
    if (!guard) {
      throw new Error('expected task runtime guard context');
    }

    for (let index = 0; index < 40; index += 1) {
      recordTaskToolCallOrThrow(guard, `tool-${index}`, '{}');
    }
  });

  it('detects consecutive repetitive tool loops for task-created sessions', () => {
    const guard = createTaskRuntimeGuardContext(JSON.stringify({ createdByTool: 'task' }));
    expect(guard).not.toBeNull();
    if (!guard) {
      throw new Error('expected task runtime guard context');
    }

    for (let index = 0; index < 4; index += 1) {
      recordTaskToolCallOrThrow(guard, 'read', '{"file":"README.md"}');
    }

    expect(() => recordTaskToolCallOrThrow(guard, 'read', '{"file":"README.md"}')).toThrow(
      '子代理连续重复调用同一工具已达到上限',
    );
  });
});
