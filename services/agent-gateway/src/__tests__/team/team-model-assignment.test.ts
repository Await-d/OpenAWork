/**
 * 单测：团队模型智能分配服务端逻辑（prompt 构建 / 响应解析 / 规则兜底 / 主流程）。
 */

import { describe, expect, it } from 'vitest';
import {
  assignTeamModels,
  buildAssignmentPrompt,
  fallbackAssign,
  modelTierScore,
  parseAssignmentResponse,
  pickAnalysisModel,
  pickAnalysisModels,
  type AssignModelCandidate,
  type AssignModelsRequest,
} from '../../team/team-model-assignment.js';

const CHEAP: AssignModelCandidate = {
  providerId: 'p-cheap',
  modelId: 'cheap-mini',
  label: 'Cheap Mini',
  contextWindow: 8000,
  supportsTools: false,
  supportsThinking: false,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};

const STRONG: AssignModelCandidate = {
  providerId: 'p-strong',
  modelId: 'strong-max',
  label: 'Strong Max',
  contextWindow: 200000,
  supportsTools: true,
  supportsThinking: true,
  inputPricePerMillion: 10,
  outputPricePerMillion: 30,
};

const POOL = [CHEAP, STRONG];

const REQUEST: AssignModelsRequest = {
  strategy: 'balanced',
  pool: POOL,
  layers: [
    { layer: 'reception', memberLabels: ['接待官'] },
    { layer: 'pm1', memberLabels: ['产品规划师'] },
    { layer: 'executor', memberLabels: ['前端开发者', '后端开发者'] },
  ],
};

describe('buildAssignmentPrompt', () => {
  it('includes pool entries, layers, and the JSON output instruction', () => {
    const prompt = buildAssignmentPrompt(REQUEST);
    expect(prompt).toContain('cheap-mini');
    expect(prompt).toContain('strong-max');
    expect(prompt).toContain('layer="reception"');
    expect(prompt).toContain('assignments');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('reason');
  });
});

