/**
 * TeamMultiLayerCardWall · 层级泳道式「角色窗口墙」
 *
 * 设计目标：右侧面板不再把各层级消息合并成一条时间线（见 TeamMultiLayerFeed），
 * 而是为每个「角色实例」开一个独立的小对话窗口 —— 一个窗口 = 一个角色实例的完整
 * 上下文，用户不必在交织的消息流里来回辨认「这句话到底是谁说的」。
 *
 * 为什么按层级分泳道，而不是平铺网格：
 * 团队的本质是层级对话，角色实例之间存在上下（父子）关系（数据见
 * LayerMessages.sourceLayer / sourceDisplayName）。纵向按层级深度排泳道、泳道内横向
 * 并排同层实例，才能在不画连线的前提下把「谁是谁的上游」表达出来。
 *
 * 布局：
 *   - 顶部：层级数 / 实例数 / 消息数 指标 + 全部展开收起
 *   - 主体：层级轨道（左）+ 泳道（右）。一条泳道 = 一个层级，泳道内是该层的角色实例卡片
 *   - 稀疏层级（接待层 / 规划层，见 COMPACT_LANE_LAYERS）实例 ≤1 时并到同一行各占一半，
 *     避免墙面顶部出现两大片只放一张卡片的空白行
 *   - 卡片：身份头（实例名 + 层级 + 条数 + 状态 + 展开）+ 上游来源行 + 消息凹槽 + 终态/动作
 *
 * 卡片两态（固定卡宽 → 窄而高的长方形，泳道内自动折行并排）：
 *   - 折叠（默认）：只展示**最新一条消息的一行**预览，用于扫视「谁刚说了什么」。
 *     正文 / 角色标签 / 时间戳这些细节一律不显示，只有展开后才看得到。
 *   - 展开：缩小版 chat 布局 —— assistant 左对齐气泡、用户右对齐气泡，
 *     固定更高的高度 + 独立滚动 + 贴底跟随。
 *   - 展开态按会话分键持久化到 localStorage：刷新 / 重建面板后仍保持
 *     用户刚摆好的阅读态（见 card-wall-expanded-state.ts）。
 *
 * 卡片内的可操作项（不必切回 feed 视图才能用）：
 *   - 待处理权限：按 `sessionId` 把网关返回的整棵子树权限请求各归其位，
 *     在卡片上直接点「本会话允许 / 允许一次 / 永久允许 / 拒绝」。
 *     贴在消息区**之外**，折叠态也不会被裁掉。
 *   - 完整会话：非主会话卡片提供入口，在底部「层级对话」抽屉里打开该角色实例的
 *     完整会话（卡片上的展开只渲染最近 40 条，抽屉里是真·完整会话）。
 *
 * 生命周期：实例结束 / 关闭后卡片**不消失**，而是切到终态展示态 ——
 *   - completed → ✓ 已完成 / failed → ✕ 已失败 / cancelled → ⊘ 已取消
 *   - 色点换成图标徽章、边框改虚线、底部加终态标识条（含结束时间），失败时补一行原因
 *   - 两态仍可折叠/展开，用户随时能回看已关闭实例的完整对话
 *   - 唯一例外：当前会话正在本地流式输出时不判终态（用户可能刚给已结束的
 *     实例发了新消息），见 resolveTerminalStatus 注释
 *
 * 密度：卡片以 CARD_WIDTH 为基准宽、泳道内 flex-wrap 折行、剩余宽度等分吸收
 * （单卡上限 CARD_MAX_WIDTH）—— 面板越宽并排越多，同时卡片自身也会略微变宽，
 * 不在右侧留出一条空白带。
 *
 * 性能策略：展开态用 TeamMessageBody 渲染（markdown / 事件卡 / JSON），
 * 不挂载 ChatMessageGroupList 那套完整消息机制；折叠态更省 —— 只渲染一行纯文本预览
 * （`getTeamMessagePreviewText`，完全不进 markdown 管道），展开态最多渲染
 * 最近 EXPANDED_MESSAGE_LIMIT 条，更早的折叠成一行提示。
 *
 * 滚动：每个卡片是独立滚动容器，贴底逻辑统一走 useStickToBottom ——
 * 用户上滚即暂停跟随，不会出现「正在读历史被拽回底部」。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ResolveInlinePermissionActionsFn } from '../../../../components/chat/session/ChatPageSections.js';
import type { LayerMessages } from './team-layer-messages.js';
import { readCardWallExpandedKeys, writeCardWallExpandedKeys } from './card-wall-expanded-state.js';
import { COMPACT_LANE_LAYERS } from './team-multi-layer-card-wall-constants.js';
import { LayerLaneRow } from './team-multi-layer-card-wall-lane.js';
import {
  buildLanes,
  instanceKey,
  resolveTerminalStatus,
} from './team-multi-layer-card-wall-model.js';
import {
  COMPACT_CELL_STYLE,
  COMPACT_ROW_STYLE,
  HEADER_BULK_BUTTON_STYLE,
  HEADER_HINT_STYLE,
  HEADER_NAME_STYLE,
  HEADER_STYLE,
  HEADER_TITLE_STYLE,
  METRIC_PILL_STYLE,
  METRIC_ROW_STYLE,
  PANEL_STYLE,
  WALL_EMPTY_STYLE,
  WALL_STYLE,
} from './team-multi-layer-card-wall-styles.js';
import type { CardPendingPermission, LayerLane } from './team-multi-layer-card-wall-types.js';

export type { CardPendingPermission } from './team-multi-layer-card-wall-types.js';

export interface TeamMultiLayerCardWallProps {
  /** 当前聚焦的层级 —— 该层泳道下的卡片会被高亮。 */
  activeLayer?: string | null;
  /** 全部角色实例消息组。 */
  layers: LayerMessages[];
  /** 点击卡片身份头 —— 聚焦该层级。 */
  onLayerSelect?: (layer: string) => void;
  /**
   * 当前会话 id。展开态按它分键持久化 —— 不同 team 会话的实例集合完全不同，
   * 共用一个键会让 A 会话展开过的卡片 id 泄进 B 会话。
   * 不传时退化为「不持久化」（内嵌 / 测试场景），不写 localStorage。
   */
  scopeKey?: string | null;
  /**
   * 当前会话树下的待处理权限请求（**含所有后代角色实例**，网关恢复接口一并返回）。
   * 卡片按 `sessionId` 各取自己那几条 —— 权限是实例级的，不能全堆到主会话上。
   */
  pendingPermissions?: readonly CardPendingPermission[];
  /**
   * 把 requestId 解析成可点动作。与 feed 视图共用 `TeamConversationView` 里
   * 同一份实现（它已经按 `request.sessionId` 定位目标会话），所以卡片里点
   * 「允许 / 拒绝」和主对话区里点是完全同一条链路。
   */
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  /**
   * 打开某个角色实例的完整会话（切主对话区过去）。
   * 不传则不渲染入口 —— 内嵌只读场景不该给出会跳走的按钮。
   */
  onOpenSession?: (sessionId: string) => void;
}

