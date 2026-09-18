// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FusionMobileBottomPanel } from './FusionMobileBottomPanel.js';
import type { FusionMobileBottomPanelProps } from './FusionMobileBottomPanel.js';

vi.mock('./FusionReviewTab.js', () => ({
  FusionReviewTab: () => <div data-testid="review-tab-stub" />,
}));

vi.mock('./FusionFilesTab.js', () => ({
  FusionFilesTab: () => <div data-testid="files-tab-stub" />,
}));

vi.mock('./FusionBrowserTab.js', () => ({
  FusionBrowserTab: () => <div data-testid="browser-tab-stub" />,
}));

vi.mock('./FusionContextTab.js', () => ({
  FusionContextTab: () => <div data-testid="context-tab-stub" />,
}));

vi.mock('./use-review-panel-file-changes.js', () => ({
  useReviewPanelFileChanges: () => ({ kind: 'loading' }),
}));

afterEach(() => {
  cleanup();
});

function createMobileProps(): Omit<FusionMobileBottomPanelProps, 'activeTab'> {
  return {
    activeEditorFilePath: null,
    contextUsageSnapshot: null,
    currentSessionId: 'session-1',
    editorMode: false,
    editorFileState: {
      activeFile: null,
      activeFilePath: null,
      closeFile: () => undefined,
      isDirty: () => false,
      openFiles: [],
      saveError: null,
      setActiveFilePath: () => undefined,
      updateContent: () => undefined,
    },
    editorOpenFilePaths: [],
    effectiveWorkingDirectory: '/home/await/project/OpenAWork',
    fetchTree: async () => [],
    gatewayUrl: 'http://localhost:3000',
    handleSaveFile: async () => undefined,
    isOpen: false,
    onClose: () => undefined,
    onOpen: () => undefined,
    onCompactSession: () => undefined,
    onOpenFileInEditor: () => undefined,
    onOpenWorkspace: () => undefined,
    onShowEditor: () => undefined,
    onTabChange: () => undefined,
    saving: false,
    token: 'token',
    workspaceFileItems: [],
  };
}

describe('FusionMobileBottomPanel', () => {
  it('移动端底部面板保留四个 tab：审查 / 文件 / Context / 浏览器', () => {
    render(<FusionMobileBottomPanel {...createMobileProps()} activeTab="review" />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '审查',
      '文件',
      'Context',
      '浏览器',
    ]);
  });

  it('移动端仍可切换到已从桌面移除的文件与浏览器 tab', () => {
    const onTabChange = vi.fn();
    const onOpen = vi.fn();

    render(
      <FusionMobileBottomPanel
        {...createMobileProps()}
        activeTab="review"
        onOpen={onOpen}
        onTabChange={onTabChange}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '文件' }));

    expect(onTabChange).toHaveBeenCalledWith('files');
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: '浏览器' }));

    expect(onTabChange).toHaveBeenCalledWith('browser');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('移动端 files / browser tab 展开时仍渲染对应内容', () => {
    const view = render(
      <FusionMobileBottomPanel {...createMobileProps()} activeTab="files" isOpen />,
    );

    expect(screen.getByTestId('files-tab-stub')).not.toBeNull();

    view.rerender(<FusionMobileBottomPanel {...createMobileProps()} activeTab="browser" isOpen />);

    expect(screen.getByTestId('browser-tab-stub')).not.toBeNull();
  });

  it('桌面专属 tab（代码/预览）落到移动端时收敛为审查，移动端 tab 清单不变', () => {
    render(<FusionMobileBottomPanel {...createMobileProps()} activeTab="code" isOpen />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '审查',
      '文件',
      'Context',
      '浏览器',
    ]);
    expect(screen.getByTestId('review-tab-stub')).not.toBeNull();
    expect(screen.getByRole('tab', { name: '审查' }).getAttribute('aria-selected')).toBe('true');
  });
});
