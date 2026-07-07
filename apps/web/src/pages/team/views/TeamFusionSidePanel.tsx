import type { ReactNode } from 'react';
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import { PRIMARY_TABS, type PrimaryTabKey } from '../runtime/tabs/team-page-v2-tabs.js';

type FusionRuntimeMode = 'idle' | 'running' | 'paused';
type FusionRuntimeTone = FusionRuntimeMode | 'failure';

export interface TeamFusionSidePanelProps {
  readonly activePrimary: PrimaryTabKey | null;
  readonly activeHandoffCount: number;
  readonly children: ReactNode;
  readonly clarificationPending: number;
  readonly effectiveMode: FusionRuntimeMode;
  readonly failedTaskCount: number;
  readonly middleTab: MiddleTabKey;
  readonly onPrimaryChange: (primary: PrimaryTabKey) => void;
  readonly selectedTeamSubtitle: string | null;
  readonly selectedTeamTitle: string | null;
  readonly unreadCount: number;
  readonly workspaceLabel: string;
}

const SIDE_PANEL_PRIMARY_KEYS: ReadonlySet<PrimaryTabKey> = new Set([
  'overview',
  'tasks',
  'metrics',
  'governance',
]);

const SIDE_PANEL_TABS = PRIMARY_TABS.filter((tab) => SIDE_PANEL_PRIMARY_KEYS.has(tab.key));
const SIDE_PANEL_LEAF_LABELS: ReadonlyMap<MiddleTabKey, string> = new Map(
  PRIMARY_TABS.flatMap((tab) => tab.children.map((child) => [child.key, child.label] as const)),
);

function formatRuntimeModeLabel(mode: FusionRuntimeMode, failedTaskCount: number): string {
  if (failedTaskCount > 0) return '需要处理';
  if (mode === 'paused') return '已暂停';
  if (mode === 'idle') return '待命';
  return '运行中';
}

export function TeamFusionSidePanel({
  activePrimary,
  activeHandoffCount,
  children,
  clarificationPending,
  effectiveMode,
  failedTaskCount,
  middleTab,
  onPrimaryChange,
  selectedTeamSubtitle,
  selectedTeamTitle,
  unreadCount,
  workspaceLabel,
}: TeamFusionSidePanelProps) {
  const activeViewLabel = SIDE_PANEL_LEAF_LABELS.get(middleTab) ?? middleTab;
  const runtimeTone: FusionRuntimeTone = failedTaskCount > 0 ? 'failure' : effectiveMode;
  const runtimeLabel = formatRuntimeModeLabel(effectiveMode, failedTaskCount);

  return (
    <div className="team-v2-fusion-side-panel" data-active-tab={middleTab}>
      <div className="team-v2-fusion-side-panel__head" role="tablist" aria-label="团队工作台视图">
        {SIDE_PANEL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="team-v2-fusion-side-panel__tab"
            data-active={activePrimary === tab.key ? 'true' : 'false'}
            onClick={() => onPrimaryChange(tab.key)}
          >
            <span>{tab.label}</span>
            {tab.key === 'tasks' && failedTaskCount > 0 ? (
              <span className="team-v2-fusion-side-panel__tab-badge">{failedTaskCount}</span>
            ) : null}
            {tab.key === 'governance' && clarificationPending > 0 ? (
              <span className="team-v2-fusion-side-panel__tab-badge">{clarificationPending}</span>
            ) : null}
          </button>
        ))}
      </div>

      <section className="team-v2-fusion-side-panel__summary" aria-label="团队工作台上下文">
        <div className="team-v2-fusion-side-panel__summary-main">
          <span className="team-v2-fusion-side-panel__summary-eyebrow">{workspaceLabel}</span>
          <strong title={selectedTeamTitle ?? undefined}>{selectedTeamTitle ?? '团队会话'}</strong>
          <span title={selectedTeamSubtitle ?? undefined}>
            {selectedTeamSubtitle ?? '等待团队会话上下文'}
          </span>
        </div>
        <div className="team-v2-fusion-side-panel__summary-grid">
          <span className="team-v2-fusion-side-panel__summary-stat" data-tone={runtimeTone}>
            <span>状态</span>
            <strong>{runtimeLabel}</strong>
          </span>
          <span className="team-v2-fusion-side-panel__summary-stat">
            <span>Handoff</span>
            <strong>{activeHandoffCount}</strong>
          </span>
          <span
            className="team-v2-fusion-side-panel__summary-stat"
            data-tone={failedTaskCount > 0 ? 'failure' : undefined}
          >
            <span>失败</span>
            <strong>{failedTaskCount}</strong>
          </span>
          <span
            className="team-v2-fusion-side-panel__summary-stat"
            data-tone={clarificationPending > 0 ? 'paused' : undefined}
          >
            <span>澄清</span>
            <strong>{clarificationPending}</strong>
          </span>
        </div>
      </section>

      <div className="team-v2-fusion-side-panel__toolbar">
        <span className="team-v2-fusion-side-panel__toolbar-pill team-v2-fusion-side-panel__toolbar-pill--accent">
          {selectedTeamTitle ?? '团队会话'}
        </span>
        <span className="team-v2-fusion-side-panel__toolbar-pill">{unreadCount} 未读</span>
        <span className="team-v2-fusion-side-panel__toolbar-pill">当前视图 {activeViewLabel}</span>
      </div>

      <div className="team-v2-fusion-side-panel__content">{children}</div>
    </div>
  );
}
