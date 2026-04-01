import { useState, useEffect, useCallback, useMemo } from 'react';
import NavRail from './layout/NavRail.js';
import WorkspacePickerModal from './WorkspacePickerModal.js';
import { SessionSidebar } from './layout/SessionSidebar.js';
import { CachedRouteOutlet } from './CachedRouteOutlet.js';
import { useUIStateStore } from '../stores/uiState.js';
import { useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { CommandPalette, PermissionPrompt, PermissionConfirmDialog } from '@openAwork/shared-ui';
import type { CommandItem, PermissionDecision, PermissionItem } from '@openAwork/shared-ui';
import type { FileTreeNode } from './WorkspacePickerModal.js';
import { useCommandRegistry } from '../hooks/useCommandRegistry.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { createPermissionsClient } from '@openAwork/web-client';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeSessionPendingPermission,
} from '../utils/session-list-events.js';

interface LayoutProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onOpenFile?: (path: string) => void;
}

export default function Layout({ theme = 'dark', onToggleTheme, onOpenFile }: LayoutProps = {}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  );

  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const res = await fetch(`${gatewayUrl}/workspace/root`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('fetchRootPath failed');
    const data = (await res.json()) as { root?: string; roots?: string[] };
    const roots = Array.isArray(data.roots)
      ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
      : typeof data.root === 'string' && data.root.length > 0
        ? [data.root]
        : [];

    if (roots.length === 0) {
      throw new Error('fetchRootPath failed');
    }

    return roots;
  }, [accessToken, gatewayUrl]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 1) => {
      const res = await fetch(
        `${gatewayUrl}/workspace/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error('fetchTree failed');
      const data = await res.json();
      return (data?.nodes ?? data) as FileTreeNode[];
    },
    [accessToken, gatewayUrl],
  );

  const validatePath = useCallback(
    async (path: string): Promise<{ valid: boolean; error?: string; path?: string }> => {
      const res = await fetch(`${gatewayUrl}/workspace/validate?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        return { valid: false, error: `Validation request failed: ${res.status}` };
      }

      return res.json();
    },
    [accessToken, gatewayUrl],
  );

  const uiState = useUIStateStore();
  const sidebarTab = uiState.sidebarTab;
  const setSidebarTab = uiState.setSidebarTab;
  const expandedDirsArr = uiState.expandedDirs;
  const setExpandedDirsArr = uiState.setExpandedDirs;
  const expandedDirs = new Set(expandedDirsArr);
  const leftSidebarOpen = uiState.leftSidebarOpen;
  const toggleLeftSidebar = uiState.toggleLeftSidebar;
  const setLeftSidebarOpen = uiState.setLeftSidebarOpen;
  const chatView = uiState.chatView;
  const navigateToHome = uiState.navigateToHome;
  const pinnedSessions = uiState.pinnedSessions;
  const togglePinSession = uiState.togglePinSession;
  const isPinned = uiState.isPinned;
  const selectedWorkspacePath = uiState.selectedWorkspacePath;
  const addSavedWorkspacePath = uiState.addSavedWorkspacePath;
  const setSelectedWorkspacePath = uiState.setSelectedWorkspacePath;
  const setFileTreeRootPath = uiState.setFileTreeRootPath;
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === 'function' ? updater(new Set(expandedDirsArr)) : updater;
      setExpandedDirsArr(Array.from(next));
    },
    [expandedDirsArr, setExpandedDirsArr],
  );

  const navigate = useNavigate();
  const location = useLocation();
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);
  const isChatRoute = location.pathname.startsWith('/chat');
  const currentChatSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const paletteDescriptors = useCommandRegistry('palette');

  const [pendingPermission, setPendingPermission] = useState<{
    requestId: string;
    targetSessionId: string;
    toolName: string;
    scope: string;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high';
    previewAction?: string;
  } | null>(null);
  const [pendingConfirmDialog, setPendingConfirmDialog] = useState<{
    skillName: string;
    permissions: PermissionItem[];
    trustLevel: 'full' | 'standard' | 'restricted';
  } | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setIsNarrowViewport(window.innerWidth <= 960);
      return;
    }

    const media = window.matchMedia('(max-width: 960px)');
    const updateViewportMode = () => setIsNarrowViewport(media.matches);
    updateViewportMode();
    media.addEventListener('change', updateViewportMode);
    return () => media.removeEventListener('change', updateViewportMode);
  }, []);

  useEffect(() => {
    if (isChatRoute && isNarrowViewport) {
      setLeftSidebarOpen(false);
    }
  }, [isChatRoute, isNarrowViewport, setLeftSidebarOpen]);

  useEffect(() => {
    if (!accessToken || !currentChatSessionId) {
      setPendingPermission(null);
      return;
    }

    setPendingPermission(null);

    return subscribeSessionPendingPermission((sessionId, permission) => {
      if (sessionId === currentChatSessionId) {
        setPendingPermission(permission);
      }
    });
  }, [accessToken, currentChatSessionId]);

  useEffect(() => {
    if (!accessToken || !currentChatSessionId) {
      return;
    }

    const controller = new AbortController();
    void createPermissionsClient(gatewayUrl)
      .listPending(accessToken, currentChatSessionId, { signal: controller.signal })
      .then((requests) => {
        if (controller.signal.aborted) {
          return;
        }

        const pendingRequest = requests.find((request) => request.status === 'pending');
        setPendingPermission(
          pendingRequest
            ? {
                requestId: pendingRequest.requestId,
                targetSessionId: pendingRequest.sessionId,
                toolName: pendingRequest.toolName,
                scope: pendingRequest.scope,
                reason: pendingRequest.reason,
                riskLevel: pendingRequest.riskLevel,
                previewAction: pendingRequest.previewAction,
              }
            : null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPendingPermission(null);
        }
      });

    return () => controller.abort();
  }, [accessToken, currentChatSessionId, gatewayUrl]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.metaKey || e.ctrlKey;
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen((o) => !o);
        return;
      }
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
        return;
      }
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        navigateToHome();
        preloadRoute('/chat');
        void navigate('/chat');
        return;
      }
      if (ctrl && e.key === ',') {
        e.preventDefault();
        preloadRoute('/settings');
        void navigate('/settings');
        return;
      }
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        alert('复制会话功能开发中');
        return;
      }
      if (ctrl && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const text = document.querySelector('.outlet-content-wrap')?.textContent ?? '';
        void navigator.clipboard.writeText(text);
        return;
      }
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftSidebar, navigateToHome, navigate, preloadRoute]);

  const paletteCommands = useMemo<CommandItem[]>(() => {
    return paletteDescriptors.flatMap((command) => {
      const action = command.action;

      switch (action.kind) {
        case 'navigate':
          return [
            {
              id: command.id,
              label: command.label,
              description: command.description,
              shortcut: command.shortcut,
              onExecute: () => {
                preloadRoute(action.to);
                void navigate(action.to);
              },
            },
          ];
        case 'toggle_theme':
          if (!onToggleTheme) return [];
          return [
            {
              id: command.id,
              label: command.label,
              description: theme === 'dark' ? '切换到亮色' : '切换到暗色',
              shortcut: command.shortcut,
              onExecute: onToggleTheme,
            },
          ];
        default:
          return [];
      }
    });
  }, [navigate, onToggleTheme, paletteDescriptors, preloadRoute, theme]);

  const shouldOverlaySessionSidebar = isChatRoute && isNarrowViewport;
  const sessionSidebarWidth = shouldOverlaySessionSidebar
    ? 'min(86vw, var(--sidebar-width, 260px))'
    : 'var(--sidebar-width, 260px)';

  const handleSelectWorkspace = useCallback(
    async (path: string) => {
      addSavedWorkspacePath(path);
      setSelectedWorkspacePath(path);
      setFileTreeRootPath(path);
      setShowWorkspacePicker(false);
    },
    [addSavedWorkspacePath, setFileTreeRootPath, setSelectedWorkspacePath],
  );

  return (
    <>
      <CommandPalette
        commands={paletteCommands}
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />
      {pendingPermission && (
        <PermissionPrompt
          requestId={pendingPermission.requestId}
          toolName={pendingPermission.toolName}
          scope={pendingPermission.scope}
          reason={pendingPermission.reason}
          riskLevel={pendingPermission.riskLevel}
          previewAction={pendingPermission.previewAction}
          onDecide={(requestId: string, decision: PermissionDecision) => {
            if (!accessToken || !currentChatSessionId) {
              setPendingPermission(null);
              return;
            }
            void createPermissionsClient(gatewayUrl)
              .reply(accessToken, pendingPermission.targetSessionId, { requestId, decision })
              .finally(() => {
                setPendingPermission(null);
                requestCurrentSessionRefresh(currentChatSessionId);
                requestSessionListRefresh();
              });
          }}
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 500 }}
        />
      )}
      <PermissionConfirmDialog
        open={pendingConfirmDialog !== null}
        skillName={pendingConfirmDialog?.skillName ?? ''}
        permissions={pendingConfirmDialog?.permissions ?? []}
        trustLevel={pendingConfirmDialog?.trustLevel ?? 'standard'}
        onConfirm={() => {
          setPendingConfirmDialog(null);
        }}
        onCancel={() => {
          setPendingConfirmDialog(null);
        }}
      />
      <WorkspacePickerModal
        isOpen={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={handleSelectWorkspace}
        fetchRootPath={fetchRootPath}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        validatePath={validatePath}
        initialPath={uiState.fileTreeRootPath ?? selectedWorkspacePath ?? undefined}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            overflow: 'hidden',
            padding: 'var(--layout-padding, 4px 4px 6px)',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              flex: 1,
              overflow: 'hidden',
              borderRadius: 12,
              background: 'var(--bg-glass)',
              border: '1px solid var(--bg-glass-border)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: 'var(--shadow-sm), var(--shadow-md), var(--shadow-lg)',
            }}
          >
            <NavRail clearAuth={clearAuth} />

            <div
              aria-hidden={!leftSidebarOpen || !isChatRoute}
              style={{
                width: shouldOverlaySessionSidebar
                  ? sessionSidebarWidth
                  : isChatRoute && leftSidebarOpen
                    ? sessionSidebarWidth
                    : 0,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                height: '100%',
                borderRight:
                  isChatRoute && leftSidebarOpen ? '1px solid var(--border-subtle)' : 'none',
                transition: shouldOverlaySessionSidebar
                  ? 'transform 200ms ease, opacity 200ms ease'
                  : 'width 200ms ease',
                pointerEvents: isChatRoute && leftSidebarOpen ? undefined : 'none',
                position: shouldOverlaySessionSidebar ? 'absolute' : 'relative',
                left: shouldOverlaySessionSidebar ? 0 : undefined,
                top: shouldOverlaySessionSidebar ? 0 : undefined,
                bottom: shouldOverlaySessionSidebar ? 0 : undefined,
                zIndex: shouldOverlaySessionSidebar ? 35 : undefined,
                transform: shouldOverlaySessionSidebar
                  ? leftSidebarOpen
                    ? 'translateX(0)'
                    : 'translateX(-100%)'
                  : undefined,
                opacity: shouldOverlaySessionSidebar ? (leftSidebarOpen ? 1 : 0) : 1,
                boxShadow:
                  shouldOverlaySessionSidebar && leftSidebarOpen ? 'var(--shadow-lg)' : 'none',
                background: shouldOverlaySessionSidebar ? 'var(--surface)' : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  width: sessionSidebarWidth,
                  maxWidth: '100%',
                }}
              >
                <SessionSidebar
                  onOpenFile={onOpenFile}
                  fetchRootPath={fetchRootPath}
                  fetchTree={fetchTree}
                  onOpenWorkspacePicker={() => setShowWorkspacePicker(true)}
                />
              </div>
            </div>

            {shouldOverlaySessionSidebar && leftSidebarOpen && (
              <button
                type="button"
                aria-label="关闭侧栏遮罩"
                onClick={() => setLeftSidebarOpen(false)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 30,
                  background: 'oklch(0 0 0 / 0.42)',
                  backdropFilter: 'blur(1px)',
                }}
              />
            )}

            <div
              style={{
                display: 'flex',
                flex: 1,
                minWidth: 0,
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                data-testid="layout-topbar"
                style={{
                  display: 'flex',
                  height: 44,
                  flexShrink: 0,
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--header-bg)',
                }}
              >
                {isChatRoute && !leftSidebarOpen && (
                  <button
                    type="button"
                    title="展开面板"
                    onClick={() => setLeftSidebarOpen(true)}
                    className="icon-btn"
                    style={{
                      display: 'flex',
                      width: 28,
                      height: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 7,
                      color: 'var(--text-3)',
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
                <span
                  style={{
                    flex: 1,
                    userSelect: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width={18}
                    height={18}
                    viewBox="0 0 32 32"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect width="32" height="32" rx="7" fill="var(--accent)" />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(0, 16, 16)"
                    />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(120, 16, 16)"
                    />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(240, 16, 16)"
                    />
                    <circle cx="16" cy="16" r="2.5" fill="var(--accent-text)" />
                  </svg>
                  OpenAWork
                </span>

                {onToggleTheme && (
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
                    className="toolbar-btn"
                    style={{
                      display: 'flex',
                      width: 30,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 7,
                      color: 'var(--text-3)',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--surface)',
                      transition: 'color 150ms ease, background 150ms ease',
                      cursor: 'pointer',
                    }}
                  >
                    {theme === 'dark' ? (
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <circle cx="7.5" cy="7.5" r="2.5" />
                        <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.1 1.1M11 11l1.1 1.1M2.9 12.1l1.1-1.1M11 4l1.1-1.1" />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12.5 9A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 6.5 6.5z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              <div
                style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', minWidth: 0 }}
              >
                <div
                  className="outlet-content-wrap"
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    minWidth: 0,
                    position: 'relative',
                  }}
                >
                  <CachedRouteOutlet />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
