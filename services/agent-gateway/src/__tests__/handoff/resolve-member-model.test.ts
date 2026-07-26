/**
 * Phase 2 单元测试：从根 session 的 teamDefinition.memberSlots 快照解析成员模型。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ResolveModule from '../../handoff/bus/resolve-member-model.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let resolver: typeof ResolveModule;

const USER_ID = 'u-resolve';
const ROOT_SESSION_ID = 's-root';
const PM2_SESSION_ID = 's-pm2';

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(
  sessionId: string,
  parentId: string | null,
  metadata: Record<string, unknown>,
): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, team_parent_session_id, role_layer)
     VALUES (?, ?, 'demo', ?, ?, ?)`,
    [
      sessionId,
      USER_ID,
      JSON.stringify(metadata),
      parentId,
      parentId === null ? 'reception' : 'pm2',
    ],
  );
}

const ROSTER_SNAPSHOT = {
  teamDefinition: {
    memberSlots: [
      {
        id: 'executor-frontend',
        layer: 'executor',
        specialty: 'frontend',
        personaKey: 'executor:frontend',
        toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
        modelId: 'fe-model',
        providerId: 'p-fe',
      },
      {
        id: 'executor-backend',
        layer: 'executor',
        specialty: 'backend',
        personaKey: 'executor:backend',
        modelId: 'be-model',
        providerId: 'p-be',
      },
      {
        id: 'reviewer-code',
        layer: 'reviewer',
        specialty: 'code-review',
        personaKey: 'reviewer:code-review',
        // no model binding → should resolve to undefined
      },
      {
        id: 'executor-thinking-only',
        layer: 'executor',
        specialty: 'thinking-only',
        personaKey: 'executor:thinking-only',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      },
      {
        id: 'pm1-thinking-only',
        layer: 'pm1',
        specialty: 'thinking-only',
        personaKey: 'pm1:thinking-only',
        thinkingEnabled: false,
        reasoningEffort: 'low',
      },
      {
        id: 'executor-custom-abc',
        layer: 'executor',
        specialty: 'custom',
        personaKey: 'executor:custom:abc',
        displayName: '性能优化专家',
        custom: true,
        systemPrompt: '你是性能优化专家。',
        skillIds: ['perf-audit', 'flamegraph'],
        mcpServerIds: ['grep_app'],
      },
    ],
  },
};

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  resolver = await import('../../handoff/bus/resolve-member-model.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedSession(ROOT_SESSION_ID, null, ROSTER_SNAPSHOT);
  // pm2 child session points at root; executor handoffs originate here.
  seedSession(PM2_SESSION_ID, ROOT_SESSION_ID, {});
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('resolveMemberModelForHandoff', () => {
  it('resolves the exact member model by assignedMember.personaKey', () => {
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:backend' } },
    });
    expect(resolved).toEqual({ modelId: 'be-model', providerId: 'p-be' });
  });

  it('walks up parent chain to find the root roster snapshot', () => {
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:frontend' } },
    });
    expect(resolved?.modelId).toBe('fe-model');
  });

  it('falls back to the first layer slot when no personaKey is given', () => {
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: {},
    });
    // first executor slot with a modelId
    expect(resolved?.modelId).toBe('fe-model');
  });

  it('returns undefined when the matched slot has no model binding', () => {
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'reviewer',
      payload: { assignedMember: { personaKey: 'reviewer:code-review' } },
    });
    expect(resolved).toBeUndefined();
  });

  it('保留自动解析模型时也会解析成员 thinking 覆盖', () => {
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:thinking-only' } },
    });
    expect(resolved).toEqual({
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
  });

  it('falls back to the root session model snapshot when the matched slot has no model binding', () => {
    seedSession(ROOT_SESSION_ID, null, {
      ...ROSTER_SNAPSHOT,
      modelId: 'root-model',
      providerId: 'root-provider',
    });
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'reviewer',
      payload: { assignedMember: { personaKey: 'reviewer:code-review' } },
    });
    expect(resolved).toEqual({ modelId: 'root-model', providerId: 'root-provider' });
  });

  it('returns undefined when there is no roster snapshot', () => {
    seedSession(PM2_SESSION_ID, null, {});
    const resolved = resolver.resolveMemberModelForHandoff({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:backend' } },
    });
    expect(resolved).toBeUndefined();
  });
});

describe('resolveMemberModelForSessionLayer', () => {
  it('resolves the first bound slot for a layer (reception/pm1/pm2 path)', () => {
    const resolved = resolver.resolveMemberModelForSessionLayer({
      sessionId: ROOT_SESSION_ID,
      layer: 'executor',
    });
    expect(resolved?.modelId).toBe('fe-model');
  });

  it('walks up the parent chain from a child session', () => {
    const resolved = resolver.resolveMemberModelForSessionLayer({
      sessionId: PM2_SESSION_ID,
      layer: 'executor',
    });
    expect(resolved?.modelId).toBe('fe-model');
  });

  it('returns thinking overrides for a layer without explicit model binding', () => {
    const resolved = resolver.resolveMemberModelForSessionLayer({
      sessionId: ROOT_SESSION_ID,
      layer: 'pm1',
    });
    expect(resolved).toEqual({
      thinkingEnabled: false,
      reasoningEffort: 'low',
    });
  });

  it('falls back to the root session model snapshot for an unbound layer', () => {
    seedSession(ROOT_SESSION_ID, null, {
      ...ROSTER_SNAPSHOT,
      modelId: 'root-model',
      providerId: 'root-provider',
    });
    const resolved = resolver.resolveMemberModelForSessionLayer({
      sessionId: ROOT_SESSION_ID,
      layer: 'reviewer',
    });
    expect(resolved).toEqual({ modelId: 'root-model', providerId: 'root-provider' });
  });
});

describe('resolveMemberSystemPrompt', () => {
  it('resolves a custom member systemPrompt by personaKey', () => {
    const resolved = resolver.resolveMemberSystemPrompt({
      fromSessionId: PM2_SESSION_ID,
      payload: { assignedMember: { personaKey: 'executor:custom:abc' } },
    });
    expect(resolved).toEqual({ displayName: '性能优化专家', systemPrompt: '你是性能优化专家。' });
  });

  it('returns undefined for a non-custom member (no systemPrompt)', () => {
    const resolved = resolver.resolveMemberSystemPrompt({
      fromSessionId: PM2_SESSION_ID,
      payload: { assignedMember: { personaKey: 'executor:frontend' } },
    });
    expect(resolved).toBeUndefined();
  });

  it('returns undefined when no personaKey is provided', () => {
    const resolved = resolver.resolveMemberSystemPrompt({
      fromSessionId: PM2_SESSION_ID,
      payload: {},
    });
    expect(resolved).toBeUndefined();
  });
});

describe('resolveMemberCapabilities', () => {
  it('会为旧版内置 executor 成员补 desktop 工具集', () => {
    const caps = resolver.resolveMemberCapabilities({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:frontend' } },
    });
    expect(caps.toolsets).toEqual(['read', 'write', 'shell', 'lsp', 'test', 'desktop']);
  });

  it('resolves skillIds + mcpServerIds by personaKey', () => {
    const caps = resolver.resolveMemberCapabilities({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'executor',
      payload: { assignedMember: { personaKey: 'executor:custom:abc' } },
    });
    expect(caps.skillIds).toEqual(['perf-audit', 'flamegraph']);
    expect(caps.mcpServerIds).toEqual(['grep_app']);
  });

  it('returns empty arrays for a member without capability bindings', () => {
    const caps = resolver.resolveMemberCapabilities({
      fromSessionId: PM2_SESSION_ID,
      toRoleLayer: 'reviewer',
      payload: { assignedMember: { personaKey: 'reviewer:code-review' } },
    });
    expect(caps).toEqual({ skillIds: [], mcpServerIds: [], toolsets: [] });
  });
});

describe('mergeMemberCapabilitiesIntoMetadata', () => {
  it('injects requestedSkills + requestedMcpServers + toolsets', () => {
    const merged = resolver.mergeMemberCapabilitiesIntoMetadata(undefined, {
      skillIds: ['s1'],
      mcpServerIds: ['m1'],
      toolsets: ['read', 'write'],
    });
    const parsed = JSON.parse(merged!);
    expect(parsed.requestedSkills).toEqual(['s1']);
    expect(parsed.requestedMcpServers).toEqual(['m1']);
    expect(parsed.toolsets).toEqual(['read', 'write']);
  });

  it('does not overwrite existing requestedSkills', () => {
    const merged = resolver.mergeMemberCapabilitiesIntoMetadata(
      JSON.stringify({ requestedSkills: ['keep'] }),
      { skillIds: ['s1'], mcpServerIds: [], toolsets: [] },
    );
    expect(JSON.parse(merged!).requestedSkills).toEqual(['keep']);
  });

  it('returns input unchanged when caps are empty', () => {
    expect(
      resolver.mergeMemberCapabilitiesIntoMetadata('{"a":1}', {
        skillIds: [],
        mcpServerIds: [],
        toolsets: [],
      }),
    ).toBe('{"a":1}');
  });
});

describe('mergeDelegatedSystemPromptIntoMetadata', () => {
  it('injects delegatedSystemPrompt into empty metadata', () => {
    const merged = resolver.mergeDelegatedSystemPromptIntoMetadata(undefined, '你是专家。');
    expect(merged).toBeDefined();
    expect(JSON.parse(merged!).delegatedSystemPrompt).toBe('你是专家。');
  });

  it('does not overwrite an existing delegatedSystemPrompt', () => {
    const merged = resolver.mergeDelegatedSystemPromptIntoMetadata(
      JSON.stringify({ delegatedSystemPrompt: 'existing' }),
      '你是专家。',
    );
    expect(JSON.parse(merged!).delegatedSystemPrompt).toBe('existing');
  });

  it('returns input unchanged when prompt is empty', () => {
    expect(resolver.mergeDelegatedSystemPromptIntoMetadata('{"a":1}', '')).toBe('{"a":1}');
    expect(resolver.mergeDelegatedSystemPromptIntoMetadata('{"a":1}', undefined)).toBe('{"a":1}');
  });
});

describe('mergeMemberModelIntoMetadata', () => {
  it('injects modelId/providerId/variant into empty metadata', () => {
    const merged = resolver.mergeMemberModelIntoMetadata(undefined, {
      modelId: 'm1',
      providerId: 'p1',
      variant: 'high',
    });
    expect(merged).toBeDefined();
    expect(JSON.parse(merged!)).toMatchObject({
      modelId: 'm1',
      providerId: 'p1',
      variant: 'high',
    });
  });

  it('在只有 thinking 覆盖时也会写入 metadata', () => {
    const merged = resolver.mergeMemberModelIntoMetadata(undefined, {
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
    expect(merged).toBeDefined();
    expect(JSON.parse(merged!)).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
  });

  it('does not overwrite an existing modelId', () => {
    const merged = resolver.mergeMemberModelIntoMetadata(JSON.stringify({ modelId: 'existing' }), {
      modelId: 'm1',
      providerId: 'p1',
    });
    expect(JSON.parse(merged!).modelId).toBe('existing');
  });

  it('不会用空 modelId 覆盖已有模型选择', () => {
    const merged = resolver.mergeMemberModelIntoMetadata(JSON.stringify({ modelId: 'existing' }), {
      thinkingEnabled: true,
      reasoningEffort: 'medium',
    });
    expect(JSON.parse(merged!)).toMatchObject({
      modelId: 'existing',
      thinkingEnabled: true,
      reasoningEffort: 'medium',
    });
  });

  it('returns input unchanged when model is undefined', () => {
    expect(resolver.mergeMemberModelIntoMetadata('{"a":1}', undefined)).toBe('{"a":1}');
  });
});
