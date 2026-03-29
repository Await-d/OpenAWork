import { describe, expect, it, vi } from 'vitest';
import type { BuiltinRegistrySource } from '../routes/skills.js';

vi.mock('../auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../db.js', () => ({
  db: {
    exec: vi.fn(),
    prepare: vi.fn(() => ({ run: vi.fn() })),
  },
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: {
      succeed: vi.fn(),
      fail: vi.fn(),
    },
  }),
}));

const { BUILTIN_REGISTRY_SOURCES, fetchGitHubSkills, filterSkillEntries } =
  await import('../routes/skills.js');

function createPathIndexedSource(
  id: string,
  directSkillFiles: Array<{ path: string; downloadUrl: string }>,
  browseLimit?: number,
): BuiltinRegistrySource {
  return {
    id,
    name: 'Test Path Indexed Source',
    url: 'https://github.com/test-org/test-skills',
    type: 'community',
    trust: 'verified',
    enabled: true,
    priority: 99,
    readonly: true,
    metadata: { provider: 'github', repo: 'test-org/test-skills' },
    directSkillFiles,
    repo: {
      owner: 'test-org',
      repo: 'test-skills',
      rootPaths: ['skills'],
      maxDepth: 2,
      ref: 'main',
      metadataMode: 'path',
      browseLimit,
    },
  };
}

describe('BUILTIN_REGISTRY_SOURCES', () => {
  it('包含用户要求新增的 GitHub 技能仓库来源', () => {
    const sourceIds = new Set(BUILTIN_REGISTRY_SOURCES.map((source) => source.id));

    expect(sourceIds).toEqual(
      new Set([
        ...sourceIds,
        'github:anthropics/skills',
        'github:openai/skills',
        'github:vercel-labs/skills',
        'github:mattpocock/skills',
        'github:huggingface/skills',
        'github:openclaw/skills',
        'github:obra/superpowers',
        'github:affaan-m/everything-claude-code',
      ]),
    );
  });

  it('为超大仓库启用路径索引模式与浏览上限', () => {
    const openClaw = BUILTIN_REGISTRY_SOURCES.find(
      (source) => source.id === 'github:openclaw/skills',
    );
    const everything = BUILTIN_REGISTRY_SOURCES.find(
      (source) => source.id === 'github:affaan-m/everything-claude-code',
    );

    expect(openClaw?.repo?.discoveryMode).toBe('code-search');
    expect(openClaw?.repo?.metadataMode).toBe('path');
    expect(openClaw?.repo?.browseLimit).toBe(80);

    expect(everything?.repo?.discoveryMode).toBe('code-search');
    expect(everything?.repo?.metadataMode).toBe('path');
    expect(everything?.repo?.browseLimit).toBe(80);
  });
});

describe('fetchGitHubSkills', () => {
  it('在路径索引模式下按路径生成条目并限制无查询浏览数量', async () => {
    const source = createPathIndexedSource(
      'github:test-org/test-skills-a',
      [
        { path: 'skills/zeta-tool/SKILL.md', downloadUrl: 'https://example.com/zeta' },
        { path: 'skills/alpha-tool/SKILL.md', downloadUrl: 'https://example.com/alpha' },
      ],
      1,
    );

    const results = await fetchGitHubSkills([source]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'github:test-org/test-skills-a/skills/alpha-tool',
      name: 'alpha-tool',
      displayName: 'Alpha Tool',
    });
    expect(results[0]?.description).toContain('skills/alpha-tool');
  });

  it('在缓存已建立后仍可按查询过滤路径索引结果', async () => {
    const source = createPathIndexedSource('github:test-org/test-skills-b', [
      { path: 'skills/alpha-tool/SKILL.md', downloadUrl: 'https://example.com/alpha' },
      { path: 'skills/zeta-tool/SKILL.md', downloadUrl: 'https://example.com/zeta' },
    ]);

    const allResults = await fetchGitHubSkills([source]);
    const filteredResults = await fetchGitHubSkills([source], 'zeta');

    expect(allResults).toHaveLength(2);
    expect(filteredResults).toHaveLength(1);
    expect(filteredResults[0]?.id).toBe('github:test-org/test-skills-b/skills/zeta-tool');
  });
});

describe('filterSkillEntries', () => {
  it('按查询与分类过滤缓存条目', () => {
    const entries = [
      {
        id: 'alpha',
        name: 'alpha-tool',
        displayName: 'Alpha Tool',
        version: '1.0.0',
        description: '同步 GitHub issue 的工具',
        category: 'automation' as const,
        sourceId: 'community-a',
        tags: ['github'],
      },
      {
        id: 'beta',
        name: 'beta-tool',
        displayName: 'Beta Tool',
        version: '1.0.0',
        description: '写作辅助技能',
        category: 'creative' as const,
        sourceId: 'community-b',
        tags: ['writing'],
      },
    ];

    expect(filterSkillEntries(entries, 'github', 'automation')).toEqual([entries[0]]);
    expect(filterSkillEntries(entries, 'beta')).toEqual([entries[1]]);
    expect(filterSkillEntries(entries, undefined, 'creative')).toEqual([entries[1]]);
  });
});
