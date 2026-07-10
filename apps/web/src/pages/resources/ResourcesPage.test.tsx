// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResourceCatalog } from '@openAwork/web-client';
import ResourcesPage from './ResourcesPage.js';

const resources = vi.hoisted(
  () =>
    ({
      skills: [
        {
          id: 'skill-pdf',
          name: 'pdf',
          title: 'PDF Skill',
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
          title: '稳健协作者',
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
      mcps: [
        {
          id: 'mcp-codegraph',
          name: 'codegraph',
          title: 'Codegraph MCP',
          description: '代码图谱服务',
          integration: 'builtin',
          visibility: 'catalog',
          feature: 'mcps',
          usageKind: 'mcp-server',
          path: '/resources/mcps/builtin/codegraph.md',
          content: 'codegraph server',
          builtinKind: 'virtual',
          enabledByDefault: true,
          transport: 'stdio',
        },
      ],
    }) satisfies ResourceCatalog,
);

vi.mock('../../hooks/resources/useResourceCatalog.js', () => ({
  useResourceCatalog: () => ({
    deletingId: null,
    error: null,
    loading: false,
    mutating: false,
    reload: vi.fn(),
    removeResource: vi.fn(),
    resources,
    uploadResource: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

describe('ResourcesPage', () => {
  it('默认展示主资源目录并把通道人设放在功能专用区', () => {
    render(<ResourcesPage />);

    expect(screen.getByRole('heading', { name: '主资源目录' })).not.toBeNull();
    expect(screen.getAllByText('PDF Skill')).toHaveLength(2);
    expect(screen.queryByText('稳健协作者')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /功能专用资源/ }));

    expect(screen.getByRole('heading', { name: '功能专用资源' })).not.toBeNull();
    expect(screen.getByText('稳健协作者')).not.toBeNull();
    expect(screen.getAllByText('SOUL.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Codex Instructions').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /\/review/ }));
    expect(screen.getByText('参考命令模板 · 不自动执行')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Codex Instructions/ }));
    expect(screen.getByText('运行提示词材料 · 按功能显式注入')).not.toBeNull();
  });

  it('Skill 和 MCP 资源只显示管理边界，不在资源中心复制启停状态', () => {
    render(<ResourcesPage />);

    fireEvent.click(screen.getByRole('button', { name: /PDF Skill/ }));

    expect(screen.getByText('生命周期在技能管理页')).not.toBeNull();
    expect(screen.getByRole('link', { name: '管理已安装技能' }).getAttribute('href')).toBe(
      '/settings/plugins?plugin=skills',
    );
    expect(screen.getByRole('link', { name: '打开技能市场' }).getAttribute('href')).toBe('/skills');

    fireEvent.click(screen.getByRole('button', { name: /Codegraph MCP/ }));

    expect(screen.getByText('运行状态在 MCP 设置页')).not.toBeNull();
    expect(screen.getByRole('link', { name: '管理 MCP 服务器' }).getAttribute('href')).toBe(
      '/settings/plugins?plugin=mcp',
    );
  });
});
