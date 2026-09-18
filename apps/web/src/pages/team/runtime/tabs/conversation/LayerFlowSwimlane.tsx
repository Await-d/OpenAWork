/**
 * 260916-层级可视化重构 · 泳道轨迹画布
 *
 * 布局：左侧固定泳道标签列（图标 / 层名 / 状态 / 计数）+ 右侧横向滚动轨迹画布。
 * 画布内：顶部时间槽轴 → 泳道背景 → SVG 跨层连线（源节点 → 目标节点）→ HTML 节点卡片。
 *
 * 自适应：
 *   - 列宽按可视宽度平摊（列少铺满 / 列多滚动）；
 *   - 泳道高度按可用高度平摊，且**空泳道（无会话无交接）折叠为窄条**，
 *     把高度让给有内容的泳道，避免"内容少时空泳道各占一份高度"。
 *
 * 交互：
 *   - 打开自动滚到最右（最新一条交接），此后仅在用户停留在最右附近时跟随新增；
 *   - 滚轮纵向增量转为横向滚动（轨迹浏览的主交互）；
 *   - 选中某条交接时沿交接链聚焦：链上节点/连线保持，其余淡化。
 */

import { useEffect, useMemo, useRef } from 'react';
import type { TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';
import { LayerFlowSwimlaneNode } from './LayerFlowSwimlaneNode.js';
import {
  SWIMLANE_AXIS_HEIGHT,
  buildSwimlaneLinkPath,
  measureSwimlane,
  resolveSwimlaneColumnWidth,
  resolveSwimlaneFocusHandoffIds,
  resolveSwimlaneLaneCenters,
  resolveSwimlaneLaneMetrics,
  swimlaneColumnLeft,
  swimlaneLaneTotalHeight,
  type SwimlaneLane,
  type SwimlaneModel,
} from './layer-flow-swimlane-model.js';
import { useElementWidth } from './use-element-width.js';

export interface LayerFlowSwimlaneProps {
  /** 泳道区的可用高度（由外层实测）：用于把泳道高度铺满，而不是固定 96px。 */
  availableHeight: number;
  model: SwimlaneModel;
  onSelectHandoff: (handoffId: string) => void;
  onSelectLane: (layer: TeamRoleLayer) => void;
  selectedHandoffId: string | null;
  /** 当前作用域内的交接总数（含被密度筛选排除的），用于空态文案区分"没有"和"被筛掉"。 */
  totalHandoffCount: number;
}

export function LayerFlowSwimlane({
  availableHeight,
  model,
  onSelectHandoff,
  onSelectLane,
  selectedHandoffId,
  totalHandoffCount,
}: LayerFlowSwimlaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousColumnCountRef = useRef(0);
  const viewportWidth = useElementWidth(scrollRef);
  const columnCount = model.columns.length;
  const columnWidth = resolveSwimlaneColumnWidth(columnCount, viewportWidth);
  const laneMetrics = useMemo(
    () => resolveSwimlaneLaneMetrics(model.lanes, availableHeight),
    [availableHeight, model.lanes],
  );
  const laneCenters = useMemo(() => resolveSwimlaneLaneCenters(laneMetrics), [laneMetrics]);
  const geometry = measureSwimlane(columnCount, columnWidth, swimlaneLaneTotalHeight(laneMetrics));
  const focusedHandoffIds = useMemo(
    () => resolveSwimlaneFocusHandoffIds(model, selectedHandoffId),
    [model, selectedHandoffId],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const previousCount = previousColumnCountRef.current;
    previousColumnCountRef.current = columnCount;
    if (previousCount === 0) {
      element.scrollLeft = element.scrollWidth;
      return;
    }
    if (columnCount <= previousCount) {
      return;
    }
    const distanceToRight = element.scrollWidth - element.scrollLeft - element.clientWidth;
    if (distanceToRight < columnWidth * 1.5) {
      element.scrollLeft = element.scrollWidth;
    }
  }, [columnCount, columnWidth]);

  // 滚轮横向浏览：轨迹通常是"时间很长、高度有限"的形态，纵向滚轮在这里没有意义
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div className="team-conv-swimlane">
      <div className="team-conv-swimlane__labels">
        <div className="team-conv-swimlane__axis-spacer" style={{ height: SWIMLANE_AXIS_HEIGHT }}>
          <span className="team-conv-swimlane__axis-hint">时间 →</span>
        </div>
        {model.lanes.map((lane, index) => (
          <LaneLabel
            key={lane.layer}
            lane={lane}
            laneHeight={laneMetrics[index]?.height ?? 0}
            onSelectLane={onSelectLane}
          />
        ))}
      </div>

      <div className="team-conv-swimlane__scroll" ref={scrollRef}>
        <div
          className="team-conv-swimlane__canvas"
          style={{ height: geometry.height + SWIMLANE_AXIS_HEIGHT, width: geometry.width }}
        >
          <div className="team-conv-swimlane__axis" style={{ height: SWIMLANE_AXIS_HEIGHT }}>
            {model.columns.map((column) => (
              <span
                key={column.index}
                className="team-conv-swimlane__axis-tick"
                style={{ left: swimlaneColumnLeft(column.index, columnWidth), width: columnWidth }}
              >
                {column.label}
              </span>
            ))}
          </div>

          <div className="team-conv-swimlane__lanes" style={{ height: geometry.height }}>
            {model.lanes.map((lane, index) => {
              const metrics = laneMetrics[index];
              return (
                <div
                  key={lane.layer}
                  className="team-conv-swimlane__lane"
                  data-empty={lane.empty ? 'true' : 'false'}
                  data-layer={lane.layer}
                  style={{ height: metrics?.height ?? 0, top: metrics?.top ?? 0 }}
                />
              );
            })}

            <svg
              aria-hidden="true"
              className="team-conv-swimlane__links"
              focusable="false"
              height={geometry.height}
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              width={geometry.width}
            >
              {model.links.map((link) => (
                <path
                  key={link.handoffId}
                  className="team-conv-swimlane__link"
                  d={buildSwimlaneLinkPath(link, columnWidth, laneCenters)}
                  data-active={link.active ? 'true' : 'false'}
                  data-dim={
                    focusedHandoffIds !== null && !focusedHandoffIds.has(link.handoffId)
                      ? 'true'
                      : 'false'
                  }
                  data-state={link.state}
                  style={{ stroke: STATE_COLOR[link.state] ?? 'var(--fg-muted)' }}
                />
              ))}
            </svg>

            {model.nodes.map((node, index) => (
              <LayerFlowSwimlaneNode
                key={node.handoffId}
                columnWidth={columnWidth}
                dim={focusedHandoffIds !== null && !focusedHandoffIds.has(node.handoffId)}
                laneCenterY={laneCenters[node.laneIndex] ?? 0}
                node={node}
                onSelect={onSelectHandoff}
                selected={node.handoffId === selectedHandoffId}
                timeLabel={model.columns[index]?.label ?? '—'}
              />
            ))}

            {model.columns.length === 0 ? (
              <div className="team-conv-swimlane__empty">
                {totalHandoffCount > 0 ? (
                  <>
                    <strong>当前筛选下没有可显示的交接</strong>
                    <span>
                      共 {totalHandoffCount} 条交接被「活跃」密度过滤，切到「全部」查看完整轨迹。
                    </span>
                  </>
                ) : (
                  <>
                    <strong>当前会话树内还没有跨层交接</strong>
                    <span>提出需要规划 / 执行的任务后，层间交接会在这里按时间顺序画成轨迹。</span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LaneLabel({
  lane,
  laneHeight,
  onSelectLane,
}: {
  lane: SwimlaneLane;
  laneHeight: number;
  onSelectLane: (layer: TeamRoleLayer) => void;
}) {
  const identity = getRoleLayerIdentity(lane.layer);
  const stateLabel = STATE_LABELS[lane.state] ?? lane.state;
  const stateColor = STATE_COLOR[lane.state] ?? 'var(--fg-muted)';
  const clickable = lane.sessionCount > 0;

  return (
    <button
      type="button"
      className="team-conv-swimlane__lane-label"
      data-active={lane.active ? 'true' : 'false'}
      data-clickable={clickable ? 'true' : 'false'}
      data-empty={lane.empty ? 'true' : 'false'}
      data-layer={lane.layer}
      disabled={!clickable}
      onClick={() => onSelectLane(lane.layer)}
      style={{ height: laneHeight }}
      title={
        clickable ? `查看${identity.label}最近会话` : `${identity.label}（当前会话树内无该层会话）`
      }
    >
      <span aria-hidden className="team-conv-swimlane__lane-icon">
        {identity.icon}
      </span>
      <span className="team-conv-swimlane__lane-body">
        <span className="team-conv-swimlane__lane-name">{identity.label}</span>
        <span className="team-conv-swimlane__lane-meta">
          <span style={{ color: stateColor, fontWeight: 700 }}>{stateLabel}</span>
          <span aria-hidden>·</span>
          <span>
            {lane.sessionCount} 会话 · {lane.inboundCount} 交接
          </span>
        </span>
      </span>
    </button>
  );
}
