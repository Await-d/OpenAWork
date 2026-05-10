/**
 * Pure unit coverage for the AI-recommend diff helpers used by
 * `SkillRecommendationDrawer.tsx`. Exercised here in node mode so we don't need
 * a DOM environment to verify the diff/summary semantics that drive the UX.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSkillRecommendationDecisions,
  summarizeDecisions,
} from './skill-recommendation-diff.js';

describe('buildSkillRecommendationDecisions', () => {
  it('marks shared skills as both, recommendation-only as added, and current-only as removed', () => {
    const decisions = buildSkillRecommendationDecisions(
      [
        { skillId: 'a', enabled: true, pinned: false, displayName: 'A' },
        { skillId: 'b', enabled: true, pinned: true, displayName: 'B' },
      ],
      [
        { skill_id: 'a', pinned: false, reason: 'still relevant', score: 80 },
        { skill_id: 'c', pinned: true, reason: 'new pick', score: 92 },
      ],
    );
    expect(decisions.size).toBe(3);

    const a = decisions.get('a')!;
    expect(a.origin).toBe('both');
    expect(a.enabled).toBe(true);
    expect(a.pinned).toBe(false);
    expect(a.delta).toBe('unchanged');

    const b = decisions.get('b')!;
    expect(b.origin).toBe('current-only');
    expect(b.enabled).toBe(false);
    expect(b.delta).toBe('will be removed');

    const c = decisions.get('c')!;
    expect(c.origin).toBe('recommended-only');
    expect(c.enabled).toBe(true);
    expect(c.pinned).toBe(true);
    expect(c.delta).toBe('new addition');
  });

  it('reports a pinned-toggle delta when current vs recommendation disagree on pinned', () => {
    const decisions = buildSkillRecommendationDecisions(
      [{ skillId: 'a', enabled: true, pinned: false }],
      [{ skill_id: 'a', pinned: true, reason: 'should be pinned now', score: 88 }],
    );
    expect(decisions.get('a')!.delta).toBe('pinned off → on');
  });
});

describe('summarizeDecisions', () => {
  it('counts enabled / pinned / added / removed', () => {
    const decisions = buildSkillRecommendationDecisions(
      [
        { skillId: 'keep', enabled: true, pinned: true },
        { skillId: 'drop', enabled: true, pinned: false },
      ],
      [
        { skill_id: 'keep', pinned: true, reason: '', score: 90 },
        { skill_id: 'new1', pinned: false, reason: '', score: 70 },
        { skill_id: 'new2', pinned: true, reason: '', score: 85 },
      ],
    );
    const summary = summarizeDecisions(decisions);
    expect(summary).toMatchObject({
      total: 4,
      enabled: 3, // keep, new1, new2
      pinned: 2, // keep, new2
      added: 2, // new1, new2
      removed: 1, // drop
    });
  });

  it('returns zeros for an empty decision map', () => {
    expect(summarizeDecisions(new Map())).toEqual({
      total: 0,
      enabled: 0,
      pinned: 0,
      added: 0,
      removed: 0,
    });
  });
});
