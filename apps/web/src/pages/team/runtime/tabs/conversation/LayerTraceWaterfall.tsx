/**
 * 260916-层级可视化重构 · T-05 · 追踪瀑布视图
 *
 * 每层一条轨道，每个层级会话一条时间条；条与条之间按交接关系连线，
 * 打回 / 重试在图中表现为向上回折。条位置按时间比例（范围退化时等宽），
 * 跨轨连线用 SVG 绘制（宽度经 ResizeObserver 实测，避免 stroke 拉伸变形）。
 */

import { useMemo, useRef, type CSSProperties } from 'react';
import type { TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { substateLabelAny } from '../../data/substates.js';
import { useElementWidth } from './use-element-width.js';
import { STATE_COLOR } from './layer-flow-state.js';
import type { LayerConversationState } from './layered-conversation-model.js';
import {
  buildTraceEdgePath,
  formatTraceDuration,
  resolveTraceBarPlacement,
  type TraceBar,
  type TraceLane,
  type TraceModel,
} from './layer-trace-model.js';

const TRACE_LANE_HEIGHT = 44;
const TRACE_BAR_HEIGHT = 26;
/** 条宽小于该像素时不渲染内嵌文字（仅保留 title 提示），避免文字挤压。 */
const TRACE_BAR_LABEL_MIN_PX = 74;

type BarStyle = CSSProperties & {
  '--trace-bar-color': string;
  '--trace-layer-color': string;
};

type LaneLabelStyle = CSSProperties & {
  '--trace-layer-color': string;
};

export interface LayerTraceWaterfallProps {
  /** 聚焦层：非该层的条变暗而不是隐藏，保持时间轴完整。 */
  focusLayer: TeamRoleLayer | null;
  model: TraceModel;
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
}

export function LayerTraceWaterfall({
  focusLayer,
  model,
  onSelectSession,
  selectedSessionId,
}: LayerTraceWaterfallProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const trackWidth = useElementWidth(tracksRef);
  const laneIndexByLayer = useMemo(
    () => new Map(model.lanes.map((lane, index) => [lane.layer, index] as const)),
    [model.lanes],
  );
  const barBySession = useMemo(
    () => new Map(model.bars.map((bar) => [bar.sessionId, bar] as const)),
    [model.bars],
  );
  const totalHeight = Math.max(model.lanes.length, 1) * TRACE_LANE_HEIGHT;

  return (
    <div className="team-conv-trace">
      <div className="team-conv-trace__axis">
        <span className="team-conv-trace__axis-label">层 / 时间</span>
        <div className="team-conv-trace__axis-track">
          {model.ticks.map((tick) => (
            <span
              key={`${tick.ratio}-${tick.label}`}
              className="team-conv-trace__tick"
              style={{
                left: `${tick.ratio * 100}%`,
                transform: tick.ratio === 1 ? 'translateX(-100%)' : undefined,
                paddingLeft: tick.ratio === 0 ? 8 : 0,
                paddingRight: tick.ratio === 1 ? 8 : 0,
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <div className="team-conv-trace__body">
        <div className="team-conv-trace__labels">
          {model.lanes.map((lane) => (
            <TraceLaneLabel key={lane.layer} lane={lane} />
          ))}
        </div>

        <div className="team-conv-trace__tracks" ref={tracksRef} style={{ height: totalHeight }}>
          {model.lanes.map((lane) => (
            <div
              key={lane.layer}
              className="team-conv-trace__lane"
              style={{ height: TRACE_LANE_HEIGHT }}
            >
              {lane.bars.map((bar) => (
                <TraceBarItem
                  key={bar.sessionId}
                  bar={bar}
                  dim={focusLayer !== null && bar.layer !== focusLayer}
                  model={model}
                  onSelect={onSelectSession}
                  selected={bar.sessionId === selectedSessionId}
                  showLabel={
                    trackWidth > 0 &&
                    resolveTraceBarPlacement(bar, model).widthRatio * trackWidth >=
                      TRACE_BAR_LABEL_MIN_PX
                  }
                />
              ))}
            </div>
          ))}

          {trackWidth > 0 ? (
            <svg
              aria-hidden="true"
              className="team-conv-trace__edges"
              height={totalHeight}
              viewBox={`0 0 ${trackWidth} ${totalHeight}`}
              width={trackWidth}
            >
              {model.edges.map((edge) => {
                const from = barBySession.get(edge.fromSessionId);
                const to = barBySession.get(edge.toSessionId);
                if (!from || !to) {
                  return null;
                }
                const fromPlacement = resolveTraceBarPlacement(from, model);
                const toPlacement = resolveTraceBarPlacement(to, model);
                const path = buildTraceEdgePath({
                  fromLaneIndex: laneIndexByLayer.get(from.layer) ?? 0,
                  fromRatio: fromPlacement.leftRatio + fromPlacement.widthRatio,
                  laneHeight: TRACE_LANE_HEIGHT,
                  toLaneIndex: laneIndexByLayer.get(to.layer) ?? 0,
                  toRatio: toPlacement.leftRatio,
                  trackWidth,
                });
                return (
                  <path
                    key={`${edge.fromSessionId}->${edge.toSessionId}`}
                    className="team-conv-trace__edge"
                    d={path}
                    data-active={edge.active ? 'true' : 'false'}
                    data-state={edge.state}
                    style={{ stroke: traceStateColor(edge.state) }}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TraceLaneLabel({ lane }: { lane: TraceLane }) {
  const identity = getRoleLayerIdentity(lane.layer);
  const style: LaneLabelStyle = {
    '--trace-layer-color': identity.color,
    height: TRACE_LANE_HEIGHT,
  };

  return (
    <div className="team-conv-trace__lane-label" style={style}>
      <span aria-hidden className="team-conv-trace__lane-icon">
        {identity.icon}
      </span>
      <span className="team-conv-trace__lane-body">
        <span className="team-conv-trace__lane-name">{identity.short}</span>
        <span className="team-conv-trace__lane-meta">
          {lane.sessionCount} 会话 · {formatTraceDuration(lane.totalDurationMs)}
        </span>
      </span>
    </div>
  );
}

function TraceBarItem({
  bar,
  dim,
  model,
  onSelect,
  selected,
  showLabel,
}: {
  bar: TraceBar;
  dim: boolean;
  model: TraceModel;
  onSelect: (sessionId: string) => void;
  selected: boolean;
  showLabel: boolean;
}) {
  const placement = resolveTraceBarPlacement(bar, model);
  const identity = getRoleLayerIdentity(bar.layer);
  const substateLabel = substateLabelAny(bar.substate);
  const style: BarStyle = {
    '--trace-bar-color': traceStateColor(bar.state),
    '--trace-layer-color': identity.color,
    height: TRACE_BAR_HEIGHT,
    left: `${placement.leftRatio * 100}%`,
    width: `${placement.widthRatio * 100}%`,
  };
  const title = [
    bar.title,
    `${identity.short} · ${bar.state}`,
    formatTraceDuration(bar.durationMs),
    substateLabel,
    bar.detail,
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' · ');

  return (
    <button
      type="button"
      className="team-conv-trace__bar"
      data-active={bar.active ? 'true' : 'false'}
      data-dim={dim ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-state={bar.state}
      data-trace-session={bar.sessionId}
      onClick={() => onSelect(bar.sessionId)}
      style={style}
      title={title}
    >
      {showLabel ? <span className="team-conv-trace__bar-title">{bar.title}</span> : null}
      {showLabel && substateLabel ? (
        <span className="team-conv-trace__bar-substate">{substateLabel}</span>
      ) : null}
    </button>
  );
}

function traceStateColor(state: LayerConversationState): string {
  if (state === 'paused') {
    return 'var(--warning)';
  }
  return STATE_COLOR[state] ?? 'var(--fg-muted)';
}
