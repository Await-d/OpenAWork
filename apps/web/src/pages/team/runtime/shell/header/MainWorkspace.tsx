/**
 * @deprecated TeamPage V1 路径专用 · TeamPageV2 不再引用本组件。
 *
 * V2 中间区由 `MiddleTabRouter` + `<ConversationArea/>` + `<TeamConversationView/>`
 * 协同渲染。本文件仅在 V1 fallback 路径下被 `TeamPage.tsx` 使用。
 *
 * 关联：`docs/chat-conversation-reuse-plan.md` v1.3 步骤 6
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { agentTeamsTabs } from '../../data/team-runtime-ui-config.js';
import type { AgentTeamsSidebarTeam, AgentTeamsTabKey } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { OfficeSidebar, useOfficeSceneState } from '../../tabs/office/OfficeScene.js';
import { OfficeThreeCanvas } from '../../tabs/office/OfficeThreeCanvas.js';
import { ConversationTab } from '../../tabs/conversation/ConversationTab.js';
import { TasksTab } from '../../tabs/tasks/TasksTab.js';
import { MessagesTab } from '../../tabs/conversation/MessagesTab.js';
import { OverviewTab } from '../../tabs/overview/OverviewTab.js';
import { ReviewTab } from '../../tabs/tasks/ReviewTab.js';
import { TeamsTab } from '../../tabs/governance/TeamsTab.js';
import { ChromeBadge, CompactMetricPill } from '../team-runtime-shell-primitives.js';
import { Icon } from '../../shared/TeamIcons.js';
import type { IconKey } from '../../shared/TeamIcons.js';
import {
  ViewGridIcon,
  ViewListIcon,
  ViewKanbanIcon,
  ViewSingleIcon,
} from '../../shared/TeamIcons.js';

const FULLSCREEN_OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'var(--bg-base)',
  display: 'flex',
  flexDirection: 'column',
};

const FULLSCREEN_CLOSE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 101,
  width: 40,
  height: 40,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
  backdropFilter: 'blur(8px)',
};

function MetricCard({
  item,
}: {
  item: ReturnType<typeof useTeamRuntimeReferenceViewData>['metricCards'][number];
}) {
  return (
    <CompactMetricPill
      icon={<Icon name={item.icon as IconKey} size={14} color="var(--accent)" />}
      label={item.label}
      value={item.value}
    />
  );
}

export function MainWorkspace({
  activeTab,
  selectedTeam,
  selectedAgentId,
  onSelectAgent,
  onNewTemplate,
}: {
  activeTab: AgentTeamsTabKey;
  selectedTeam: AgentTeamsSidebarTeam | null;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  onNewTemplate: () => void;
}) {
  const { metricCards } = useTeamRuntimeReferenceViewData();
  const officeState = useOfficeSceneState();
  const [showOfficeFullscreen, setShowOfficeFullscreen] = useState(false);

  useEffect(() => {
    if (!showOfficeFullscreen) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowOfficeFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showOfficeFullscreen]);

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '14px 16px 0',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {showOfficeFullscreen ? (
        <div style={FULLSCREEN_OVERLAY_STYLE}>
          <button
            type="button"
            onClick={() => setShowOfficeFullscreen(false)}
            style={FULLSCREEN_CLOSE_STYLE}
            aria-label="关闭全屏 3D 场景"
            title="关闭全屏（ESC）"
          >
            ✕
          </button>
          <div style={{ flex: 1, minHeight: 0 }}>
            <OfficeThreeCanvas
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              state={officeState}
            />
          </div>
        </div>
      ) : null}
      {selectedTeam ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '0 2px',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
              当前会话
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
              {selectedTeam.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <ChromeBadge>
              {selectedTeam.status === 'running'
                ? '运行中'
                : selectedTeam.status === 'paused'
                  ? '已暂停'
                  : selectedTeam.status === 'failed'
                    ? '失败'
                    : '已完成'}
            </ChromeBadge>
            <ChromeBadge>{selectedTeam.subtitle}</ChromeBadge>
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {metricCards.map((item) => (
          <MetricCard key={item.label} item={item} />
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '0 4px 14px',
          overflow: 'auto',
        }}
      >
        {activeTab === 'office' ? (
          <div
            style={{
              height: '100%',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 296px',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, minHeight: 0 }}>
              <OfficeThreeCanvas
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
                state={officeState}
              />
            </div>
            <div
              style={{
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                overflow: 'auto',
              }}
            >
              <OfficeSidebar
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
                state={officeState}
              />
            </div>
          </div>
        ) : activeTab === 'conversation' ? (
          <ConversationTab selectedAgentId={selectedAgentId} selectedTeam={selectedTeam} />
        ) : activeTab === 'tasks' ? (
          <TasksTab selectedTeam={selectedTeam} />
        ) : activeTab === 'messages' ? (
          <MessagesTab selectedTeam={selectedTeam} />
        ) : activeTab === 'overview' ? (
          <OverviewTab selectedTeam={selectedTeam} />
        ) : activeTab === 'review' ? (
          <ReviewTab selectedTeam={selectedTeam} />
        ) : activeTab === 'teams' ? (
          <TeamsTab />
        ) : null}
      </div>
    </section>
  );
}

export function FooterBar({
  activeTab,
  viewMode,
  onViewModeChange,
}: {
  activeTab: AgentTeamsTabKey;
  viewMode: number;
  onViewModeChange: (mode: number) => void;
}) {
  const { activeMode, footerLead, footerStats } = useTeamRuntimeReferenceViewData();
  const [runningSeconds, setRunningSeconds] = useState(1001);

  useEffect(() => {
    const timer = setInterval(() => setRunningSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(runningSeconds / 60);
  const secs = runningSeconds % 60;
  const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;
  const activeTabLabel = agentTeamsTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab;
  const viewModeLabel = ['网格', '列表', '看板', '聚焦'][viewMode] ?? '视图';

  return (
    <footer
      style={{
        height: 30,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 14px 0 6px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
        color: 'var(--fg-muted)',
        fontSize: 11,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--success)',
            boxShadow: '0 0 4px var(--success)',
          }}
        />
        <span>{footerLead}</span>
        <ChromeBadge>{activeTabLabel}</ChromeBadge>
        <ChromeBadge>{activeMode === 'live' ? '真实运行态' : '等待接入'}</ChromeBadge>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          padding: '2px 4px',
          borderRadius: 6,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {(
          [
            ['grid', ViewGridIcon],
            ['list', ViewListIcon],
            ['kanban', ViewKanbanIcon],
            ['single', ViewSingleIcon],
          ] as const
        ).map(([modeKey, ViewIcon], index) => {
          const active = index === viewMode;
          return (
            <button
              key={modeKey}
              type="button"
              onClick={() => onViewModeChange(index)}
              style={{
                width: 22,
                height: 18,
                borderRadius: 4,
                display: 'grid',
                placeItems: 'center',
                color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
                background: active ? 'var(--bg-surface)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              <ViewIcon size={11} color={active ? 'var(--fg-strong)' : 'var(--fg-muted)'} />
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {footerStats.map((item) => (
          <span key={item.label} style={{ display: 'inline-flex', gap: 3 }}>
            <span style={{ color: 'var(--fg-muted)' }}>{item.label}</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{item.value}</strong>
          </span>
        ))}
        <ChromeBadge>{viewModeLabel}</ChromeBadge>
        <ChromeBadge>运行 {timeStr}</ChromeBadge>
      </div>
    </footer>
  );
}