describe('parseAssignmentResponse', () => {
  const layers = ['reception', 'pm1', 'executor'] as const;

  it('parses a clean JSON object', () => {
    const text = JSON.stringify({
      assignments: [
        { layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini', reason: '低成本高频' },
        { layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' },
      ],
    });
    const result = parseAssignmentResponse(text, POOL, [...layers]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      layer: 'reception',
      providerId: 'p-cheap',
      modelId: 'cheap-mini',
      reason: '低成本高频',
    });
    // reason 缺省时不应带该字段
    expect(result[1]).toEqual({ layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' });
  });

  it('tolerates markdown code fences', () => {
    const text = '```json\n{"assignments":[{"layer":"pm1","providerId":"p-strong","modelId":"strong-max"}]}\n```';
    const result = parseAssignmentResponse(text, POOL, [...layers]);
    expect(result).toEqual([{ layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' }]);
  });

  it('drops entries whose model is not in the pool', () => {
    const text = JSON.stringify({
      assignments: [{ layer: 'reception', providerId: 'p-x', modelId: 'ghost' }],
    });
    expect(parseAssignmentResponse(text, POOL, [...layers])).toEqual([]);
  });

  it('drops unknown / unrequested layers and dedupes', () => {
    const text = JSON.stringify({
      assignments: [
        { layer: 'reviewer', providerId: 'p-cheap', modelId: 'cheap-mini' }, // not requested
        { layer: 'pm1', providerId: 'p-cheap', modelId: 'cheap-mini' },
        { layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' }, // dup layer → ignored
      ],
    });
    const result = parseAssignmentResponse(text, POOL, [...layers]);
    expect(result).toEqual([{ layer: 'pm1', providerId: 'p-cheap', modelId: 'cheap-mini' }]);
  });

  it('returns [] for non-JSON garbage', () => {
    expect(parseAssignmentResponse('not json at all', POOL, [...layers])).toEqual([]);
  });

  it('accepts a top-level array (no assignments wrapper)', () => {
    const text = JSON.stringify([
      { layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini' },
    ]);
    const result = parseAssignmentResponse(text, POOL, [...layers]);
    expect(result).toEqual([{ layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini' }]);
  });

  it('resolves a missing/wrong providerId when modelId is unique in the pool', () => {
    const text = JSON.stringify({
      assignments: [{ layer: 'pm1', modelId: 'strong-max' }],
    });
    const result = parseAssignmentResponse(text, POOL, [...layers]);
    expect(result).toEqual([{ layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' }]);
  });

  it('tolerates providerName used in place of providerId (ambiguous modelId)', () => {
    // Two pool entries share modelId 'shared' under different providers.
    const ambiguousPool: AssignModelCandidate[] = [
      { providerId: 'p1', providerName: 'Alpha', modelId: 'shared' },
      { providerId: 'p2', providerName: 'Beta', modelId: 'shared' },
    ];
    const text = JSON.stringify({
      assignments: [{ layer: 'pm1', providerId: 'Beta', modelId: 'shared' }],
    });
    const result = parseAssignmentResponse(text, ambiguousPool, [...layers]);
    expect(result).toEqual([{ layer: 'pm1', providerId: 'p2', modelId: 'shared' }]);
  });

  it('skips ambiguous modelId when no provider hint resolves it', () => {
    const ambiguousPool: AssignModelCandidate[] = [
      { providerId: 'p1', modelId: 'shared' },
      { providerId: 'p2', modelId: 'shared' },
    ];
    const text = JSON.stringify({
      assignments: [{ layer: 'pm1', modelId: 'shared' }],
    });
    expect(parseAssignmentResponse(text, ambiguousPool, [...layers])).toEqual([]);
  });

  it('salvages assignment objects from truncated JSON (mid-array cutoff)', () => {
    // Simulate a response that ran out of output tokens partway through.
    const truncated =
      '{"assignments":[' +
      '{"layer":"reception","providerId":"p-cheap","modelId":"cheap-mini","reason":"便宜"},' +
      '{"layer":"pm1","providerId":"p-strong","modelId":"strong-max","reason":"强推理"},' +
      '{"layer":"executor","providerId":"p-stro'; // cut off mid-object, no closing brackets
    const result = parseAssignmentResponse(truncated, POOL, [...layers]);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.layer)).toEqual(['reception', 'pm1']);
    expect(result[1]?.reason).toBe('强推理');
  });

  it('salvages from trailing-comma / loosely formatted JSON', () => {
    const loose =
      'Here you go:\n{"assignments":[\n' +
      '{"layer":"pm1","providerId":"p-strong","modelId":"strong-max"},\n' +
      ']}'; // trailing comma breaks strict JSON.parse
    const result = parseAssignmentResponse(loose, POOL, [...layers]);
    expect(result).toEqual([{ layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' }]);
  });
});

describe('pickAnalysisModel', () => {
  it('picks the strongest pool model for the analysis call', () => {
    const chosen = pickAnalysisModel(POOL);
    // STRONG has tools+thinking+large context → wins the generic capability score.
    expect(chosen).toEqual({ providerId: 'p-strong', modelId: 'strong-max' });
  });

  it('returns null for an empty pool', () => {
    expect(pickAnalysisModel([])).toBeNull();
  });
});

describe('modelTierScore', () => {
  const score = (modelId: string, label?: string) =>
    modelTierScore({ providerId: 'p', modelId, ...(label ? { label } : {}) });

  it('ranks flagship tiers above lightweight tiers', () => {
    expect(score('claude-opus-4-8', 'Claude Opus 4.8')).toBeGreaterThan(
      score('claude-haiku-4', 'Claude Haiku 4'),
    );
    expect(score('mimo-v2.5-pro', 'MiMo V2.5 Pro')).toBeGreaterThan(score('mimo-v2.5', 'MiMo V2.5'));
    expect(score('gpt-5.5', 'GPT-5.5')).toBeGreaterThan(score('gpt-5-mini', 'GPT-5 Mini'));
  });

  it('treats a newer version as stronger when tier words match', () => {
    expect(score('gpt-5.5')).toBeGreaterThan(score('gpt-5.4'));
    expect(score('claude-opus-4-8')).toBeGreaterThan(score('claude-opus-4-6'));
  });

  it('returns a neutral-ish score for an unknown plain name', () => {
    const s = score('some-custom-model');
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.9);
  });

  it('clamps to [0,1]', () => {
    const s = score('nano-mini-lite-tiny');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('pickAnalysisModels', () => {
  it('returns one model per provider, strongest first', () => {
    const multiPool: AssignModelCandidate[] = [
      { providerId: 'mimo', modelId: 'mimo-v2.5', supportsTools: true, contextWindow: 100000 },
      { providerId: 'mimo', modelId: 'mimo-v2.5-pro', supportsThinking: true, contextWindow: 100000 },
      { providerId: 'openai', modelId: 'gpt', supportsTools: true, supportsThinking: true, contextWindow: 1000000 },
    ];
    const out = pickAnalysisModels(multiPool);
    // distinct providers only
    expect(out.map((o) => o.providerId)).toEqual(['openai', 'mimo']);
    // openai is strongest (bigger context + both caps)
    expect(out[0]).toEqual({ providerId: 'openai', modelId: 'gpt' });
  });

  it('returns [] for an empty pool', () => {
    expect(pickAnalysisModels([])).toEqual([]);
  });

  it('within a provider, prefers the flagship (pro) over the base model', () => {
    const pool: AssignModelCandidate[] = [
      { providerId: 'mimo', modelId: 'mimo-v2.5', supportsTools: true, supportsThinking: true, contextWindow: 1000000 },
      { providerId: 'mimo', modelId: 'mimo-v2.5-pro', supportsTools: true, supportsThinking: true, contextWindow: 1000000 },
    ];
    const out = pickAnalysisModels(pool);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ providerId: 'mimo', modelId: 'mimo-v2.5-pro' });
  });
});

describe('fallbackAssign', () => {
  it('quality picks the strong model for reasoning layers', () => {
    const out = fallbackAssign({ ...REQUEST, strategy: 'quality' });
    const pm1 = out.find((a) => a.layer === 'pm1');
    expect(pm1?.modelId).toBe('strong-max');
  });

  it('single uses one model for every layer', () => {
    const out = fallbackAssign({ ...REQUEST, strategy: 'single' });
    expect(new Set(out.map((a) => a.modelId)).size).toBe(1);
    expect(out).toHaveLength(REQUEST.layers.length);
  });

  it('attaches a rule-engine reason to each assignment', () => {
    const out = fallbackAssign({ ...REQUEST, strategy: 'quality' });
    expect(out.length).toBeGreaterThan(0);
    for (const a of out) {
      expect(typeof a.reason).toBe('string');
      expect(a.reason && a.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns [] when pool is empty', () => {
    expect(fallbackAssign({ ...REQUEST, pool: [] })).toEqual([]);
  });
});

describe('assignTeamModels', () => {
  it('uses LLM output when valid (source=llm)', async () => {
    const llm = async () =>
      JSON.stringify({
        assignments: [
          { layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini', reason: '便宜快' },
          { layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max', reason: '强推理' },
          { layer: 'executor', providerId: 'p-strong', modelId: 'strong-max', reason: '强工具' },
        ],
      });
    const result = await assignTeamModels(REQUEST, llm);
    expect(result.source).toBe('llm');
    expect(result.assignments).toHaveLength(3);
    expect(result.assignments.find((a) => a.layer === 'pm1')?.reason).toBe('强推理');
  });

  it('falls back to rule engine when the LLM throws (source=fallback)', async () => {
    const llm = async () => {
      throw new Error('upstream 500');
    };
    const result = await assignTeamModels(REQUEST, llm);
    expect(result.source).toBe('fallback');
    expect(result.assignments).toHaveLength(3);
    expect(result.fallbackReasonCode).toBe('llm-error');
    expect(result.fallbackMessage).toContain('upstream 500');
  });

  it('falls back with reason code llm-empty when the LLM returns garbage', async () => {
    const result = await assignTeamModels(REQUEST, async () => 'nonsense not json');
    expect(result.source).toBe('fallback');
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.fallbackReasonCode).toBe('llm-empty');
    expect(result.llmRawSnippet).toContain('nonsense');
  });

  it('fills missing layers from the rule engine but keeps source=llm', async () => {
    // LLM only covers reception; pm1 + executor get filled by fallback.
    const llm = async () =>
      JSON.stringify({
        assignments: [{ layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini' }],
      });
    const result = await assignTeamModels(REQUEST, llm);
    expect(result.source).toBe('llm');
    expect(result.assignments).toHaveLength(3);
    expect(result.assignments.find((a) => a.layer === 'reception')?.modelId).toBe('cheap-mini');
  });

  it('returns empty fallback when pool is empty', async () => {
    const result = await assignTeamModels({ ...REQUEST, pool: [] }, async () => '{}');
    expect(result).toEqual({ assignments: [], source: 'fallback' });
  });

  it('tries the next caller when the first provider errors (multi-candidate)', async () => {
    const calls: string[] = [];
    const failing = async () => {
      calls.push('a');
      throw new Error('Invalid JSON response');
    };
    const working = async () => {
      calls.push('b');
      return JSON.stringify({
        assignments: [
          { layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini' },
          { layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' },
          { layer: 'executor', providerId: 'p-strong', modelId: 'strong-max' },
        ],
      });
    };
    const result = await assignTeamModels(REQUEST, [failing, working]);
    expect(result.source).toBe('llm');
    expect(result.assignments).toHaveLength(3);
    expect(calls).toEqual(['a', 'b']); // tried failing first, then working
  });

  it('falls back with the last error when every candidate fails', async () => {
    const c1 = async () => {
      throw new Error('Invalid JSON response');
    };
    const c2 = async () => {
      throw new Error('401 unauthorized');
    };
    const result = await assignTeamModels(REQUEST, [c1, c2]);
    expect(result.source).toBe('fallback');
    expect(result.fallbackReasonCode).toBe('llm-error');
    expect(result.fallbackMessage).toContain('401');
  });

  it('stops at the first caller that yields valid assignments', async () => {
    let secondCalled = false;
    const first = async () =>
      JSON.stringify({
        assignments: [
          { layer: 'reception', providerId: 'p-cheap', modelId: 'cheap-mini' },
          { layer: 'pm1', providerId: 'p-strong', modelId: 'strong-max' },
          { layer: 'executor', providerId: 'p-strong', modelId: 'strong-max' },
        ],
      });
    const second = async () => {
      secondCalled = true;
      return '{}';
    };
    const result = await assignTeamModels(REQUEST, [first, second]);
    expect(result.source).toBe('llm');
    expect(secondCalled).toBe(false);
  });
});
