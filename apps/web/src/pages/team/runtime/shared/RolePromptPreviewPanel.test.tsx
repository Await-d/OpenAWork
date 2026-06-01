// @vitest-environment jsdom
/**
 * 260531 · RolePromptPreviewPanel smoke
 *
 * 覆盖只读预览面板：不支持的层显示空态、SOUL/指令栈双模式切换、关闭回调。
 * mock 掉取数 hook 与 markdown 渲染，专注面板自身交互。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TeamRolePromptPreviewState } from '../hooks/use-team-role-prompt-preview.js';

function makeBaselineState(): TeamRolePromptPreviewState {
  return {
    supported: true,
    loading: false,
    error: null,
    persona: {
      roleLayer: 'executor',
      key: 'default',
      persona: null,
      effective: {
        soulMd: [
          '---',
          'identity: 执行 Agent',
          'tone: 务实',
          'focus:',
          '  - 小步前进',
          '  - 透明可观察',
          'output_style: 三段式交付',
          '---',
          '',
          '# 执行 Agent SOUL',
          '执行层 SOUL 正文',
        ].join('\n'),
        isDefault: true,
      },
    },
    instructionStack: {
      stableBlock: 'STABLE BLOCK PREVIEW',
      estimatedTokens: 999,
      oversize: false,
      layers: {
        agentsMd: true,
        architectureMd: false,
        constitution: true,
        projectMemory: false,
        lessonsLearned: false,
        userMemory: false,
        soul: true,
      },
    },
    capability: {
      layer: 'executor',
      adapterDisplayName: '执行（默认）',
      agentImplKey: 'executor',
      toolsetCategories: [
        { id: 'read', label: '读取', description: '文件读取 / grep / glob', defaultEnabled: true },
        { id: 'write', label: '写入', description: '文件写入 / edit', defaultEnabled: true },
        { id: 'shell', label: '命令行', description: 'bash / 终端执行', defaultEnabled: true },
      ],
      canHandoffTo: [],
      canWriteArtifactPhases: ['implementation', 'patch'],
      allowedBuiltinInstructions: ['report_progress', 'submit_patch'],
      terminal: true,
    },
    refresh: vi.fn(),
  };
}

const previewState: { current: TeamRolePromptPreviewState } = {
  current: makeBaselineState(),
};

vi.mock('../hooks/use-team-role-prompt-preview.js', () => ({
  useTeamRolePromptPreview: () => previewState.current,
  mapTeamLayerToSoulLayer: (layer: string) =>
    ['reception', 'pm1', 'pm2', 'executor', 'reviewer'].includes(layer) ? layer : null,
}));

const putPersonaMock = vi.fn(() =>
  Promise.resolve({
    id: 'p1',
    roleLayer: 'executor',
    key: 'default',
    soulMd: '# edited',
    createdAt: '',
    updatedAt: '',
  }),
);

const listDefaultSoulsMock = vi.fn(() =>
  Promise.resolve([
    {
      roleLayer: 'executor',
      key: 'default',
      displayName: '执行 · Executor',
      summary: '',
      soulMd: '# 默认执行 SOUL',
    },
  ]),
);

const resetPersonaMock = vi.fn(() =>
  Promise.resolve({
    roleLayer: 'executor',
    key: 'default',
    persona: {
      id: 'p1',
      roleLayer: 'executor',
      key: 'default',
      soulMd: '# 默认执行 SOUL',
      createdAt: '',
      updatedAt: '',
    },
    effective: { soulMd: '# 默认执行 SOUL', isDefault: false },
  }),
);

vi.mock('@openAwork/web-client', () => ({
  createTeamPhaseAClient: () => ({
    putPersona: putPersonaMock,
    listDefaultSouls: listDefaultSoulsMock,
    resetPersona: resetPersonaMock,
  }),
}));

vi.mock('../../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (s: { accessToken: string; gatewayUrl: string }) => unknown) =>
    selector({ accessToken: 'tok', gatewayUrl: 'http://gw' }),
}));

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { RolePromptPreviewPanel } from './RolePromptPreviewPanel.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  previewState.current = makeBaselineState();
});

describe('RolePromptPreviewPanel', () => {
  it('layer=null 时不渲染任何内容', () => {
    const { container } = render(<RolePromptPreviewPanel layer={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('默认「画像」模式从 frontmatter 渲染 5 维度', () => {
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    expect(screen.getByText('身份定位')).toBeTruthy();
    expect(screen.getByText('语气基调')).toBeTruthy();
    expect(screen.getByText('默认 SOUL')).toBeTruthy();
  });

  it('「原文」模式展示字面 SOUL 文本并提供复制', () => {
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    fireEvent.click(screen.getByText('原文'));
    expect(screen.getByText(/identity:/)).toBeTruthy();
    expect(screen.getByText('复制全文')).toBeTruthy();
  });

  it('切到「指令栈」展示稳定块与 token', () => {
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    fireEvent.click(screen.getByText('指令栈'));
    expect(screen.getByText('STABLE BLOCK PREVIEW')).toBeTruthy();
    expect(screen.getByText(/999/)).toBeTruthy();
  });

  it('「指令栈」把 team-instruction 标签拆成按层折叠片段', () => {
    previewState.current = {
      ...previewState.current,
      instructionStack: {
        stableBlock: [
          '<team-instruction layer="constitution">',
          '# 团队宪法正文',
          '</team-instruction>',
          '<team-instruction layer="cache-breaker" tag="x1" />',
        ].join('\n'),
        estimatedTokens: 1200,
        oversize: false,
        layers: {
          agentsMd: false,
          architectureMd: false,
          constitution: true,
          projectMemory: false,
          lessonsLearned: false,
          userMemory: false,
          soul: false,
        },
      },
    };
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    fireEvent.click(screen.getByText('指令栈'));
    // 片段卡标题用中文标签 + 原始 layer 名（中文标签也出现在层徽章里，故用 getAllByText）
    expect(screen.getAllByText('团队宪法').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('constitution')).toBeTruthy();
    expect(screen.getByText('# 团队宪法正文')).toBeTruthy();
  });

  it('切到「能力」展示工具类别与默认启用标记', () => {
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    fireEvent.click(screen.getByText('能力'));
    expect(screen.getByText('工具类别（能力天花板）')).toBeTruthy();
    expect(screen.getByText('命令行')).toBeTruthy();
    expect(screen.getAllByText('默认启用').length).toBeGreaterThanOrEqual(1);
  });

  it('点击关闭触发 onClose', () => {
    const onClose = vi.fn();
    render(<RolePromptPreviewPanel layer="executor" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭预览'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('默认（只读）不显示「编辑」入口', () => {
    render(<RolePromptPreviewPanel layer="executor" onClose={() => {}} />);
    expect(screen.queryByText('✎ 编辑')).toBeNull();
  });

  it('默认 SOUL（isDefault）不显示「恢复为最新默认」', () => {
    render(<RolePromptPreviewPanel layer="executor" editable onClose={() => {}} />);
    expect(screen.queryByText(/恢复为最新默认/)).toBeNull();
  });

  it('自定义 SOUL（!isDefault）显示「恢复为最新默认」并调用 resetPersona', async () => {
    previewState.current = {
      ...previewState.current,
      persona: {
        roleLayer: 'executor',
        key: 'default',
        persona: null,
        effective: { soulMd: '# 我的自定义 SOUL', isDefault: false },
      },
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RolePromptPreviewPanel layer="executor" editable onClose={() => {}} />);
    const resetBtn = screen.getByText(/恢复为最新默认/);
    expect(resetBtn).toBeTruthy();
    fireEvent.click(resetBtn);
    await Promise.resolve();
    await Promise.resolve();
    expect(resetPersonaMock).toHaveBeenCalledWith('tok', 'executor');
    confirmSpy.mockRestore();
  });

  it('editable 时点击「编辑」进入编辑态并保存调用 putPersona', async () => {
    render(<RolePromptPreviewPanel layer="executor" editable onClose={() => {}} />);
    fireEvent.click(screen.getByText('✎ 编辑'));
    const textarea = screen.getByLabelText('SOUL 编辑器') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: '# 我改过的 SOUL' } });
    fireEvent.click(screen.getByText('保存'));
    expect(putPersonaMock).toHaveBeenCalledWith('tok', 'executor', {
      soulMd: '# 我改过的 SOUL',
    });
  });

  it('切换层级时丢弃未保存的编辑草稿（回到只读）', () => {
    const { rerender } = render(
      <RolePromptPreviewPanel layer="executor" editable onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText('✎ 编辑'));
    fireEvent.change(screen.getByLabelText('SOUL 编辑器'), {
      target: { value: '# executor 草稿' },
    });
    // 切到另一层：草稿必须被丢弃，回到只读（再次出现「编辑」入口、无编辑器）。
    rerender(<RolePromptPreviewPanel layer="reviewer" editable onClose={() => {}} />);
    expect(screen.queryByLabelText('SOUL 编辑器')).toBeNull();
    expect(screen.getByText('✎ 编辑')).toBeTruthy();
  });

  it('编辑中按 Esc 退出编辑但不关闭面板；非编辑态 Esc 关闭面板', () => {
    const onClose = vi.fn();
    render(<RolePromptPreviewPanel layer="executor" editable onClose={onClose} />);
    // 进入编辑后按 Esc：退出编辑，不触发 onClose。
    fireEvent.click(screen.getByText('✎ 编辑'));
    expect(screen.getByLabelText('SOUL 编辑器')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('SOUL 编辑器')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // 已回到只读，再按 Esc：关闭面板。
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('不支持的层显示空态', () => {
    previewState.current = { ...previewState.current, supported: false };
    render(<RolePromptPreviewPanel layer="tester" onClose={() => {}} />);
    expect(screen.getByText('该层无独立角色提示词')).toBeTruthy();
  });
});
