import { describe, expect, it } from 'vitest';
import {
  deriveTeamInitPhase,
  isTeamInitFinished,
  type TeamInitState,
  type TeamInitStep,
} from './team-init.js';

function step(overrides: Partial<TeamInitStep>): TeamInitStep {
  return {
    key: 'read-project-level1',
    title: 't',
    description: 'd',
    status: 'proposed',
    requiresConfirm: true,
    usesLlm: false,
    ...overrides,
  };
}

describe('deriveTeamInitPhase', () => {
  it('全部 not_applicable 视为 completed', () => {
    expect(
      deriveTeamInitPhase([
        step({ key: 'understand-architecture', status: 'not_applicable' }),
        step({ key: 'scaffold-memory', status: 'not_applicable' }),
      ]),
    ).toBe('completed');
  });

  it('有 proposed 且无任何已开始步骤 → proposed', () => {
    expect(
      deriveTeamInitPhase([
        step({ key: 'scan-shared-record', status: 'proposed' }),
        step({ key: 'read-project-level1', status: 'proposed' }),
      ]),
    ).toBe('proposed');
  });

  it('部分 done 部分 proposed → in_progress', () => {
    expect(
      deriveTeamInitPhase([
        step({ key: 'scan-shared-record', status: 'done' }),
        step({ key: 'read-project-level1', status: 'proposed' }),
      ]),
    ).toBe('in_progress');
  });

  it('所有适用步骤 done/skipped → completed', () => {
    expect(
      deriveTeamInitPhase([
        step({ key: 'scan-shared-record', status: 'done' }),
        step({ key: 'read-project-level1', status: 'skipped' }),
        step({ key: 'understand-architecture', status: 'not_applicable' }),
      ]),
    ).toBe('completed');
  });
});

describe('isTeamInitFinished', () => {
  const base: TeamInitState = {
    version: 1,
    phase: 'proposed',
    projectKind: 'existing',
    steps: [],
    bindings: { perLayer: {} },
  };
  it('completed / skipped 视为结束', () => {
    expect(isTeamInitFinished({ ...base, phase: 'completed' })).toBe(true);
    expect(isTeamInitFinished({ ...base, phase: 'skipped' })).toBe(true);
  });
  it('proposed / in_progress / null 视为未结束', () => {
    expect(isTeamInitFinished({ ...base, phase: 'proposed' })).toBe(false);
    expect(isTeamInitFinished({ ...base, phase: 'in_progress' })).toBe(false);
    expect(isTeamInitFinished(null)).toBe(false);
  });
});
