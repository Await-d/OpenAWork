/**
 * Pure diff helpers for the skill-recommendation drawer (PR4/PR5 of the
 * skill-workspace-selection spec). Extracted from `SkillRecommendationDrawer.tsx`
 * so the diff logic can be unit-tested without a DOM environment.
 */

export interface CurrentSelectionEntry {
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  displayName?: string;
}

export interface RecommendationItem {
  skill_id: string;
  pinned: boolean;
  reason: string;
  score: number;
}

export interface RowDecision {
  enabled: boolean;
  pinned: boolean;
  origin: 'current-only' | 'recommended-only' | 'both';
  delta: string;
  reason?: string;
  score?: number;
  displayName?: string;
}

/**
 * Build a row-keyed decision map from the user's current selection plus the
 * recommendation's recommendations array.
 *
 *  - Skills present on both sides:      origin = 'both', enabled by default.
 *  - Skills only in current selection:  origin = 'current-only', "will be removed".
 *  - Skills only in recommendation:     origin = 'recommended-only', "new addition".
 */
export function buildSkillRecommendationDecisions(
  current: CurrentSelectionEntry[],
  recommendations: RecommendationItem[],
): Map<string, RowDecision> {
  const out = new Map<string, RowDecision>();
  const recommendedById = new Map(recommendations.map((entry) => [entry.skill_id, entry]));
  for (const cur of current) {
    const rec = recommendedById.get(cur.skillId);
    if (rec) {
      const pinChange = rec.pinned !== cur.pinned;
      out.set(cur.skillId, {
        enabled: true,
        pinned: rec.pinned,
        origin: 'both',
        delta: pinChange
          ? `pinned ${cur.pinned ? 'on' : 'off'} → ${rec.pinned ? 'on' : 'off'}`
          : 'unchanged',
        reason: rec.reason,
        score: rec.score,
        displayName: cur.displayName,
      });
    } else {
      out.set(cur.skillId, {
        enabled: false,
        pinned: false,
        origin: 'current-only',
        delta: 'will be removed',
        displayName: cur.displayName,
      });
    }
  }
  for (const rec of recommendations) {
    if (out.has(rec.skill_id)) continue;
    out.set(rec.skill_id, {
      enabled: true,
      pinned: rec.pinned,
      origin: 'recommended-only',
      delta: 'new addition',
      reason: rec.reason,
      score: rec.score,
    });
  }
  return out;
}

/**
 * Aggregate counters used in the drawer summary header.
 */
export interface DecisionSummary {
  total: number;
  enabled: number;
  pinned: number;
  added: number;
  removed: number;
}

export function summarizeDecisions(decisions: Map<string, RowDecision>): DecisionSummary {
  let pinned = 0;
  let enabled = 0;
  let removed = 0;
  let added = 0;
  for (const row of decisions.values()) {
    if (row.enabled) {
      enabled += 1;
      if (row.pinned) pinned += 1;
      if (row.origin === 'recommended-only') added += 1;
    } else if (row.origin === 'current-only') {
      removed += 1;
    }
  }
  return { total: decisions.size, enabled, pinned, added, removed };
}
