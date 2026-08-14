import React from 'react';
import { NavLink } from 'react-router';
import type { TabId } from './settings-page-helpers.js';

/**
 * 优化后的设置页面布局配置
 *
 * 主要改进：
 * 1. 精简分类：从 7 个减少到 4 个核心分类
 * 2. 更宽导航：220px（原 192px），更好容纳中文
 * 3. 紧凑间距：20px gap（原 28px），节省空间
 * 4. 智能折叠：在 960px 断点切换布局（原 820px）
 */

export const OPTIMIZED_NAV_WIDTH = 220;
export const OPTIMIZED_CONTENT_GAP = 20;
export const OPTIMIZED_COMPACT_BREAKPOINT = '(max-width: 960px)';
export const OPTIMIZED_MAX_WIDTH = `calc(var(--content-max-width) + ${OPTIMIZED_NAV_WIDTH + OPTIMIZED_CONTENT_GAP}px)`;

/**
 * 精简的标签分类结构
 */
export const OPTIMIZED_TAB_CATEGORIES = [
  {
    id: 'core',
    label: '核心设置',
    tabIds: ['connection', 'display', 'desktop', 'memory', 'companion'] as const,
  },
  {
    id: 'workspace',
    label: '工作空间',
    tabIds: [
      'workspace',
      'templates',
      'agents',
      'skills',
      'workflows',
      'schedules',
      'channels',
    ] as const,
  },
  {
    id: 'data',
    label: '数据与资源',
    tabIds: ['artifacts', 'images', 'sessions', 'resources', 'plugins'] as const,
  },
  {
    id: 'system',
    label: '系统与安全',
    tabIds: ['usage', 'security', 'devtools', 'about'] as const,
  },
] as const;

interface SettingsNavIconProps {
  id: string;
}

export function SettingsNavIcon({ id }: SettingsNavIconProps) {
  const icons: Record<string, React.ReactNode> = {
    connection: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    display: (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
    desktop: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
    channels: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    companion: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    memory: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </>
    ),
    templates: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="9" x2="9" y2="21" />
      </>
    ),
    agents: (
      <>
        <rect x="3" y="4" width="7" height="7" rx="2" />
        <rect x="14" y="4" width="7" height="7" rx="2" />
        <rect x="3" y="13" width="7" height="7" rx="2" />
        <rect x="14" y="13" width="7" height="7" rx="2" />
      </>
    ),
    skills: (
      <>
        <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.47 1.229 0 1.698l-1.568 1.568a1.1 1.1 0 0 0-.289.878l.31 2.208a1.1 1.1 0 0 1-1.271 1.271l-2.208-.31a1.1 1.1 0 0 0-.878.289l-1.568 1.568a1.2 1.2 0 0 1-1.698 0l-1.568-1.568a1.1 1.1 0 0 0-.878-.289l-2.208.31a1.1 1.1 0 0 1-1.271-1.271l.31-2.208a1.1 1.1 0 0 0-.289-.878L4.753 13.1a1.2 1.2 0 0 1 0-1.698l1.568-1.568a1.1 1.1 0 0 0 .289-.878l-.31-2.208a1.1 1.1 0 0 1 1.271-1.271l2.208.31a1.1 1.1 0 0 0 .878-.289l1.568-1.568a1.2 1.2 0 0 1 1.698 0l1.568 1.568a1.1 1.1 0 0 0 .878.289l2.208-.31a1.1 1.1 0 0 1 1.271 1.271z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    workflows: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 6h8" />
        <path d="M7 7.5 10.8 15" />
        <path d="M17 7.5 13.2 15" />
      </>
    ),
    schedules: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    artifacts: (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <line x1="9" y1="10" x2="9" y2="10" />
        <line x1="12" y1="10" x2="12" y2="10" />
        <line x1="15" y1="10" x2="15" y2="10" />
      </>
    ),
    images: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </>
    ),
    sessions: (
      <>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </>
    ),
    usage: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </>
    ),
    security: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    workspace: (
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    ),
    resources: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.3 7 12 12l8.7-5" />
        <path d="M12 22V12" />
      </>
    ),
    devtools: (
      <>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </>
    ),
    plugins: (
      <>
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
        <line x1="16" y1="8" x2="2" y2="22" />
        <line x1="17.5" y1="15" x2="9" y2="15" />
      </>
    ),
    about: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  };

  const content = icons[id];
  if (!content) return null;

  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content}
    </svg>
  );
}

