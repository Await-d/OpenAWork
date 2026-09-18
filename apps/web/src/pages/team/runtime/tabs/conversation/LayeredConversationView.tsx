/**
 * 260916-层级可视化重构 · T-06 · 历史层级（追踪瀑布版）
 *
 * 结构：
 *   - 头部：范围标题 + 统计胶囊（层级会话 / 交接记录 / 时间跨度）+ 聚焦层过滤条；
 *   - 中段：LayerTraceWaterfall —— 每层一条轨道、每个层级会话一条时间条，
 *     交接连线跨轨绘制，打回 / 重试表现为回折；
 *   - 下段：LayerTraceDetailPane —— 选中时间条的上下文工作区（原「跨层线程」形态）。
 *
 * 与旧实现的差异：删除「左树 + 双栏/线程切换」双模式与 ASCII 缩进列表
 * （其缩进并不表达真实父子关系），改为单一时间轴主线 + 上下文详情。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { RolePromptPreviewPanel } from '../../shared/RolePromptPreviewPanel.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { LayerTraceDetailPane } from './LayerTraceDetailPane.js';
import { LayerTraceWaterfall } from './LayerTraceWaterfall.js';
import {
  TEAM_LAYER_LABELS,
  TEAM_LAYER_ORDER,
  buildLayerConversationRows,
  countLayerConversationRowsByLayer,
  type LayerConversationFilter,
  type LayerConversationState,
} from './layered-conversation-model.js';
import { buildLayerTraceModel, formatTraceDuration } from './layer-trace-model.js';

const ACTIVE_LAYER_STATES = new Set<LayerConversationState>([
  'idle',
  'paused',
  'pending',
  'claimed',
  'running',
]);

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
  const traceModel = useMemo(
    () => buildLayerTraceModel({ handoffs: handoffs.values(), nodes: nodes.values(), rows }),
    [handoffs, nodes, rows],
  );
  const rowCountByLayer = useMemo(() => countLayerConversationRowsByLayer(rows), [rows]);
  const handoffRowCount = rows.filter((row) => row.source === 'handoff').length;
  const sessionTitleById = useMemo(
    () => new Map(rows.map((row) => [row.sessionId, row.title] as const)),
    [rows],
  );

  useEffect(() => {
    setActiveLayer('all');
    setPromptPreviewLayer(null);
  }, [selectedTeam?.id, selectedTeam?.isSharedSession]);

  useEffect(() => {
    setSelectedSessionId((previous) => {
      if (previous && rows.some((row) => row.sessionId === previous)) {
        return previous;
      }
      if (!selectedTeam && rows.some((row) => ACTIVE_LAYER_STATES.has(row.state))) {
        return null;
      }

      const preferredSessionId =
        rows.find((row) => row.parentSessionId !== null)?.sessionId ??
        rows.find((row) => row.roleLayer === 'reception')?.sessionId ??
        rows.find((row) => row.parentSessionId === null)?.sessionId ??
        rows[0]?.sessionId ??
        null;
      return preferredSessionId;
    });
  }, [rows, selectedTeam]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId((previous) => (previous === sessionId ? null : sessionId));
  }, []);

  const selectedRow = selectedSessionId
    ? (rows.find((row) => row.sessionId === selectedSessionId) ?? null)
    : null;
  const scopeTitle = selectedTeam?.title ?? '全部团队会话';
  const scopeSubtitle = selectedTeam
    ? `${selectedTeam.subtitle} · ${rows.length} 个层级会话`
    : `${rows.length} 个层级会话`;

  if (rows.length === 0) {
    return (
      <TabContainer
        title="历史层级"
        subtitle="按接待、规划、管控、执行、测试、评审等层级查看历史会话。"
      >
        <EmptyState
          emoji="💬"
          title="暂无层级对话数据"
          description="当团队创建出接待、规划、执行、测试或评审等子会话后，这里会按层级把它们画成追踪时间轴。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="历史层级"
      subtitle="每层一条轨道、每个层级会话一条时间条；交接连线跨轨绘制，评审打回会形成回折。点击时间条查看完整对话。"
      scroll={false}
    >
      <div
        className="team-conv-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          padding: '10px 12px',
        }}
      >
        {/* 头部：固定内容高度——team-conv-panel 自带 flex:1，这里必须显式 flex:none 才不会被拉伸 */}
        <div className="team-conv-panel" style={{ flex: 'none' }}>
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
              {!traceModel.sequential && traceModel.spanMs > 0 ? (
                <span className="team-conv-stat-pill" data-tone="accent">
                  时间跨度 <strong>{formatTraceDuration(traceModel.spanMs)}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="team-conv-filter-bar" style={{ padding: '8px 12px' }}>
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
        </div>

        <LayerTraceWaterfall
          focusLayer={activeLayer === 'all' ? null : activeLayer}
          model={traceModel}
          onSelectSession={handleSelectSession}
          selectedSessionId={selectedSessionId}
        />

        <div className="team-conv-panel" style={{ flex: 1, minHeight: 0 }}>
          <LayerTraceDetailPane
            onPreviewPrompt={setPromptPreviewLayer}
            onSelectSessionDrawer={onSelectSessionDrawer}
            row={selectedRow}
            sessionTitleById={sessionTitleById}
          />
        </div>
      </div>
      <RolePromptPreviewPanel
        layer={promptPreviewLayer}
        onClose={() => setPromptPreviewLayer(null)}
      />
    </TabContainer>
  );
}
