/**
 * 260516-team-page-v2 · T-13 · LayeredConversationView（chat-conversation-reuse-plan 步骤 3 改造）
 *
 * TeamPageV2「层级对话」tab 的内嵌视图。
 *
 * **改造要点（v3）**：从 handoff-only timeline 升级为历史会话树：
 *   - 左栏：snapshot sessions + layer nodes + handoffs 合并出的层级会话列表
 *   - 右栏：点击任意层级 session 后，用 `<TeamConversationView/>`
 *     渲染完整历史消息，实现"历史层级对话 = 真正能看到会话内容"
 *
 * 兼容点：
 *   - 仍保留「在抽屉中打开」入口（`onSelectSessionDrawer`），不打断老用户习惯
 *   - 层级行点击同时触发右栏 select：单击切换右栏会话；再次点击同条
 *     session 取消 select（回到欢迎面板）
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { AgentTeamsSidebarTeam as AgentTeamsSidebarTeamView } from '../../data/team-runtime-types.js';
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

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--fg-muted)',
  paused: 'var(--warning)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger)',
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

const CONTAINER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  flexShrink: 0,
};

const HEADER_TOP_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  flexWrap: 'wrap',
};

const HEADER_ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  flexShrink: 0,
};

const TAB_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  color: 'var(--fg-muted)',
};

const TIMELINE_PANEL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** 列表滚动区（嵌套在 TIMELINE_PANEL 内部） */
const TIMELINE_SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const TIMELINE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 6px 4px',
};

const TIMELINE_HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  letterSpacing: '0.08em',
};

const SESSION_PANE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflow: 'hidden',
};

export interface LayeredConversationViewProps {
  /** 用户希望以 Drawer 形式打开（保留全屏抽屉的兼容入口）。 */
  onSelectSessionDrawer?: () => void;
  /** 当前左侧会话列表选中的团队会话，用于把层级视图限定到该历史子树。 */
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
      const activeStates = new Set<LayerConversationState>(['idle', 'paused', 'pending', 'claimed', 'running']);
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
        <div style={CONTAINER_STYLE}>
          <EmptyState
            emoji="💬"
            title="暂无层级对话数据"
            description="当团队创建出接待、规划、执行、测试或评审等子会话后，这里会按层级展示完整历史对话。"
          />
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="历史层级对话"
      subtitle="按接待、规划、管控、执行、测试、评审等层级查看当前会话树中的历史对话。"
      scroll={false}
    >
      <div style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <div style={HEADER_TOP_ROW_STYLE}>
            <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 260px' }}>
              <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{scopeTitle}</strong>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{scopeSubtitle}</span>
            </span>
            <LayerSummaryPill label="层级会话" value={rows.length} />
            <LayerSummaryPill label="交接记录" value={handoffRowCount} />
          </div>
          <div style={HEADER_ACTION_ROW_STYLE}>
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

        <div style={TAB_BAR_STYLE} role="group" aria-label="层级筛选">
          <LayerTabBtn
            label={`全部 · ${rows.length}`}
            active={activeLayer === 'all'}
            onClick={() => setActiveLayer('all')}
          />
          {TEAM_LAYER_ORDER.map((layer) => {
            const count = rowCountByLayer.get(layer) ?? 0;
            if (count === 0) return null;
            return (
              <LayerTabBtn
                key={layer}
                label={`${TEAM_LAYER_LABELS[layer]} · ${count}`}
                active={activeLayer === layer}
                onClick={() => setActiveLayer(layer)}
              />
            );
          })}
        </div>

        {layoutMode === 'thread' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <CrossLayerConversationView focusHandoffId={null} selectedTeam={selectedThreadTeam} />
          </div>
        ) : (
          <div className="team-layered-conversation-split" style={{ flex: 1, minHeight: 0 }}>
            <div style={TIMELINE_PANEL_STYLE}>
              <div style={TIMELINE_HEADER_STYLE}>
                <span style={TIMELINE_HEADER_LABEL_STYLE}>会话树</span>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  当前显示 {visibleRows.length} / {rows.length}
                </span>
              </div>
              <div style={TIMELINE_SCROLL_STYLE}>
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

            <div style={SESSION_PANE_STYLE}>
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

function LayerTabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        ...TAB_BTN_STYLE,
        background: active
          ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))'
          : 'transparent',
        border: active
          ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
          : '1px solid transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
      }}
    >
      {label}
    </button>
  );
}

function LayerSummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 'var(--radius-pill, 9999px)',
        background: 'color-mix(in srgb, var(--fg-muted) 12%, transparent)',
        color: 'var(--fg-default)',
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ color: 'var(--fg-strong)' }}>{value}</span>
    </span>
  );
}

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

function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? sessionId.slice(-12) : sessionId;
}

function SelectedLayerHeader({ row }: { row: LayerConversationRow }) {
  const identity = getRoleLayerIdentity(row.roleLayer);
  const roleLabel = row.displayName ?? row.personaKey ?? null;
  const title = row.title.trim() || identity.label;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
        background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 'var(--radius-sm, 6px)',
          background: `color-mix(in srgb, ${identity.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${identity.color} 30%, transparent)`,
          color: identity.color,
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {identity.icon}
      </span>
      <span style={{ display: 'grid', gap: 1, minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
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
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10.5 }}>
          {identity.short} · {identity.label}
          {roleLabel ? ` · ${roleLabel}` : ''}
          {' · '}
          {STATE_LABELS[row.state]} · {formatLayerRowTime(row.timestampMs)}
        </span>
      </span>
      <LayerStateBadge state={row.state} />
    </div>
  );
}

function LayerStateBadge({ state }: { state: LayerConversationState }) {
  const color = STATE_COLORS[state] ?? 'var(--fg-muted)';
  return (
    <span
      style={{
        padding: '1px 7px',
        borderRadius: 'var(--radius-pill, 9999px)',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
        color,
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {STATE_LABELS[state]}
    </span>
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
        width: 26,
        height: 26,
        borderRadius: 'var(--radius-sm, 6px)',
        background: `color-mix(in srgb, ${identity.color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${identity.color} 30%, transparent)`,
        color: identity.color,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {identity.icon}
      {isRunning ? (
        <span
          style={{
            position: 'absolute',
            top: -2,
            left: -2,
            right: -2,
            bottom: -2,
            borderRadius: 'var(--radius-sm, 6px)',
            border: `1px solid color-mix(in srgb, ${identity.color} 45%, transparent)`,
            animation: 'team-v2-pulse 2.4s ease-in-out infinite',
          }}
        />
      ) : null}
    </span>
  );
}

const INDENT_UNIT = 24; /* 每层缩进宽度（px） */

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

  /* 构建树形连接线：每层一个槽位，绘制竖线和拐角 */
  const treeLines: ('│' | '├' | '└' | ' ')[] = [];
  for (let i = 0; i < row.depth; i++) {
    treeLines.push('│');
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`查看会话 ${row.sessionId}`}
      className="team-card-soft"
      style={{
        textAlign: 'left',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        padding: `8px 10px 8px ${row.depth > 0 ? 4 : 10}px`,
        borderRadius: 'var(--radius-md, 8px)',
        border: selected
          ? '1px solid color-mix(in srgb, var(--accent) 50%, transparent)'
          : '1px solid color-mix(in srgb, var(--border-default) 18%, transparent)',
        background: selected
          ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
          : 'color-mix(in srgb, var(--bg-overlay) 42%, transparent)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* 树形缩进区：固定宽度，每层 INDENT_UNIT px */}
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
      <span
        style={{
          display: 'grid',
          gap: 2,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
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
            <LayerStateBadge state={row.state} />
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
            style={{
              padding: '0 5px',
              borderRadius: 'var(--radius-pill, 9999px)',
              background: `color-mix(in srgb, ${identity.color} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${identity.color} 20%, transparent)`,
              color: identity.color,
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {routeLabel}
          </span>
          {roleLabel ? (
            <span
              style={{
                flexShrink: 0,
                fontWeight: 600,
                color: 'var(--fg-default)',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={roleLabel}
            >
              {roleLabel}
            </span>
          ) : null}
          <span style={{ flexShrink: 0 }}>{formatLayerRowTime(row.timestampMs)}</span>
          {hasChildren ? (
            <>
              <span aria-hidden style={{ color: 'var(--border-default)' }}>
                ·
              </span>
              <span style={{ flexShrink: 0, color: 'var(--accent)', fontWeight: 700 }}>
                +{row.childCount} 子层
              </span>
            </>
          ) : null}
        </span>
        {row.detail ? (
          <span
            style={{
              color: selected ? 'var(--fg-default)' : 'var(--fg-muted)',
              fontSize: 10.5,
              lineHeight: 1.45,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
            title={row.detail}
          >
            {row.detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