interface OptimizedSettingsNavProps {
  activeTab: TabId;
  isCompact: boolean;
  isTauri: boolean;
  tabs: ReadonlyArray<{ readonly id: TabId; readonly label: string }>;
  tauriOnlyTabIds: ReadonlySet<TabId>;
}

export function OptimizedSettingsNav({
  activeTab,
  isCompact,
  isTauri,
  tabs,
  tauriOnlyTabIds,
}: OptimizedSettingsNavProps) {
  return (
    <nav
      style={{
        gridColumn: '1',
        gridRow: isCompact ? '1' : undefined,
        width: isCompact ? '100%' : OPTIMIZED_NAV_WIDTH,
        flexShrink: 0,
        borderRight: isCompact ? 'none' : '1px solid var(--border-subtle)',
        borderBottom: isCompact ? '1px solid var(--border-subtle)' : 'none',
        display: 'flex',
        flexDirection: isCompact ? 'row' : 'column',
        background: 'var(--bg-raised)',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* 头部标题 - 仅桌面端显示 */}
      {!isCompact && (
        <div
          style={{
            padding: '20px 16px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              letterSpacing: '-0.015em',
            }}
          >
            设置
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--fg-muted)',
              marginTop: 4,
            }}
          >
            系统配置与偏好
          </div>
        </div>
      )}

      {/* 导航列表 */}
      <div
        style={{
          flex: 1,
          overflowX: isCompact ? 'auto' : 'hidden',
          overflowY: isCompact ? 'hidden' : 'auto',
          padding: isCompact ? '10px 12px' : '12px',
          display: 'flex',
          flexDirection: isCompact ? 'row' : 'column',
          gap: isCompact ? 8 : 2,
          scrollbarWidth: 'thin',
          minWidth: 0,
        }}
      >
        {OPTIMIZED_TAB_CATEGORIES.map((category, idx) => (
          <div
            key={category.id}
            style={{
              display: isCompact ? 'contents' : 'block',
              marginTop: !isCompact && idx > 0 ? 16 : 0,
            }}
          >
            {/* 分类标签 */}
            <div
              style={{
                display: isCompact ? 'none' : 'block',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--fg-muted)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: '6px 12px 4px',
                userSelect: 'none',
              }}
            >
              {category.label}
            </div>

            {/* 分类下的标签项 */}
            {tabs
              .filter(
                (t) =>
                  (category.tabIds as readonly string[]).includes(t.id) &&
                  (!tauriOnlyTabIds.has(t.id) || isTauri),
              )
              .map((tabItem) => {
                const isActive = activeTab === tabItem.id;
                return (
                  <NavLink
                    key={tabItem.id}
                    to={`/settings/${tabItem.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flex: isCompact ? '0 0 auto' : undefined,
                      width: isCompact ? 'auto' : '100%',
                      padding: isCompact ? '10px 14px' : '10px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 500,
                      background: isActive ? 'var(--bg-overlay)' : 'transparent',
                      color: isActive ? 'var(--fg-strong)' : 'var(--fg-default)',
                      border: isActive
                        ? '1px solid var(--border-default)'
                        : '1px solid transparent',
                      boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                      textDecoration: 'none',
                      cursor: 'pointer',
                      transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--bg-subtle)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 20,
                        opacity: isActive ? 1 : 0.7,
                      }}
                    >
                      <SettingsNavIcon id={tabItem.id} />
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tabItem.label}
                    </span>
                  </NavLink>
                );
              })}
          </div>
        ))}
      </div>
    </nav>
  );
}
