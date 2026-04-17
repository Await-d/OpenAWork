// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTeamTemplateModal } from './NewTeamTemplateModal.js';

const mockCreateTemplate = vi.fn(async () => true);
const mockUseTeamRuntimeReferenceViewData = vi.fn();
const mockUseTeamRuntimeRoleBindings = vi.fn();

vi.mock('./team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => mockUseTeamRuntimeReferenceViewData(),
}));

vi.mock('./use-team-runtime-role-bindings.js', () => ({
  useTeamRuntimeRoleBindings: () => mockUseTeamRuntimeRoleBindings(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  mockCreateTemplate.mockClear();
  mockUseTeamRuntimeReferenceViewData.mockReturnValue({
    createTemplate: mockCreateTemplate,
    templateError: null,
    templateLoading: false,
  });
  mockUseTeamRuntimeRoleBindings.mockReturnValue({
    agents: [
      { id: 'oracle', label: 'Oracle', enabled: true },
      { id: 'librarian', label: 'Librarian', enabled: true },
      { id: 'hephaestus', label: 'Hephaestus', enabled: true },
      { id: 'momus', label: 'Momus', enabled: true },
      { id: 'atlas', label: 'Atlas', enabled: true },
    ],
    roleCards: [
      { role: 'planner', roleLabel: '规划', selectedAgentId: 'oracle' },
      { role: 'researcher', roleLabel: '研究', selectedAgentId: 'librarian' },
      { role: 'executor', roleLabel: '执行', selectedAgentId: 'hephaestus' },
      { role: 'reviewer', roleLabel: '审查', selectedAgentId: 'momus' },
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

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('NewTeamTemplateModal', () => {
  it('submits template metadata with fixed core bindings handled by the system', async () => {
    await act(async () => {
      root!.render(<NewTeamTemplateModal onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const titleInput = container?.querySelector('#team-template-name-input') as HTMLInputElement;
    await act(async () => {
      setInputValue(titleInput, '研究协作剧本');
      await Promise.resolve();
    });

    await act(async () => {
      const atlasButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.includes('atlas'),
      ) as HTMLButtonElement | undefined;
      atlasButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      const createButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.includes('创建模板'),
      ) as HTMLButtonElement | undefined;
      createButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateTemplate).toHaveBeenCalledWith({
      name: '研究协作剧本',
      optionalAgentIds: ['atlas'],
      provider: 'claude-code',
    });
  });

  it('shows the fixed core role summary instead of editable role selectors', async () => {
    await act(async () => {
      root!.render(<NewTeamTemplateModal onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('核心角色（系统固定）');
    expect(container?.textContent).toContain('该核心角色由系统固定绑定，用户不可修改。');
    expect(container?.querySelectorAll('select')).toHaveLength(0);
  });
});
