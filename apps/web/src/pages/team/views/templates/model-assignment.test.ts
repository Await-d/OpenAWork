import { describe, expect, it } from 'vitest';
import type { FixedTeamMemberSlot } from '@openAwork/shared';
import {
  assignModelsToRoster,
  clearAllModels,
  countAssignedModels,
  pickCheapest,
  pickModelForLayer,
  pickStrongest,
  setLayerModel,
  setSlotModel,
  type ModelCandidate,
} from './model-assignment.js';

function slot(
  id: string,
  layer: FixedTeamMemberSlot['layer'],
  specialty: FixedTeamMemberSlot['specialty'],
): FixedTeamMemberSlot {
  return {
    id,
    layer,
    specialty,
    displayName: id,
    personaKey: `${layer}:${specialty}`,
    toolsets: ['read'],
    required: false,
  };
}

/** A cheap, weak model (no tools/thinking, small context, low price). */
const CHEAP_WEAK: ModelCandidate = {
  providerId: 'p-cheap',
  providerName: 'Cheap',
  modelId: 'cheap-mini',
  label: 'Cheap Mini',
  contextWindow: 8_000,
  supportsTools: false,
  supportsThinking: false,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};

/** A strong, expensive model (tools + thinking, large context, high price). */
const STRONG_EXPENSIVE: ModelCandidate = {
  providerId: 'p-strong',
  providerName: 'Strong',
  modelId: 'strong-max',
  label: 'Strong Max',
  contextWindow: 200_000,
  supportsTools: true,
  supportsThinking: true,
  inputPricePerMillion: 10,
  outputPricePerMillion: 30,
};

/** A tools-focused mid model (tools yes, thinking no, mid context/price). */
const TOOLS_MID: ModelCandidate = {
  providerId: 'p-mid',
  providerName: 'Mid',
  modelId: 'mid-coder',
  label: 'Mid Coder',
  contextWindow: 64_000,
  supportsTools: true,
  supportsThinking: false,
  inputPricePerMillion: 2,
  outputPricePerMillion: 4,
};

const POOL = [CHEAP_WEAK, STRONG_EXPENSIVE, TOOLS_MID];

const RANGES = {
  ctxRange: { min: 8_000, max: 200_000 },
  priceRange: { min: 0.15, max: 20 },
};

describe('pickModelForLayer', () => {
  it('quality strategy picks the strongest model for a reasoning-heavy layer', () => {
    const chosen = pickModelForLayer('pm1', POOL, 'quality', RANGES);
    expect(chosen?.modelId).toBe('strong-max');
  });

  it('cost strategy picks the cheapest model even for a strong layer', () => {
    const chosen = pickModelForLayer('reviewer', POOL, 'cost', RANGES);
    expect(chosen?.modelId).toBe('cheap-mini');
  });

  it('balanced strategy avoids the most expensive model on a cost-sensitive layer', () => {
    // reception has high costSensitivity (0.9) → strong-expensive gets penalized.
    const chosen = pickModelForLayer('reception', POOL, 'balanced', RANGES);
    expect(chosen?.modelId).not.toBe('strong-max');
  });

  it('returns null for an empty pool', () => {
    expect(pickModelForLayer('executor', [], 'balanced', RANGES)).toBeNull();
  });
});

describe('pickCheapest / pickStrongest', () => {
  it('pickCheapest returns the lowest combined-price model', () => {
    expect(pickCheapest(POOL)?.modelId).toBe('cheap-mini');
  });

  it('pickStrongest returns the most capable model', () => {
    expect(pickStrongest(POOL)?.modelId).toBe('strong-max');
  });

  it('both return null for an empty pool', () => {
    expect(pickCheapest([])).toBeNull();
    expect(pickStrongest([])).toBeNull();
  });
});

describe('assignModelsToRoster', () => {
  const roster: FixedTeamMemberSlot[] = [
    slot('r1', 'reception', 'intake'),
    slot('e1', 'executor', 'frontend'),
    slot('e2', 'executor', 'backend'),
    slot('v1', 'reviewer', 'code-review'),
  ];

  it('single strategy assigns the same (strongest) model to every slot', () => {
    const next = assignModelsToRoster(roster, POOL, 'single');
    const models = new Set(next.map((s) => s.modelId));
    expect(models.size).toBe(1);
    expect([...models][0]).toBe('strong-max');
  });

  it('same-layer members share the layer choice', () => {
    const next = assignModelsToRoster(roster, POOL, 'balanced');
    const e1 = next.find((s) => s.id === 'e1');
    const e2 = next.find((s) => s.id === 'e2');
    expect(e1?.modelId).toBeDefined();
    expect(e1?.modelId).toBe(e2?.modelId);
  });

  it('writes both providerId and modelId', () => {
    const next = assignModelsToRoster(roster, POOL, 'quality');
    for (const s of next) {
      expect(s.providerId).toBeTruthy();
      expect(s.modelId).toBeTruthy();
    }
  });

  it('returns the roster unchanged when the pool is empty', () => {
    const next = assignModelsToRoster(roster, [], 'balanced');
    expect(countAssignedModels(next)).toBe(0);
  });

  it('does not mutate the input roster', () => {
    assignModelsToRoster(roster, POOL, 'quality');
    expect(countAssignedModels(roster)).toBe(0);
  });
});

describe('setLayerModel / setSlotModel / clearAllModels', () => {
  const roster: FixedTeamMemberSlot[] = [
    slot('e1', 'executor', 'frontend'),
    slot('e2', 'executor', 'backend'),
    slot('v1', 'reviewer', 'code-review'),
  ];

  it('setLayerModel assigns to all slots in the layer only', () => {
    const next = setLayerModel(roster, 'executor', {
      providerId: 'p-mid',
      modelId: 'mid-coder',
    });
    expect(next.find((s) => s.id === 'e1')?.modelId).toBe('mid-coder');
    expect(next.find((s) => s.id === 'e2')?.modelId).toBe('mid-coder');
    expect(next.find((s) => s.id === 'v1')?.modelId).toBeUndefined();
  });

  it('setLayerModel with null clears the layer binding', () => {
    const assigned = setLayerModel(roster, 'executor', {
      providerId: 'p-mid',
      modelId: 'mid-coder',
    });
    const cleared = setLayerModel(assigned, 'executor', null);
    expect(cleared.find((s) => s.id === 'e1')?.modelId).toBeUndefined();
    expect(cleared.find((s) => s.id === 'e1')?.providerId).toBeUndefined();
  });

  it('setSlotModel targets a single slot', () => {
    const next = setSlotModel(roster, 'e1', { providerId: 'p-strong', modelId: 'strong-max' });
    expect(next.find((s) => s.id === 'e1')?.modelId).toBe('strong-max');
    expect(next.find((s) => s.id === 'e2')?.modelId).toBeUndefined();
  });

  it('clearAllModels strips every binding', () => {
    const assigned = assignModelsToRoster(roster, POOL, 'quality');
    expect(countAssignedModels(assigned)).toBe(3);
    const cleared = clearAllModels(assigned);
    expect(countAssignedModels(cleared)).toBe(0);
  });
});

describe('countAssignedModels', () => {
  it('counts only slots with a non-empty modelId', () => {
    const roster: FixedTeamMemberSlot[] = [
      { ...slot('a', 'executor', 'frontend'), modelId: 'm1', providerId: 'p1' },
      slot('b', 'executor', 'backend'),
    ];
    expect(countAssignedModels(roster)).toBe(1);
  });
});
