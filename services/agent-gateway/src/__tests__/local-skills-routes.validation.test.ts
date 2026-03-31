import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('../local-skills.js', () => ({
  discoverLocalSkills: vi.fn(),
  installLocalSkillFromDir: vi.fn(),
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: {
      succeed: vi.fn(),
      fail: vi.fn(),
    },
  }),
}));

import { extractLocalInstallDirPath } from '../routes/local-skills.js';

describe('local-skills route validation', () => {
  it('extracts trimmed dirPath from valid request bodies', () => {
    expect(extractLocalInstallDirPath({ dirPath: '  /tmp/skill  ' })).toBe('/tmp/skill');
  });

  it('rejects missing or invalid request bodies', () => {
    expect(extractLocalInstallDirPath(undefined)).toBeNull();
    expect(extractLocalInstallDirPath(null)).toBeNull();
    expect(extractLocalInstallDirPath({})).toBeNull();
    expect(extractLocalInstallDirPath({ dirPath: '' })).toBeNull();
    expect(extractLocalInstallDirPath({ dirPath: 123 })).toBeNull();
    expect(extractLocalInstallDirPath([])).toBeNull();
  });
});
