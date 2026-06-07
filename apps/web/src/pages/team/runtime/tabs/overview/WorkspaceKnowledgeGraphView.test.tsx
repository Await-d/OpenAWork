// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mockLayerNodes = new Map<string, { roleLayer: string }>();
const mockHandoffs = new Map();
const mockArtifactsState = {
  artifacts: [] as Array<{ id: string; sessionId: string; phase: string | null; title: string }>,
  loading: false,
  error: null as string | null,
};

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useLayerStore: (selector: (state: { nodes: typeof mockLayerNodes }) => unknown) =>
    selector({ nodes: mockLayerNodes }),
  useHandoffStore: (selector: (state: { handoffs: typeof mockHandoffs }) => unknown) =>
    selector({ handoffs: mockHandoffs }),
}));

vi.mock('../../hooks/use-team-workspace-artifacts.js', () => ({
  useTeamWorkspaceArtifacts: () => mockArtifactsState,
}));

vi.mock('../../shared/RolePromptPreviewPanel.js', () => ({
  RolePromptPreviewPanel: () => null,
}));

import { WorkspaceKnowledgeGraphView } from './WorkspaceKnowledgeGraphView.js';

beforeEach(() => {
  cleanup();
  mockLayerNodes.clear();
  mockHandoffs.clear();
  mockArtifactsState.artifacts = [];
  mockArtifactsState.loading = false;
  mockArtifactsState.error = null;
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceKnowledgeGraphView', () => {
  it('加载中且暂无节点时展示加载态', () => {
    mockArtifactsState.loading = true;

    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('加载图谱中…')).toBeTruthy();
    expect(screen.getByText('正在拉取当前工作区的会话、handoff 与产物关系。')).toBeTruthy();
  });

  it('加载失败且暂无节点时展示错误态', () => {
    mockArtifactsState.error = '读取工作区产物失败';

    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('图谱加载失败')).toBeTruthy();
    expect(screen.getByText('读取工作区产物失败')).toBeTruthy();
  });

  it('无数据且非加载失败时展示空态', () => {
    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('暂无图谱数据')).toBeTruthy();
    expect(
      screen.getByText('团队启动后，会话树、层间 handoff 与工作区产物会在这里组成知识图谱。'),
    ).toBeTruthy();
  });
});
