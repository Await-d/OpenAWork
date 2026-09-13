import { describe, expect, it } from 'vitest';
import { UNBOUND_WORKSPACE_LABEL } from '../../../utils/session/session-grouping.js';
import { buildHomeProjects, getWorkspaceName } from './session-grouping.js';
import type { HomeSessionLike } from './session-grouping.js';

function makeSession(
  id: string,
  workingDirectory: string | null,
  stateStatus: 'idle' | 'running' = 'idle',
): HomeSessionLike {
  return {
    id,
    metadata_json: JSON.stringify({ workingDirectory }),
    state_status: stateStatus,
    title: id,
    updated_at: '2026-09-13T00:00:00.000Z',
  };
}

describe('getWorkspaceName', () => {
  it('无工作区时返回统一的未指定工作区描述', () => {
    expect(getWorkspaceName(null)).toBe(UNBOUND_WORKSPACE_LABEL);
  });

  it('有工作区时取路径末段', () => {
    expect(getWorkspaceName('/repo/alpha')).toBe('alpha');
  });
});

describe('buildHomeProjects', () => {
  it('未指定工作区的项目永远排在已绑定工作区的项目之后', () => {
    const projects = buildHomeProjects([
      makeSession('unbound-running', null, 'running'),
      makeSession('unbound-idle', null),
      makeSession('bound-alpha', '/repo/alpha'),
    ]);

    expect(projects.map((project) => project.path)).toEqual(['/repo/alpha', null]);
    expect(projects[1]?.label).toBe(UNBOUND_WORKSPACE_LABEL);
    expect(projects[1]?.sessionCount).toBe(2);
  });
});
