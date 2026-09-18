// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  resolveFusionBrowserPreviewRoute,
  useOpenFusionBrowserPreview,
  type OpenFusionBrowserPreviewOptions,
} from './use-fusion-browser-preview.js';

const PREVIEW_URL = 'http://localhost:4000';

function resetUiState(): void {
  useUIStateStore.setState({
    browserPreviewUrlByWorkspace: {},
    editorFullScreen: false,
    editorMode: false,
    editorPaneTabByWorkspace: {},
    reviewPanelOpened: false,
    sidePanelActiveTab: 'review',
  });
}

interface OpenerSpies {
  readonly collapseWorkspaceToPanel: Mock<() => void>;
  readonly openPreviewPanel: Mock<() => void>;
  readonly setBrowserPreviewUrl: Mock<(url: string | null) => void>;
  readonly setEditorMode: Mock<(value: boolean) => void>;
  readonly setEditorPaneTab: Mock<(tab: 'code' | 'browser') => void>;
}

function renderOpener(
  overrides: Partial<OpenFusionBrowserPreviewOptions> = {},
): OpenerSpies & { readonly result: { readonly current: () => void } } {
  // 与 ChatPage 的 openWorkspacePanelTab('preview') 同语义：打开面板并切到预览一级 tab。
  const openPreviewPanel = vi.fn(() => {
    useUIStateStore.getState().setSidePanelActiveTab('preview');
  });
  const spies: OpenerSpies = {
    collapseWorkspaceToPanel: vi.fn<() => void>(),
    openPreviewPanel,
    setBrowserPreviewUrl: vi.fn<(url: string | null) => void>(),
    setEditorMode: vi.fn<(value: boolean) => void>(),
    setEditorPaneTab: vi.fn<(tab: 'code' | 'browser') => void>(),
  };
  const options: OpenFusionBrowserPreviewOptions = {
    browserPreviewUrl: null,
    dockOwnsWorkspacePanels: true,
    editorMode: false,
    ...spies,
    ...overrides,
    openPreviewPanel,
  };

  const { result } = renderHook(() => useOpenFusionBrowserPreview(options));
  return { ...spies, openPreviewPanel, result };
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('resolveFusionBrowserPreviewRoute', () => {
  it('桌面 Fusion 只路由到停靠面板的预览一级 tab，不携带任何地址兜底', () => {
    expect(
      resolveFusionBrowserPreviewRoute({
        dockOwnsWorkspacePanels: true,
        hasPreviewUrl: false,
        workspacePromoted: false,
      }),
    ).toEqual({ kind: 'dock', returnToPanel: false });

    expect(
      resolveFusionBrowserPreviewRoute({
        dockOwnsWorkspacePanels: true,
        hasPreviewUrl: false,
        workspacePromoted: true,
      }),
    ).toEqual({ kind: 'dock', returnToPanel: true });
  });

  it('经典布局 / 移动端走主内容区，仅在无地址时填兜底地址', () => {
    const routeWithoutUrl = resolveFusionBrowserPreviewRoute({
      dockOwnsWorkspacePanels: false,
      hasPreviewUrl: false,
      workspacePromoted: false,
    });
    expect(routeWithoutUrl).toEqual({ kind: 'main-area', fillDefaultUrl: true });
    expect('url' in routeWithoutUrl).toBe(false);

    expect(
      resolveFusionBrowserPreviewRoute({
        dockOwnsWorkspacePanels: false,
        hasPreviewUrl: true,
        workspacePromoted: true,
      }),
    ).toEqual({ kind: 'main-area', fillDefaultUrl: false });
  });
});

describe('useOpenFusionBrowserPreview', () => {
  it('桌面 Fusion：落到预览一级 tab，绝不伪造默认地址', () => {
    const { result, ...spies } = renderOpener();

    result.current();

    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('preview');
    expect(spies.openPreviewPanel).toHaveBeenCalledTimes(1);
    expect(spies.collapseWorkspaceToPanel).not.toHaveBeenCalled();
    expect(spies.setBrowserPreviewUrl).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace).toEqual({});
    expect(spies.setEditorMode).not.toHaveBeenCalled();
    expect(spies.setEditorPaneTab).not.toHaveBeenCalled();
  });

  it('桌面 Fusion 已提升：先收回面板再落到预览一级 tab', () => {
    const { result, ...spies } = renderOpener({ editorMode: true });

    result.current();

    expect(spies.collapseWorkspaceToPanel).toHaveBeenCalledTimes(1);
    expect(spies.openPreviewPanel).toHaveBeenCalledTimes(1);
    expect(spies.collapseWorkspaceToPanel.mock.invocationCallOrder[0]).toBeLessThan(
      spies.openPreviewPanel.mock.invocationCallOrder[0] ?? 0,
    );
    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('preview');
    expect(spies.setBrowserPreviewUrl).not.toHaveBeenCalled();
  });

  it('桌面 Fusion 已有地址：同样只路由到面板预览，不写地址', () => {
    const { result, ...spies } = renderOpener({ browserPreviewUrl: PREVIEW_URL });

    result.current();

    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('preview');
    expect(spies.setBrowserPreviewUrl).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace).toEqual({});
  });

  it('经典布局 / 移动端无地址：保留兜底地址并打开主内容区浏览器', () => {
    const { result, ...spies } = renderOpener({ dockOwnsWorkspacePanels: false });

    result.current();

    expect(spies.setBrowserPreviewUrl).toHaveBeenCalledWith(DEFAULT_BROWSER_PREVIEW_URL);
    expect(spies.setEditorMode).toHaveBeenCalledWith(true);
    expect(spies.setEditorPaneTab).toHaveBeenCalledWith('browser');
    expect(spies.openPreviewPanel).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('review');
  });

  it('经典布局 / 移动端已有地址：不再填入兜底地址', () => {
    const { result, ...spies } = renderOpener({
      browserPreviewUrl: PREVIEW_URL,
      dockOwnsWorkspacePanels: false,
    });

    result.current();

    expect(spies.setBrowserPreviewUrl).not.toHaveBeenCalled();
    expect(spies.setEditorMode).toHaveBeenCalledWith(true);
    expect(spies.setEditorPaneTab).toHaveBeenCalledWith('browser');
  });
});
