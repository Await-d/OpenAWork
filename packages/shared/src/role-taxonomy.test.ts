import { describe, expect, it } from 'vitest';
import { REFERENCE_AGENT_ROLE_METADATA, ROLE_PRESET_PACKS, formatCanonicalRole } from './index.js';

describe('role taxonomy', () => {
  it('given a shared default preset, when checking supported roles, then it covers general planner and executor', () => {
    expect(ROLE_PRESET_PACKS.default.supportedCoreRoles).toEqual(
      expect.arrayContaining(['general', 'planner', 'executor']),
    );
  });

  it('given oracle reference metadata, when formatting canonical role, then it returns planner/architect', () => {
    const oracle = REFERENCE_AGENT_ROLE_METADATA['oracle'];

    expect(oracle).toBeDefined();
    expect(formatCanonicalRole(oracle!.canonicalRole)).toBe('planner/architect');
  });
});
