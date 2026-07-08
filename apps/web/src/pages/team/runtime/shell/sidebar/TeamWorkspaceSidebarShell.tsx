import type { CSSProperties, ReactNode } from 'react';
import { ResizableDivider } from '../controls/ResizableDivider.js';
import {
  TeamSidebarWithFileTree,
  type TeamSidebarWithFileTreeProps,
} from './TeamSidebarWithFileTree.js';

type SidebarProps = Omit<TeamSidebarWithFileTreeProps, 'collapsed' | 'onToggleCollapsed'>;
type WorkbenchLayoutMode = 'classic' | 'fusion';

export interface TeamWorkspaceSidebarShellProps extends SidebarProps {
  readonly collapsed: boolean;
  readonly defaultWidth: number;
  readonly focusMode: boolean;
  readonly isMobile: boolean;
  readonly maxWidth: number;
  readonly minWidth: number;
  readonly mobileOpen: boolean;
  readonly showDivider: boolean;
  readonly width: number;
  readonly workbenchLayoutMode?: WorkbenchLayoutMode;
  readonly onCloseMobile: () => void;
  readonly onOpenMobile: () => void;
  readonly onResize: (width: number) => void;
  readonly onToggleCollapsed: () => void;
}

const DESKTOP_SIDEBAR_STYLE: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const MOBILE_TRIGGER_STYLE: CSSProperties = {
  position: 'fixed',
  left: -46,
  top: 246,
  zIndex: 70,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: 38,
  height: 38,
  padding: 0,
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
  color: 'var(--fg-default)',
  boxShadow: 'var(--shadow-sm)',
  cursor: 'pointer',
};

const MOBILE_BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 80,
  display: 'flex',
  background: 'color-mix(in srgb, var(--bg-base) 72%, transparent)',
  backdropFilter: 'blur(10px)',
};

const MOBILE_DRAWER_STYLE: CSSProperties = {
  width: 'min(86vw, 360px)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-raised)',
  borderRight: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
};

const MOBILE_CLOSE_LAYER_STYLE: CSSProperties = {
  flex: 1,
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
};

const SIDEBAR_BODY_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

interface SidebarBodyProps extends SidebarProps {
  readonly collapsed: boolean;
  readonly workbenchLayoutMode: WorkbenchLayoutMode;
  readonly onToggleCollapsed: () => void;
}

function SidebarBody(props: SidebarBodyProps): ReactNode {
  const { collapsed, onToggleCollapsed, workbenchLayoutMode, ...sidebarProps } = props;

  return (
    <div
      className="team-v2-workspace-sidebar-body"
      data-team-sidebar="workspace"
      data-workbench-layout={workbenchLayoutMode}
      style={SIDEBAR_BODY_STYLE}
    >
      <TeamSidebarWithFileTree
        {...sidebarProps}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    </div>
  );
}

export function TeamWorkspaceSidebarShell(props: TeamWorkspaceSidebarShellProps) {
  const {
    collapsed,
    defaultWidth,
    focusMode,
    isMobile,
    maxWidth,
    minWidth,
    mobileOpen,
    showDivider,
    width,
    workbenchLayoutMode = 'classic',
    onCloseMobile,
    onOpenMobile,
    onResize,
    onToggleCollapsed,
    ...sidebarProps
  } = props;

  if (focusMode && !isMobile) {
    return null;
  }

  const contentProps: SidebarBodyProps = {
    ...sidebarProps,
    collapsed,
    workbenchLayoutMode,
    onToggleCollapsed,
  };

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="team-v2-mobile-sidebar-trigger"
          style={MOBILE_TRIGGER_STYLE}
          onClick={onOpenMobile}
          aria-label="展开文件树"
          title="文件树"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        </button>
        {mobileOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="团队文件树"
            style={MOBILE_BACKDROP_STYLE}
          >
            <aside
              className="team-v2-workspace-sidebar-drawer"
              data-team-sidebar="workspace"
              data-workbench-layout={workbenchLayoutMode}
              style={MOBILE_DRAWER_STYLE}
            >
              {SidebarBody({ ...contentProps, collapsed: false })}
            </aside>
            <button
              type="button"
              aria-label="关闭会话列表"
              style={MOBILE_CLOSE_LAYER_STYLE}
              onClick={onCloseMobile}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <aside
        className="team-v2-pane team-v2-pane--sidebar team-v2-workspace-sidebar-shell"
        data-team-sidebar="workspace"
        data-workbench-layout={workbenchLayoutMode}
        style={DESKTOP_SIDEBAR_STYLE}
      >
        {SidebarBody(contentProps)}
      </aside>
      {showDivider ? (
        <ResizableDivider
          width={collapsed ? defaultWidth : width}
          minWidth={minWidth}
          maxWidth={maxWidth}
          defaultWidth={defaultWidth}
          onResize={onResize}
          onToggleCollapse={onToggleCollapsed}
        />
      ) : null}
    </>
  );
}
