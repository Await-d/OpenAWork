import type { ReactNode } from 'react';

export const RIGHT_PANEL_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'plan', label: '计划' },
  { id: 'tools', label: '工具' },
  { id: 'history', label: '历史' },
  { id: 'viz', label: '可视化' },
  { id: 'mcp', label: 'MCP' },
  { id: 'agent', label: '代理' },
] as const;

export type RightPanelTabId = (typeof RIGHT_PANEL_TABS)[number]['id'];

export const RIGHT_PANEL_TAB_META: Record<RightPanelTabId, { description: string; title: string }> =
  {
    overview: { title: '会话概览', description: '查看当前会话、上下文注入与运行摘要。' },
    plan: { title: '计划面板', description: '聚焦当前任务拆解、优先级与执行进度。' },
    tools: { title: '工具记录', description: '浏览工具调用、筛选分类，并快速定位输出。' },
    history: { title: '会话历史', description: '查看子会话、审批、计划记录与历史待办。' },
    viz: { title: '执行可视化', description: '从图谱与事件时间线理解当前执行路径。' },
    mcp: { title: 'MCP 状态', description: '检查 MCP 服务连接状态与可用能力。' },
    agent: { title: '代理详情', description: '查看子代理会话、日志与运行细节。' },
  };

export function renderRightPanelTabIcon(tabId: RightPanelTabId): ReactNode {
  const iconProps = {
    fill: 'none',
    height: 16,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: 16,
  };

  if (tabId === 'overview') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </svg>
    );
  }
  if (tabId === 'plan') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <path d="M9 6h9" />
        <path d="M9 12h9" />
        <path d="M9 18h9" />
        <path d="M5 6.5l1.2 1.2L8.5 5.5" />
        <path d="M5 12.5l1.2 1.2 2.3-2.2" />
        <path d="M5 18.5l1.2 1.2 2.3-2.2" />
      </svg>
    );
  }
  if (tabId === 'tools') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <path d="M14.5 6.5a4 4 0 0 0 4.9 4.9l-8.2 8.2a1.8 1.8 0 0 1-2.5-2.5l8.2-8.2a4 4 0 0 0-2.4-6.8" />
      </svg>
    );
  }
  if (tabId === 'history') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v4h4" />
        <path d="M12 7.5v5l3 2" />
      </svg>
    );
  }
  if (tabId === 'viz') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="12" cy="6" r="2.5" />
        <circle cx="18" cy="14" r="2.5" />
        <path d="M8 16.7l2.5-7" />
        <path d="M13.8 7.5l2.4 4.8" />
      </svg>
    );
  }
  if (tabId === 'mcp') {
    return (
      <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
        <rect x="5" y="5" width="5" height="5" rx="1.2" />
        <rect x="14" y="5" width="5" height="5" rx="1.2" />
        <rect x="9.5" y="14" width="5" height="5" rx="1.2" />
        <path d="M10 7.5h4" />
        <path d="M12 10v4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" focusable="false" role="presentation" {...iconProps}>
      <rect x="6" y="7" width="12" height="9" rx="2.5" />
      <circle cx="10" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <path d="M9 17v2" />
      <path d="M15 17v2" />
      <path d="M9 5.5l-1-1.5" />
      <path d="M15 5.5l1-1.5" />
    </svg>
  );
}
