/**
 * 260516-team-page-v2 · T-13 · LayeredConversationView（对话 Tab 重写版）
 *
 * TeamPageV2「层级对话」tab 的内嵌视图。
 *
 * 重写要点：
 *   - 将大量内联样式替换为 team-conv-* CSS 类名系统
 *   - 统一面板基底、状态徽章、会话行卡片视觉
 *   - 保留原有功能逻辑不变
 *
 * 布局：
 *   - 头部：会话标题 + 统计胶囊 + 布局切换
 *   - 过滤栏：层级标签过滤
 *   - split 模式：左列表 + 右对话
 *   - thread 模式：跨层线程视图
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { CrossLayerConversationView } from './CrossLayerConversationView.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState, SegmentedToggle } from '../../shared/content-kit/index.js';
import { RolePromptPreviewPanel } from '../../shared/RolePromptPreviewPanel.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import type { AgentTeamsSidebarTeam as AgentTeamsSidebarTeamView } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import {
  TEAM_LAYER_LABELS,
  TEAM_LAYER_ORDER,
  buildLayerConversationRows,
  canPreviewTeamLayerPrompt,
  countLayerConversationRowsByLayer,
  filterLayerConversationRows,
  type LayerConversationFilter,
  type LayerConversationRow,
  type LayerConversationState,
} from './layered-conversation-model.js';

type StateBadgeStyle = CSSProperties & {
  '--state-color': string;
  '--state-bg': string;
  '--state-border': string;
};

type LayerColorStyle = CSSProperties & {
  '--layer-color': string;
  '--layer-color-soft': string;
  '--layer-color-border': string;
};

function buildStateBadgeStyle(color: string): StateBadgeStyle {
  return {
    '--state-color': color,
    '--state-bg': `color-mix(in srgb, ${color} 10%, transparent)`,
    '--state-border': `color-mix(in srgb, ${color} 28%, transparent)`,
  };
}

function buildLayerColorStyle(color: string): LayerColorStyle {
  return {
    '--layer-color': color,
    '--layer-color-soft': `color-mix(in srgb, ${color} 10%, transparent)`,
    '--layer-color-border': `color-mix(in srgb, ${color} 28%, transparent)`,
  };
}

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--fg-muted)',
  paused: 'var(--warning)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger, var(--complement))',
  cancelled: 'var(--fg-muted)',
};

const STATE_LABELS: Record<LayerConversationState, string> = {
  idle: '空闲',
  paused: '已暂停',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const INDENT_UNIT = 24;

export interface LayeredConversationViewProps {
  onSelectSessionDrawer?: () => void;
  selectedTeam?: AgentTeamsSidebarTeam | null;
}

export function LayeredConversationView({
  onSelectSessionDrawer,
  selectedTeam = null,
}: LayeredConversationViewProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);
  const { sessions } = useTeamRuntimeReferenceViewData();
  const [activeLayer, setActiveLayer] = useState<LayerConversationFilter>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'split' | 'thread'>('split');
  const [promptPreviewLayer, setPromptPreviewLayer] = useState<TeamRoleLayer | null>(null);

  const rows = useMemo(
    () =>
      buildLayerConversationRows({
        handoffs: handoffs.values(),
        nodes: nodes.values(),
        selectedSessionId: selectedTeam?.isSharedSession ? null : selectedTeam?.id,
        sessions,
      }),
    [handoffs, nodes, selectedTeam?.id, selectedTeam?.isSharedSession, sessions],
  );
  const visibleRows = useMemo(
    () => filterLayerConversationRows(rows, activeLayer),
    [activeLayer, rows],
  );
  const rowCountByLayer = useMemo(() => countLayerConversationRowsByLayer(rows), [rows]);
  const handoffRowCount = rows.filter((row) => row.source === 'handoff').length;

  useEffect(() => {
    setActiveLayer('all');
    setPromptPreviewLayer(null);
  }, [selectedTeam?.id, selectedTeam?.isSharedSession]);

  useEffect(() => {
    setSelectedSessionId((previous) => {
      if (previous && rows.some((row) => row.sessionId === previous)) {
        return previous;
      }
      const activeStates = new Set<LayerConversationState>([
        'idle',
        'paused',
        'pending',
        'claimed',
        'running',
      ]);
      if (!selectedTeam && rows.some((row) => activeStates.has(row.state))) {
        return null;
      }

      const preferredSessionId =
        rows.find((row) => row.parentSessionId !== null)?.sessionId ??
        rows.find((row) => row.roleLayer === 'reception')?.sessionId ??
        rows.find((row) => row.parentSessionId === null)?.sessionId ??
        rows[0]?.sessionId ??
        null;
      if (preferredSessionId) {
        return preferredSessionId;
      }
      return null;
    });
  }, [rows, selectedTeam]);

  const handleSelectRow = useCallback((row: LayerConversationRow) => {
    setSelectedSessionId((previous) => (previous === row.sessionId ? null : row.sessionId));
  }, []);

  const selectedRow = selectedSessionId
    ? (rows.find((row) => row.sessionId === selectedSessionId) ?? null)
    : null;
  const selectedThreadTeam = selectedRow
    ? ({
        id: selectedRow.sessionId,
        status:
          selectedRow.state === 'failed'
            ? 'failed'
            : selectedRow.state === 'running' ||
                selectedRow.state === 'claimed' ||
                selectedRow.state === 'pending'
              ? 'running'
              : selectedRow.state === 'paused' || selectedRow.state === 'cancelled'
                ? 'paused'
                : 'completed',
        subtitle: `${TEAM_LAYER_LABELS[selectedRow.roleLayer]} · ${STATE_LABELS[selectedRow.state]}`,
        title: selectedRow.title,
      } satisfies AgentTeamsSidebarTeamView)
    : selectedTeam;
  const scopeTitle = selectedTeam?.title ?? '全部团队会话';
  const scopeSubtitle = selectedTeam
    ? `${selectedTeam.subtitle} · ${rows.length} 个层级会话`
    : `${rows.length} 个层级会话`;

  if (rows.length === 0) {
    return (
      <TabContainer
        title="历史层级对话"
        subtitle="按接待、规划、管控、执行、测试、评审等层级查看历史会话。"
      >
        <EmptyState
          emoji="💬"
          title="暂无层级对话数据"
          description="当团队创建出接待、规划、执行、测试或评审等子会话后，这里会按层级展示完整历史对话。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="历史层级对话"
      subtitle="按接待、规划、管控、执行、测试、评审等层级查看当前会话树中的历史对话。"
      scroll={false}
    >
      <div
        className="team-conv-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          padding: '16px 20px',
        }}
      >
        {/* 头部面板 */}
        <div className="team-conv-panel" style={{ flexShrink: 0 }}>
          <div className="team-conv-panel-header">
            <div className="team-conv-panel-header__title-group">
              <span className="team-conv-panel-header__title">{scopeTitle}</span>
              <span className="team-conv-panel-header__subtitle">{scopeSubtitle}</span>
            </div>
            <div className="team-conv-panel-header__actions">
              <span className="team-conv-stat-pill">
                层级会话 <strong>{rows.length}</strong>
              </span>
              <span className="team-conv-stat-pill">
                交接记录 <strong>{handoffRowCount}</strong>
              </span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: '10px 20px',
              borderBottom: '1px solid color-mix(in srgb, var(--border-default) 20%, transparent)',
            }}
          >
            <SegmentedToggle<'split' | 'thread'>
              ariaLabel="布局模式"
              size="sm"
              value={layoutMode}
              onChange={setLayoutMode}
              options={[
                { value: 'split', label: '双栏', icon: '🗂️' },
                { value: 'thread', label: '线程', icon: '🧵' },
              ]}
            />
            {activeLayer !== 'all' && canPreviewTeamLayerPrompt(activeLayer) ? (
              <button
                type="button"
                onClick={() => setPromptPreviewLayer(activeLayer)}
                title={`查看 ${TEAM_LAYER_LABELS[activeLayer]} 层的角色提示词`}
                className="team-v2-control team-v2-control--accent-soft"
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm, 6px)',
                  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                🧬 角色提示词
              </button>
            ) : null}
            {onSelectSessionDrawer ? (
              <button
                type="button"
                onClick={onSelectSessionDrawer}
                className="team-v2-control team-v2-control--transparent"
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm, 6px)',
                  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                在抽屉中打开
              </button>
            ) : null}
          </div>
        </div>

        {/* 过滤栏 */}
        <div className="team-conv-filter-bar" style={{ padding: '0 2px' }}>
          <button
            type="button"
            className="team-conv-filter-btn"
            data-active={activeLayer === 'all'}
            onClick={() => setActiveLayer('all')}
          >
            全部 · {rows.length}
          </button>
          {TEAM_LAYER_ORDER.map((layer) => {
            const count = rowCountByLayer.get(layer) ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={layer}
                type="button"
                className="team-conv-filter-btn"
                data-layer-filter
                data-layer={layer}
                data-active={activeLayer === layer}
                onClick={() => setActiveLayer(layer)}
              >
                {TEAM_LAYER_LABELS[layer]} · {count}
              </button>
            );
          })}
        </div>

        {/* 主内容区 */}
        {layoutMode === 'thread' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <CrossLayerConversationView focusHandoffId={null} selectedTeam={selectedThreadTeam} />
          </div>
        ) : (
          <div className="team-conv-split">
            {/* 左侧：会话树列表 */}
            <div className="team-conv-split__sidebar">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '12px 16px 8px',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--fg-muted)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  会话树
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {visibleRows.length} / {rows.length}
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '0 10px 12px',
                }}
              >
                {visibleRows.length === 0 ? (
                  <EmptyState
                    emoji="📭"
                    title="当前层级暂无历史会话"
                    description="换到「全部」或其它层级查看这棵会话树。"
                    compact
                    style={{ flex: 1 }}
                  />
                ) : (
                  visibleRows.map((row) => (
                    <LayerSessionRow
                      key={row.id}
                      row={row}
                      selected={selectedSessionId === row.sessionId}
                      onSelect={() => handleSelectRow(row)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* 右侧：选中会话对话 */}
            <div className="team-conv-split__main">
              {selectedSessionId ? (
                <>
                  {selectedRow ? <SelectedLayerHeader row={selectedRow} /> : null}
                  <TeamConversationView
                    key={selectedSessionId}
                    sessionId={selectedSessionId}
                    soloMode
                    readOnly
                  />
                </>
              ) : (
                <EmptyState
                  emoji="💬"
                  title="选择左侧层级查看历史对话"
                  description="右侧会按普通对话视图打开该层级 session 的完整消息历史。"
                  style={{ flex: 1 }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <RolePromptPreviewPanel
        layer={promptPreviewLayer}
        onClose={() => setPromptPreviewLayer(null)}
      />
    </TabContainer>
  );
}

// ─── 子组件 ──────────────────────────────────────────────────────────

function formatLayerRowTime(timestampMs: number): string {
  if (timestampMs <= 0) {
    return '无时间';
  }
  return new Date(timestampMs).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SelectedLayerHeader({ row }: { row: LayerConversationRow }) {
  const identity = getRoleLayerIdentity(row.roleLayer);
  const roleLabel = row.displayName ?? row.personaKey ?? null;
  const title = row.title.trim() || identity.label;
  const stateColor = STATE_COLORS[row.state] ?? 'var(--fg-muted)';

  return (
    <div
      className="team-conv-root"
      data-layer={row.roleLayer}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 25%, transparent)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--layer-color-soft) 60%, var(--bg-overlay)) 0%, transparent 100%)',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-sm, 6px)',
          background: 'var(--layer-color-soft)',
          border: '1px solid var(--layer-color-border)',
          color: 'var(--layer-color)',
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        {identity.icon}
      </span>
      <span style={{ display: 'grid', gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <strong
            style={{
              color: 'var(--fg-strong)',
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={title}
          >
            {title}
          </strong>
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10.5 }}>
          {identity.short} · {identity.label}
          {roleLabel ? ` · ${roleLabel}` : ''}
          {' · '}
          {STATE_LABELS[row.state]} · {formatLayerRowTime(row.timestampMs)}
        </span>
      </span>
      <span
        className="team-conv-badge team-conv-state"
        data-state={row.state}
        style={buildStateBadgeStyle(stateColor)}
      >
        {STATE_LABELS[row.state]}
      </span>
    </div>
  );
}

function LayerRowAvatar({ layer, state }: { layer: TeamRoleLayer; state: LayerConversationState }) {
  const identity = getRoleLayerIdentity(layer);
  const isRunning = state === 'running';
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-sm, 6px)',
        background: `color-mix(in srgb, ${identity.color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${identity.color} 30%, transparent)`,
        color: identity.color,
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      {identity.icon}
      {isRunning ? (
        <span
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 'var(--radius-sm, 6px)',
            border: `1px solid color-mix(in srgb, ${identity.color} 45%, transparent)`,
            animation: 'team-conv-pulse-dot 2.4s ease-in-out infinite',
          }}
        />
      ) : null}
    </span>
  );
}

