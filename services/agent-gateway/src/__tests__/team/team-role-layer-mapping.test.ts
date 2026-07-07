import { describe, expect, it } from 'vitest';
import { mapAgentToTeamRoleLayer } from '../../team/team-role-layer-mapping.js';

describe('mapAgentToTeamRoleLayer', () => {
  it.each([
    ['explore', 'pm2'],
    ['explorer', 'pm2'],
    ['librarian', 'pm2'],
    ['prometheus', 'pm1'],
    ['plan', 'pm1'],
    ['hephaestus', 'executor'],
    ['qa-executor', 'executor'],
    ['sisyphus-junior', 'executor'],
    ['momus', 'reviewer'],
    ['atlas', 'reviewer'],
    ['lazycodex-gate-reviewer', 'reviewer'],
  ] as const)('把 %s 映射到 %s 层', (agentId, expectedLayer) => {
    expect(mapAgentToTeamRoleLayer(agentId)).toBe(expectedLayer);
  });

  it('未知 agent 不猜测 role layer', () => {
    expect(mapAgentToTeamRoleLayer('unknown-lazycodex-role')).toBeNull();
  });
});
