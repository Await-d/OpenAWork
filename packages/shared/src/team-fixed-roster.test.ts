import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  TEAM_RUNTIME_LAYER_ORDER,
  type TeamMemberSpecialty,
} from './index.js';

describe('DEFAULT_FIXED_TEAM_MEMBER_SLOTS', () => {
  it('覆盖所有运行层并包含运维/部署相关专长', () => {
    const layers = new Set(DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.layer));
    for (const layer of TEAM_RUNTIME_LAYER_ORDER) {
      expect(layers.has(layer)).toBe(true);
    }

    const specialties = new Set<TeamMemberSpecialty>(
      DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
    );
    expect(specialties.has('devops')).toBe(true);
    expect(specialties.has('platform')).toBe(true);
    expect(specialties.has('release')).toBe(true);
    expect(specialties.has('security')).toBe(true);
    expect(specialties.has('sre')).toBe(true);
    expect(specialties.has('observability')).toBe(true);
  });

  it('不会把专长建成新的 roleLayer', () => {
    const layerValues = new Set<string>(TEAM_RUNTIME_LAYER_ORDER);
    for (const slot of DEFAULT_FIXED_TEAM_MEMBER_SLOTS) {
      expect(layerValues.has(slot.layer)).toBe(true);
      expect(slot.personaKey).toContain(`${slot.layer}:`);
    }
  });
});
