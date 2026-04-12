import { useState } from 'react';
import type { AgentTeamsTabKey } from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { OfficeSidebar, useOfficeSceneState } from './OfficeScene.js';
import { OfficeThreeCanvas } from './OfficeThreeCanvas.js';
import { ConversationTab } from './ConversationTab.js';
import { TasksTab } from './TasksTab.js';
import { MessagesTab } from './MessagesTab.js';
import { OverviewTab } from './OverviewTab.js';
import { ReviewTab } from './ReviewTab.js';
import { TeamsTab } from './TeamsTab.js';
import { Icon, ChevronDownIcon } from './TeamIcons.js';
import type { IconKey } from './TeamIcons.js';
import { ViewGridIcon, ViewListIcon, ViewKanbanIcon, ViewSingleIcon } from './TeamIcons.js';

function MetricCard({
  item,
}: {
  item: ReturnType<typeof useTeamRuntimeReferenceViewData>['metricCards'][number];
}) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: '1px solid var(--border)',
        borderLeft: hovered
          ? `3px solid var(--accent)`
          : `3px solid color-mix(in oklch, var(--accent) 40%, transparent)`,
        background: hovered
          ? 'color-mix(in oklch, var(--accent) 4%, var(--card-bg))'
          : 'var(--card-bg)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            flexShrink: 0,
          }}
        >
          <Icon name={item.icon as IconKey} size={14} color="var(--accent)" />
        </span>
        <div style={{ display: 'grid', gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>
            {item.label}
          </span>
          <span style={{ fontSize: 24, lineHeight: 1, fontWeight: 800, color: 'var(--text)' }}>
            {item.value}
          </span>
        </div>
        <span
          style={{
            background: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'inline-flex',
            alignItems: 'center',
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(180deg)' : 'none',
          }}
        >
          <ChevronDownIcon size={10} color="var(--text-3)" />
        </span>
      </div>
      {expanded && (
        <div
          style={{
            padding: '6px 0 0',
            borderTop: '1px solid var(--border-subtle)',
            display: 'grid',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>详细统计数据加载中...</span>
        </div>
      )}
    </button>
  );
}

export function MainWorkspace({
  activeTab,
  selectedAgentId,
  onSelectAgent,
  onNewTemplate,
}: {
  activeTab: AgentTeamsTabKey;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  onNewTemplate: () => void;
}) {
  const { metricCards } = useTeamRuntimeReferenceViewData();
  const officeState = useOfficeSceneState();

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
          <ConversationTab selectedAgentId={selectedAgentId} />
        ) : activeTab === 'tasks' ? (
          <TasksTab />
        ) : activeTab === 'messages' ? (
          <MessagesTab />
        ) : activeTab === 'overview' ? (
          <OverviewTab />
        ) : activeTab === 'review' ? (
          <ReviewTab />
        ) : activeTab === 'teams' ? (
          <TeamsTab onNewTemplate={onNewTemplate} />
        ) : null}
      </div>
    </section>
  );
}

export function FooterBar({
  runningSeconds,
  viewMode,
  onViewModeChange,
}: {
  runningSeconds: number;
  viewMode: number;
  onViewModeChange: (mode: number) => void;
}) {
  const { footerLead, footerStats } = useTeamRuntimeReferenceViewData();
  const mins = Math.floor(runningSeconds / 60);
  const secs = runningSeconds % 60;
  const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;

  return (
    <footer
      style={{
        height: 30,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 14px 0 6px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
        color: 'var(--text-3)',
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
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          padding: '2px 4px',
          borderRadius: 6,
          background: 'var(--surface)',
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
                color: active ? 'var(--text)' : 'var(--text-3)',
                background: active ? 'var(--surface-2)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              <ViewIcon size={11} color={active ? 'var(--text)' : 'var(--text-3)'} />
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {footerStats.map((item) => (
          <span key={item.label} style={{ display: 'inline-flex', gap: 3 }}>
            <span style={{ color: 'var(--text-3)' }}>{item.label}</span>
            <strong style={{ color: 'var(--text)' }}>{item.value}</strong>
          </span>
        ))}
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 999,
            background: 'var(--surface)',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          运行 {timeStr}
        </span>
      </div>
    </footer>
  );
}
