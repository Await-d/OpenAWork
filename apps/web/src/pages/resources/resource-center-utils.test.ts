import { describe, expect, it } from 'vitest';
import type { ResourceCatalog } from '@openAwork/web-client';
import { filterResourceItems, splitResourceCenterItems } from './resource-center-utils.js';

const resources = {
  skills: [
    {
      id: 'skill-pdf',
      name: 'pdf',
      title: 'PDF',
      description: 'PDF 处理',
      integration: 'builtin',
      visibility: 'catalog',
      feature: 'skills',
      usageKind: 'skill',
      path: '/resources/skills/builtin/pdf.md',
      content: '处理 PDF',
      capabilities: ['document.pdf'],
      permissions: [],
    },
  ],
  agents: [],
  agentTemplates: [
    {
      id: 'template-soul',
      name: 'SOUL',
      title: 'SOUL.md',
      description: '团队人设模板',
      integration: 'reference',
      visibility: 'feature',
      feature: 'team',
      usageKind: 'agent-template',
      path: '/resources/agents/reference/templates/SOUL.md',
      content: '模板内容',
    },
  ],
  commands: [
    {
      id: 'resource-command-review',
      name: 'review',
      title: '/review',
      description: '参考命令模板',
      integration: 'reference',
      visibility: 'feature',
      feature: 'commands',
      usageKind: 'command-definition',
      path: '/resources/commands/reference/review.md',
      content: 'review template',
    },
  ],
  souls: [
    {
      id: 'soul-balanced',
      name: 'balanced-collaborator',
      title: 'Balanced Collaborator',
      description: '通道人设',
      integration: 'reference',
      visibility: 'feature',
      feature: 'channels',
      usageKind: 'channel-persona',
      path: '/resources/souls/reference/balanced-collaborator.md',
      content: '人设内容',
    },
  ],
  prompts: [
    {
      id: 'resource-prompt-codex-instructions',
      name: 'codex-instructions',
      title: 'Codex Instructions',
      description: '运行时提示词材料',
      integration: 'reference',
      visibility: 'feature',
      feature: 'prompts',
      usageKind: 'runtime-instruction',
      path: '/resources/prompts/reference/codex-instructions.md',
      content: 'prompt material',
    },
  ],
  extensions: [],
  mcps: [],
} satisfies ResourceCatalog;

describe('resource-center-utils', () => {
  it('把主目录资源和功能专用资源分开展示', () => {
    const { catalogItems, featureItems } = splitResourceCenterItems(resources);

    expect(catalogItems.map((item) => item.id)).toEqual(['skill-pdf']);
    expect(featureItems.map((item) => item.id).sort()).toEqual([
      'resource-command-review',
      'resource-prompt-codex-instructions',
      'soul-balanced',
      'template-soul',
    ]);
    expect(featureItems.find((item) => item.id === 'soul-balanced')).toMatchObject({
      area: 'souls',
      feature: 'channels',
      usageKind: 'channel-persona',
    });
  });

  it('把命令和提示词标记为模板材料而不是可执行入口', () => {
    const { featureItems } = splitResourceCenterItems(resources);

    expect(featureItems.find((item) => item.id === 'resource-command-review')).toMatchObject({
      area: 'commands',
      meta: '参考命令模板 · 不自动执行',
      usageKind: 'command-definition',
    });
    expect(
      featureItems.find((item) => item.id === 'resource-prompt-codex-instructions'),
    ).toMatchObject({
      area: 'prompts',
      meta: '运行提示词材料 · 按功能显式注入',
      usageKind: 'runtime-instruction',
    });
  });

  it('功能区仍支持按 area 和关键词检索', () => {
    const { featureItems } = splitResourceCenterItems(resources);

    expect(filterResourceItems(featureItems, 'souls', 'balanced').map((item) => item.id)).toEqual([
      'soul-balanced',
    ]);
    expect(
      filterResourceItems(featureItems, 'agentTemplates', 'SOUL').map((item) => item.id),
    ).toEqual(['template-soul']);
  });
});
