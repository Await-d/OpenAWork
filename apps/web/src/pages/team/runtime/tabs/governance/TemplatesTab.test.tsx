// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplatesTab } from './TemplatesTab.js';

const state = vi.hoisted(() => ({
  canCreateSession: true,
  canCreateTemplate: true,
  templateCount: 1,
  templateError: null as string | null,
  templateLoading: false,
  templates: [
    {
      id: 'tpl-1',
      name: '代码评审模板',
      description: '用于代码评审流程',
      category: 'team-playbook',
      badges: [{ label: '推荐', tone: 'accent' as const }],
      metaLine: '1 个阶段',
      nodes: [
        {
          id: 'node-1',
          type: 'subagent',
          label: '负责人 · PM1',
        },
      ],
      edges: [],
      metadata: {
        teamTemplate: {
          defaultBindings: {},
          defaultProvider: null,
          optionalAgentIds: [],
        },
      },
    },
  ],
}));

const onUseTemplateMock = vi.fn();
const templateDetailViewMock = vi.hoisted(() => vi.fn());

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    canCreateSession: state.canCreateSession,
    canCreateTemplate: state.canCreateTemplate,
    duplicateTemplate: vi.fn(async () => true),
    busy: false,
    removeTemplate: vi.fn(async () => true),
    templateCount: state.templateCount,
    templateError: state.templateError,
    templateLoading: state.templateLoading,
    templates: state.templates,
    updateTemplate: vi.fn(async () => true),
  }),
}));

vi.mock('../../shell/modals/NewTeamTemplateModal.js', () => ({
  NewTeamTemplateModal: () => null,
}));

vi.mock('./TemplateDetailView.js', () => ({
  TemplateDetailView: (props: Record<string, unknown>) => {
    templateDetailViewMock(props);
    return <div data-testid="template-detail-view" data-editable={String(props['editable'])} />;
  },
}));

vi.mock('./TemplateEditorPanel.js', () => ({
  TemplateEditor: () => <div data-testid="template-editor" />,
  templateDataToEditorState: vi.fn(() => ({
    name: '代码评审模板',
    description: '用于代码评审流程',
    metadata: {
      teamTemplate: {
        defaultBindings: {},
        defaultProvider: null,
        optionalAgentIds: [],
      },
    },
  })),
  editorStateToTemplateData: vi.fn((stateValue) => stateValue),
}));

describe('TemplatesTab', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    templateDetailViewMock.mockReset();
    state.canCreateSession = true;
    state.canCreateTemplate = true;
    state.templateCount = 1;
    state.templateError = null;
    state.templateLoading = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('即使不能创建模板，只要能创建会话，仍允许使用模板创建会话', async () => {
    state.canCreateTemplate = false;
    state.canCreateSession = true;

    render(<TemplatesTab onUseTemplate={onUseTemplateMock} />);

    fireEvent.click(screen.getByRole('button', { name: /代码评审模板/i }));

    const useButton = screen.getByRole('button', { name: '使用此模板创建会话' });
    expect(useButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(useButton);

    await waitFor(() => {
      expect(onUseTemplateMock).toHaveBeenCalledWith('tpl-1');
    });
  });

  it('不能创建会话时，禁用“使用模板创建会话”按钮', () => {
    state.canCreateTemplate = true;
    state.canCreateSession = false;

    render(<TemplatesTab onUseTemplate={onUseTemplateMock} />);

    fireEvent.click(screen.getByRole('button', { name: /代码评审模板/i }));

    expect(
      screen.getByRole('button', { name: '使用此模板创建会话' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('即使能创建模板，无有效会话创建能力时也不会误放开“使用模板创建会话”', () => {
    state.canCreateTemplate = true;
    state.canCreateSession = false;

    render(<TemplatesTab onUseTemplate={onUseTemplateMock} />);

    fireEvent.click(screen.getByRole('button', { name: /代码评审模板/i }));
    fireEvent.click(screen.getByRole('button', { name: '使用此模板创建会话' }));

    expect(onUseTemplateMock).not.toHaveBeenCalled();
  });

  it('不能创建模板时，模板详情区保留只读查看，并以 editable=false 传给详情视图', () => {
    state.canCreateTemplate = false;
    state.canCreateSession = true;

    render(<TemplatesTab onUseTemplate={onUseTemplateMock} />);

    fireEvent.click(screen.getByRole('button', { name: /代码评审模板/i }));

    expect(screen.getByTestId('template-detail-view').getAttribute('data-editable')).toBe('false');
    expect(templateDetailViewMock).toHaveBeenCalled();
  });
});
