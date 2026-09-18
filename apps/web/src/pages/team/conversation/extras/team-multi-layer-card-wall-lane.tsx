import type { ReactElement } from 'react';
import type { ResolveInlinePermissionActionsFn } from '../../../../components/chat/session/ChatPageSections.js';
import { LayerRoleCard } from './team-multi-layer-card-wall-card.js';
import {
  instanceKey,
  layerDepth,
  resolveTerminalStatus,
} from './team-multi-layer-card-wall-model.js';
import {
  CARD_ROW_STYLE,
  LANE_BODY_STYLE,
  LANE_CODE_STYLE,
  LANE_HEADER_STYLE,
  LANE_META_STYLE,
  LANE_NAME_STYLE,
  LANE_STYLE,
  RAIL_DOT_STYLE,
  RAIL_LINE_STYLE,
  RAIL_STYLE,
} from './team-multi-layer-card-wall-styles.js';
import type { CardPendingPermission, LayerLane } from './team-multi-layer-card-wall-types.js';

interface LayerLaneRowProps {
  lane: LayerLane;
  isLast: boolean;
  activeLayer?: string | null;
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (key: string) => void;
  onLayerSelect?: (layer: string) => void;
  pendingPermissions?: readonly CardPendingPermission[];
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  onOpenSession?: (sessionId: string) => void;
}

export function LayerLaneRow({
  lane,
  isLast,
  activeLayer,
  expandedKeys,
  onToggleExpanded,
  onLayerSelect,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: LayerLaneRowProps): ReactElement {
  const instanceCount = lane.instances.length;
  const laneFocused = activeLayer === lane.layer;
  // 层级序号由 LAYER_DEPTH 推导，**不能**用泳道在数组里的下标 —— 只有部分层级有实例时
  // （例如只有 pm1 与执行层在场），下标会把执行层标成「第 2 层」，而架构上执行层固定是第 4 层。
  // 编号必须与「哪些层恰好有实例」无关。
  const depth = layerDepth(lane.layer);
  const ordinal = depth === Number.MAX_SAFE_INTEGER ? null : depth + 1;
  // 「主会话所在层」必须由数据推导（哪个泳道里有 isActive 实例），不能由 activeLayer 推导：
  // activeLayer 还承载「用户点选过的层级」，用它会把这个标签错误地贴到用户点选的那一层上。
  const holdsActiveInstance = lane.instances.some((instance) => instance.isActive);
  // 已结束的实例仍然留在泳道里（这是刻意的），单独计数让用户知道这一层「跑完了几个」。
  const endedCount = lane.instances.filter(
    (instance) => resolveTerminalStatus(instance) !== null,
  ).length;

  return (
    <div style={LANE_STYLE}>
      <div style={RAIL_STYLE} aria-hidden>
        <span
          style={{
            ...RAIL_DOT_STYLE,
            background: lane.identity.color,
            // 聚焦反馈放在轨道节点上：用 boxShadow 描一圈，不改变布局尺寸（避免聚焦时抖动）。
            ...(laneFocused
              ? {
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${lane.identity.color} 24%, transparent)`,
                }
              : null),
          }}
        />
        {isLast ? null : <span style={RAIL_LINE_STYLE} />}
      </div>
      <div style={LANE_BODY_STYLE}>
        <div style={LANE_HEADER_STYLE}>
          <span
            style={{
              ...LANE_CODE_STYLE,
              color: lane.identity.color,
              background: `color-mix(in srgb, ${lane.identity.color} 16%, transparent)`,
            }}
          >
            {lane.identity.code ?? (ordinal === null ? '·' : String(ordinal))}
          </span>
          <span
            style={{
              ...LANE_NAME_STYLE,
              color: laneFocused ? lane.identity.color : 'var(--fg-strong)',
            }}
          >
            {lane.identity.label}
          </span>
          {/*
            标记刻意保持为同一元素内的纯文本：`getNodeText` 只拼接**直接文本子节点**，
            一旦拆成 <span> 子元素，「第 N 层」与「主会话所在层」就不再属于同一个文本节点，
            已有的泳道断言（/第 4 层.*主会话所在层/）会被判空。
          */}
          <span style={LANE_META_STYLE}>
            {ordinal === null ? '' : `第 ${ordinal} 层 · `}
            {instanceCount} 个角色 · {lane.messageCount} 条
            {endedCount > 0 ? ` · ${endedCount} 个已结束` : ''}
            {holdsActiveInstance ? ' · 主会话所在层' : ''}
            {laneFocused && !holdsActiveInstance ? ' · 已聚焦' : ''}
          </span>
        </div>
        <div style={CARD_ROW_STYLE}>
          {lane.instances.map((instance) => {
            const key = instanceKey(instance);
            return (
              <LayerRoleCard
                key={key}
                instance={instance}
                identity={lane.identity}
                expanded={expandedKeys.has(key)}
                onToggleExpanded={onToggleExpanded}
                onLayerSelect={onLayerSelect}
                pendingPermissions={pendingPermissions}
                resolveInlinePermissionActions={resolveInlinePermissionActions}
                onOpenSession={onOpenSession}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