function LayerSessionRow({
  row,
  selected,
  onSelect,
}: {
  row: LayerConversationRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const identity = getRoleLayerIdentity(row.roleLayer);
  const hasChildren = row.childCount > 0;
  const roleLabel = row.displayName ?? row.personaKey ?? null;
  const title =
    row.title.trim() || (roleLabel ? `${identity.label} · ${roleLabel}` : identity.label);
  const routeLabel = row.fromRoleLayer
    ? `${TEAM_LAYER_LABELS[row.fromRoleLayer]} → ${TEAM_LAYER_LABELS[row.roleLayer]}`
    : TEAM_LAYER_LABELS[row.roleLayer];
  const stateColor = STATE_COLORS[row.state] ?? 'var(--fg-muted)';

  const treeLines: string[] = [];
  for (let i = 0; i < row.depth; i++) {
    treeLines.push('│');
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`查看会话 ${row.sessionId}`}
      className="team-conv-session-row"
      data-layer={row.roleLayer}
      data-selected={selected}
      style={{
        ...buildLayerColorStyle(identity.color),
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr',
        gap: 8,
        alignItems: 'flex-start',
        padding: `8px 10px 8px ${row.depth > 0 ? 4 : 10}px`,
      }}
    >
      {/* 树形缩进区 */}
      {row.depth > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            width: row.depth * INDENT_UNIT,
            fontSize: 12,
            lineHeight: 1,
            color: 'var(--fg-subtle)',
            opacity: 0.5,
            userSelect: 'none',
            fontFamily: '"Cascadia Code","Fira Code","SF Mono",Consolas,monospace',
          }}
          aria-hidden
        >
          {treeLines.map((ch, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                width: INDENT_UNIT,
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
              }}
            >
              {i === row.depth - 1 ? (hasChildren ? '├' : '└') : ch}
            </span>
          ))}
          <span
            style={{
              width: 6,
              height: 1,
              background: 'var(--border-default)',
              marginLeft: -2,
              opacity: 0.5,
            }}
          />
        </span>
      )}

      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <LayerRowAvatar layer={row.roleLayer} state={row.state} />
      </span>

      <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <strong
            style={{
              color: 'var(--fg-strong)',
              fontSize: 12.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={title}
          >
            {title}
          </strong>
          <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <span
              className="team-conv-badge team-conv-state"
              data-state={row.state}
              style={buildStateBadgeStyle(stateColor)}
            >
              {STATE_LABELS[row.state]}
            </span>
          </span>
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            color: 'var(--fg-muted)',
            fontSize: 10,
            fontVariantNumeric: 'tabular-nums',
            flexWrap: 'wrap',
          }}
        >
          <span
            className="team-conv-badge team-conv-badge--layer"
            style={buildLayerColorStyle(identity.color)}
          >
            {routeLabel}
          </span>
          {roleLabel ? (
            <span style={{ flexShrink: 0, fontWeight: 600, color: 'var(--fg-default)' }}>
              {roleLabel}
            </span>
          ) : null}
          <span style={{ flexShrink: 0, color: 'var(--fg-subtle)' }}>
            {formatLayerRowTime(row.timestampMs)}
          </span>
        </span>
      </span>
    </button>
  );
}
