// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resetResult = {
  roleLayer: 'reception',
  key: 'default',
  persona: {
    id: 'persona-1',
    roleLayer: 'reception',
    key: 'default',
    soulMd: '# 默认接待 SOUL',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
  },
  effective: {
    soulMd: '# 默认接待 SOUL',
    isDefault: true,
  },
} as const;

const mocks = vi.hoisted(() => ({
  applyConstitution: vi.fn(),
  applyMemory: vi.fn(),
  applyPersonaResponse: vi.fn(),
  applyState: vi.fn(),
  forceApply: vi.fn(),
  previewInstructionStack: vi.fn(),
  putConstitution: vi.fn(),
  putPersona: vi.fn(),
  putUserMemory: vi.fn(),
  refresh: vi.fn(),
  resetPersona: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  HttpError: class HttpError extends Error {
    readonly data: unknown;
    readonly status: number;

    constructor(status: number, data: unknown = null) {
      super(`HTTP ${status}`);
      this.status = status;
      this.data = data;
    }
  },
  createTeamPhaseAClient: () => ({
    forceApply: mocks.forceApply,
    putConstitution: mocks.putConstitution,
    putPersona: mocks.putPersona,
    putUserMemory: mocks.putUserMemory,
    resetPersona: mocks.resetPersona,
  }),
}));

vi.mock('./use-team-phase-a-settings-read-model.js', () => ({
  useRecoverableConstitutionRead: () => ({
    applyConstitution: mocks.applyConstitution,
    constitution: {
      teamWorkspaceId: 'workspace-alpha',
      body: '# 团队宪法',
      version: 1,
      updatedAt: '2026-07-07T00:00:00.000Z',
    },
    error: null,
    loading: false,
    templates: [],
  }),
  useRecoverableForceApplyStateRead: () => ({
    applyState: mocks.applyState,
    error: null,
    loading: false,
    refresh: mocks.refresh,
    state: {
      usedInWindow: 0,
      maxInWindow: 5,
      lastAppliedAt: null,
    },
  }),
  useRecoverablePersonaRead: () => ({
    applyPersonaResponse: mocks.applyPersonaResponse,
    error: null,
    loading: false,
    personaResponse: {
      roleLayer: 'reception',
      key: 'default',
      persona: {
        id: 'persona-custom',
        roleLayer: 'reception',
        key: 'default',
        soulMd: '# 自定义接待 SOUL',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
      },
      effective: {
        soulMd: '# 自定义接待 SOUL',
        isDefault: false,
      },
    },
  }),
  useRecoverableUserMemoryRead: () => ({
    applyMemory: mocks.applyMemory,
    error: null,
    loading: false,
    memory: {
      body: '用户记忆',
      updatedAt: '2026-07-07T00:00:00.000Z',
    },
  }),
  useInstructionStackPreviewRead: () => ({
    busy: false,
    error: null,
    preview: null,
    previewInstructionStack: mocks.previewInstructionStack,
  }),
}));

vi.mock('./team-default-roster-section.js', () => ({
  TeamDefaultRosterSection: () => <div data-testid="default-roster-section" />,
}));

vi.mock('../../shared/WorkflowEditor.js', () => ({
  AdapterConfigPanel: () => <div data-testid="adapter-config-panel" />,
}));

vi.mock('../../shell/modals/NewTeamTemplateModal.js', () => ({
  NewTeamTemplateModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      关闭模板管理
    </button>
  ),
}));

import { TeamRuntimeSettingsPanel } from './team-runtime-settings-panel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('TeamRuntimeSettingsPanel', () => {
  it('确认后恢复角色 SOUL 默认值并回填编辑器', async () => {
    mocks.resetPersona.mockResolvedValue(resetResult);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <TeamRuntimeSettingsPanel
        accessToken="token-1"
        gatewayUrl="https://gw.test"
        teamWorkspaceId="workspace-alpha"
      />,
    );

    await screen.findByDisplayValue('# 自定义接待 SOUL');

    fireEvent.click(screen.getByRole('button', { name: '重置为默认' }));

    await waitFor(() => {
      expect(mocks.resetPersona).toHaveBeenCalledWith('token-1', 'reception');
    });
    expect(mocks.applyPersonaResponse).toHaveBeenCalledWith(resetResult);
    expect(screen.getByDisplayValue('# 默认接待 SOUL')).toBeTruthy();
    expect(screen.getByText('已恢复为最新默认')).toBeTruthy();

    confirmSpy.mockRestore();
  });
});
