import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluate,
  createSessionContext,
  recordClarification,
  canProceedWithoutClarification,
  isSubAgentPrompt,
  buildSubAgentPrompt,
  SUB_AGENT_PROMPT_PREFIX,
} from '../routing.js';
import type { SessionContext } from '../routing.js';

let ctx: SessionContext;

beforeEach(() => {
  ctx = createSessionContext('sess-1');
});

describe('evaluate: R0 (no action)', () => {
  it('question-style input resolves to R0', () => {
    const result = evaluate('How does the auth system work?', ctx);
    expect(result.level).toBe('R0');
    expect(result.dimensions.needsAction).toBe(false);
  });

  it('R0 has no clarifications', () => {
    const result = evaluate('What is the session store?', ctx);
    expect(result.clarifications).toBeUndefined();
  });
});

describe('evaluate: R1 (direct action)', () => {
  it('targeted fix resolves to R1', () => {
    const result = evaluate('fix the typo in the login button label', ctx);
    expect(result.level).toBe('R1');
  });

  it('R1 has no clarifications', () => {
    const result = evaluate('add a console.log to debug this', ctx);
    expect(result.clarifications).toBeUndefined();
  });
});

describe('evaluate: R2 (multi-file action)', () => {
  it('find+update pattern resolves to R2', () => {
    const result = evaluate('find and update the session handler', ctx);
    expect(result.level).toBe('R2');
  });

  it('R2 includes clarification when round < 3', () => {
    const result = evaluate('find and update the session handler', ctx);
    expect(result.clarifications).toBeDefined();
    expect(result.clarifications!.length).toBe(1);
  });
});

describe('evaluate: R3 (high risk / architectural)', () => {
  it('delete operation resolves to R3', () => {
    const result = evaluate('delete the old user table', ctx);
    expect(result.level).toBe('R3');
    expect(result.dimensions.riskLevel).toBe('high');
  });

  it('architectural scope resolves to R3', () => {
    const result = evaluate('refactor the entire database schema across all services', ctx);
    expect(result.level).toBe('R3');
  });

  it('cross-system impact resolves to R3', () => {
    const result = evaluate('implement end-to-end encryption across all services', ctx);
    expect(result.level).toBe('R3');
  });
});

describe('evaluate: clarification suppression after 3 rounds', () => {
  it('stops clarifying after 3 rounds', () => {
    let c = ctx;
    c = recordClarification(c, 'goal', 'add feature');
    c = recordClarification(c, 'constraint', 'none');
    c = recordClarification(c, 'deliverable', 'code');
    const result = evaluate('find all the broken imports', c);
    expect(result.clarifications).toBeUndefined();
  });
});

describe('recordClarification', () => {
  it('increments clarificationRound', () => {
    const updated = recordClarification(ctx, 'goal', 'add auth');
    expect(updated.clarificationRound).toBe(1);
  });

  it('adds dimension to collectedDimensions', () => {
    const updated = recordClarification(ctx, 'goal', 'add auth');
    expect(updated.collectedDimensions.has('goal')).toBe(true);
  });

  it('records history entry', () => {
    const updated = recordClarification(ctx, 'goal', 'add auth');
    expect(updated.history[0]).toBe('goal: add auth');
  });

  it('does not mutate original context', () => {
    recordClarification(ctx, 'goal', 'add auth');
    expect(ctx.clarificationRound).toBe(0);
    expect(ctx.collectedDimensions.size).toBe(0);
  });
});

describe('canProceedWithoutClarification', () => {
  it('returns true when no clarifications', () => {
    const result = evaluate('fix typo', ctx);
    expect(canProceedWithoutClarification(result)).toBe(true);
  });

  it('returns false when clarifications present', () => {
    const result = evaluate('find all the broken imports', ctx);
    expect(canProceedWithoutClarification(result)).toBe(
      !result.clarifications || result.clarifications.length === 0,
    );
  });
});

describe('sub-agent prompt utilities', () => {
  it('isSubAgentPrompt returns true for sub-agent prefixed input', () => {
    const prompt = buildSubAgentPrompt('Planner', 'Plan the migration');
    expect(isSubAgentPrompt(prompt)).toBe(true);
  });

  it('isSubAgentPrompt returns false for normal input', () => {
    expect(isSubAgentPrompt('add a new feature')).toBe(false);
  });

  it('buildSubAgentPrompt includes prefix, role, and task', () => {
    const prompt = buildSubAgentPrompt('Reviewer', 'Check the code');
    expect(prompt).toContain(SUB_AGENT_PROMPT_PREFIX);
    expect(prompt).toContain('Reviewer');
    expect(prompt).toContain('Check the code');
  });
});
