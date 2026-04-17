// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTeamSessionModal } from './NewTeamSessionModal.js';

const mockUseTeamRuntimeRoleBindings = vi.fn();
const mockUseTeamRuntimeReferenceViewData = vi.fn();

vi.mock('./use-team-runtime-role-bindings.js', () => ({
  useTeamRuntimeRoleBindings: () => mockUseTeamRuntimeRoleBindings(),
}));

vi.mock('./team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => mockUseTeamRuntimeReferenceViewData(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  mockUseTeamRuntimeRoleBindings.mockReturnValue({
    agents: [
      { id: 'oracle', label: 'Oracle', enabled: true },
      { id: 'librarian', label: 'Librarian', enabled: true },
      { id: 'hephaestus', label: 'Hephaestus', enabled: true },
      { id: 'momus', label: 'Momus', enabled: true },
      { id: 'atlas', label: 'Atlas', enabled: true },
    ],
    error: null,
    loading: false,
    roleCards: [
      {
        role: 'planner',
        roleLabel: '规划',
        selectedAgentId: 'oracle',
        selectedAgent: null,
        recommendedCapabilities: [],
      },
      {
        role: 'researcher',
        roleLabel: '研究',
        selectedAgentId: 'librarian',
        selectedAgent: null,
        recommendedCapabilities: [],
      },
      {
        role: 'executor',
        roleLabel: '执行',
        selectedAgentId: 'hephaestus',
        selectedAgent: null,
        recommendedCapabilities: [],
      },
      {
        role: 'reviewer',
        roleLabel: '审查',
        selectedAgentId: 'momus',
        selectedAgent: null,
        recommendedCapabilities: [],
      },
    ],
    setBinding: vi.fn(),
  });
  mockUseTeamRuntimeReferenceViewData.mockReturnValue({
    templateLoading: false,
    templates: [
      {
        id: 'workflow-1',
        name: '研究团队模板',
        description: 'team-playbook',
        badges: [
          { label: '系统默认', tone: 'accent' },
          { label: '推荐起步', tone: 'accent' },
          { label: '完整', tone: 'success' },
          { label: '+1 增援', tone: 'warning' },
        ],
        category: 'team-playbook',
        metaLine:
          '重点：全流程交付 · 适用：复杂跨模块需求、需要完整交付闭环的开发任务 · 增援：Atlas',
        metadata: {
          teamTemplate: {
            defaultBindings: {
              planner: 'oracle',
              researcher: 'librarian',
            },
            defaultProvider: 'claude-code',
            optionalAgentIds: ['atlas'],
            requiredRoles: ['planner', 'researcher'],
          },
        },
        nodes: [],
        edges: [],
      },
    ],
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

async function renderModal(onSubmitDraft = vi.fn(async () => undefined)) {
  await act(async () => {
    root!.render(
      <NewTeamSessionModal
        onClose={vi.fn()}
        onSubmitDraft={onSubmitDraft}
        teamWorkspaceId="workspace-1"
        workspaceLabel="研究工作区"
      />,
    );
    await Promise.resolve();
  });
}

function getButtonByText(text: string) {
  return Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('NewTeamSessionModal', () => {
  it('shows workspace context and the fixed core role step', async () => {
    await renderModal();

    expect(container?.textContent).toContain('当前工作区：研究工作区');

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('会话标题');
    expect(container?.textContent).toContain('该核心角色使用系统固定 agent，用户不可修改。');
    expect(container?.querySelectorAll('select')).toHaveLength(0);
  });

  it('renders review summary after completing blank flow selections', async () => {
    await renderModal();

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    const titleInput = container?.querySelector('#new-team-session-title') as HTMLInputElement;
    await act(async () => {
      setInputValue(titleInput, '研究团队 2026-04-16');
      await Promise.resolve();
    });

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    await act(async () => {
      getButtonByText('Atlas')?.click();
      await Promise.resolve();
    });

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('确认配置');
    expect(container?.textContent).toContain('研究团队 2026-04-16');
    expect(container?.textContent).toContain('oracle');
    expect(container?.textContent).toContain('Atlas');
  });

  it('shows saved templates and prefills the draft when one is selected', async () => {
    await renderModal();

    expect(container?.textContent).toContain('已保存模板');
    expect(container?.textContent).toContain('研究团队模板');
    expect(container?.textContent).toContain('系统默认');
    expect(container?.textContent).toContain('推荐起步');
    expect(container?.textContent).toContain('完整');
    expect(container?.textContent).toContain('+1 增援');
    expect(container?.textContent).toContain('重点：全流程交付');

    await act(async () => {
      getButtonByText('研究团队模板')?.click();
      await Promise.resolve();
    });

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('oracle');
    expect(container?.textContent).toContain('librarian');

    await act(async () => {
      const titleInput = container?.querySelector('#new-team-session-title') as HTMLInputElement;
      setInputValue(titleInput, '模板会话');
      await Promise.resolve();
    });

    await act(async () => {
      getButtonByText('下一步')?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('Atlas');
  });
});