export function TeamMultiLayerCardWall({
  activeLayer,
  layers,
  onLayerSelect,
  scopeKey,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: TeamMultiLayerCardWallProps): ReactElement {
  const lanes = useMemo(() => buildLanes(layers), [layers]);
  // 稀疏层级（接待层 / 规划层）单独拎出来并排展示：它们各占一行时，一行里只有
  // 一张 220px 的卡片，剩下的横向空间全空着，整面墙被拉得很长。
  const { compactLanes, fullLanes } = useMemo(() => {
    const compact: LayerLane[] = [];
    const full: LayerLane[] = [];
    for (const lane of lanes) {
      if (COMPACT_LANE_LAYERS.has(lane.layer) && lane.instances.length <= 1) {
        compact.push(lane);
      } else {
        full.push(lane);
      }
    }
    return { compactLanes: compact, fullLanes: full };
  }, [lanes]);
  // 展开态从 localStorage 还原（按会话分键）——刷新一次就要把刚摆好的阅读态
  // 全部折回折叠态，等于让用户重做一遍。
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() =>
    readCardWallExpandedKeys(scopeKey),
  );

  // 会话切换时重新装载。侧栏在嵌入式场景（LayerConversationDrawer / 只读预览）
  // 不一定会随 sessionId 变化而重新挂载，只靠 useState 初始化会在组件复用后
  // 把上一个会话的展开态套到新会话上。
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    setExpandedKeys(readCardWallExpandedKeys(scopeKey));
  }, [scopeKey]);

  const instanceCount = useMemo(
    () => lanes.reduce((sum, lane) => sum + lane.instances.length, 0),
    [lanes],
  );
  const messageCount = useMemo(
    () => lanes.reduce((sum, lane) => sum + lane.messageCount, 0),
    [lanes],
  );
  const endedInstanceCount = useMemo(
    () =>
      lanes.reduce(
        (sum, lane) =>
          sum +
          lane.instances.filter((instance) => resolveTerminalStatus(instance) !== null).length,
        0,
      ),
    [lanes],
  );

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const allKeys = useMemo(
    () => lanes.flatMap((lane) => lane.instances.map((instance) => instanceKey(instance))),
    [lanes],
  );
  const allExpanded = allKeys.length > 0 && allKeys.every((key) => expandedKeys.has(key));

  // 依赖用「键集合的签名」而不是 allKeys 数组引用：流式输出每个 token 都会让
  // layers / lanes / allKeys 换新引用，直接依赖数组会把 localStorage 写成
  // 「每个 token 一次同步写」的热点。签名只在实际卡片集合变化时才变。
  const allKeysSignature = allKeys.join('\u0000');

  useEffect(() => {
    // 签名空 = 实例数据还没到（首帧 layers 为空）。此刻写盘会把上一次的展开态
    // 整个清空 —— 宁可不写，等数据到了再收敛。
    if (!scopeKey || allKeysSignature.length === 0) return;
    const liveKeys = new Set(allKeysSignature.split('\u0000'));
    writeCardWallExpandedKeys(
      scopeKey,
      [...expandedKeys].filter((key) => liveKeys.has(key)),
    );
  }, [allKeysSignature, expandedKeys, scopeKey]);

  const handleToggleAll = useCallback(() => {
    setExpandedKeys(allExpanded ? new Set<string>() : new Set(allKeys));
  }, [allExpanded, allKeys]);

  return (
    <div style={PANEL_STYLE} aria-label="团队角色窗口墙">
      <div style={HEADER_STYLE}>
        <div style={HEADER_TITLE_STYLE}>
          <span style={HEADER_NAME_STYLE}>角色窗口墙</span>
          {/*
            提示压到一行：右侧面板最窄时只有 ~500px，原来那句 24 字的说明会折成两行，
            和标题抢视线。折叠/展开的行为在卡片上已经有按钮自解释，这里只留最短的提示。
          */}
          <span style={HEADER_HINT_STYLE}>折叠看最新一条 · 展开看完整对话 · 已结束的窗口保留</span>
        </div>
        <div style={METRIC_ROW_STYLE}>
          <span style={METRIC_PILL_STYLE}>{lanes.length} 个层级</span>
          <span style={METRIC_PILL_STYLE}>{instanceCount} 个角色</span>
          <span style={METRIC_PILL_STYLE}>{messageCount} 条消息</span>
          {endedInstanceCount > 0 ? (
            <span style={METRIC_PILL_STYLE}>{endedInstanceCount} 个已结束</span>
          ) : null}
          {instanceCount > 0 ? (
            <button
              type="button"
              className="team-v2-control team-v2-control--surface"
              style={HEADER_BULK_BUTTON_STYLE}
              onClick={handleToggleAll}
            >
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          ) : null}
        </div>
      </div>
      <div style={WALL_STYLE}>
        {lanes.length === 0 ? (
          <div style={WALL_EMPTY_STYLE}>
            还没有任何角色的对话。
            <br />
            团队开始协作后，这里会为每个角色实例开一个独立的对话窗口。
          </div>
        ) : (
          <>
            {compactLanes.length > 0 ? (
              <div style={COMPACT_ROW_STYLE}>
                {compactLanes.map((lane, index) => (
                  <div key={lane.layer} style={COMPACT_CELL_STYLE} data-compact-lane="true">
                    <LayerLaneRow
                      lane={lane}
                      // 并排行下方若还有整行泳道，轨道线要继续往下画。
                      isLast={fullLanes.length === 0 && index === compactLanes.length - 1}
                      activeLayer={activeLayer}
                      expandedKeys={expandedKeys}
                      onToggleExpanded={handleToggleExpanded}
                      onLayerSelect={onLayerSelect}
                      pendingPermissions={pendingPermissions}
                      resolveInlinePermissionActions={resolveInlinePermissionActions}
                      onOpenSession={onOpenSession}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {fullLanes.map((lane, index) => (
              <LayerLaneRow
                key={lane.layer}
                lane={lane}
                isLast={index === fullLanes.length - 1}
                activeLayer={activeLayer}
                expandedKeys={expandedKeys}
                onToggleExpanded={handleToggleExpanded}
                onLayerSelect={onLayerSelect}
                pendingPermissions={pendingPermissions}
                resolveInlinePermissionActions={resolveInlinePermissionActions}
                onOpenSession={onOpenSession}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
