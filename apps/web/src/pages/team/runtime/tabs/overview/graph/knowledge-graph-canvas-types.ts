/**
 * 知识图谱画布宿主组件的 props 契约。
 *
 * 与组件实现分离：视图层 / 舞台层只依赖这份类型即可装配画布，无需引入 G6 相关实现。
 */

import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import type { GraphViewportSize } from './knowledge-graph-layout.js';
import type {
  GraphLayoutMetrics,
  KnowledgeGraphColorMode,
  KnowledgeGraphLabelDensity,
} from './knowledge-graph-runtime.js';

export interface KnowledgeGraphCanvasProps {
  readonly graph: KnowledgeGraph;
  readonly colorMode: KnowledgeGraphColorMode;
  readonly labelDensity: KnowledgeGraphLabelDensity;
  readonly pan: { x: number; y: number };
  readonly zoom: number;
  readonly resetVersion: number;
  readonly selectedNodeId: string | null;
  /** 当前折叠的聚合节点集合（用于点击路由与样式）。 */
  readonly collapsedIds?: ReadonlySet<string>;
  /** 每个节点的后代计数（传给样式层派生聚合标签 / 半径）。 */
  readonly counts?: ReadonlyMap<string, number>;
  /** 因视口容量不足被拒绝展开的节点（无障碍层据此注解「无法展开」）。 */
  readonly capacityBlockedIds?: ReadonlySet<string>;
  /** 画布实测视口尺寸变化：展开策略据此判断容量（布局与本回调共用同一份测量值）。 */
  readonly onViewportSizeChange?: (size: GraphViewportSize) => void;
  /** 每次图数据重编译后的布局度量（可见数 / settle 耗时 / 最大重叠）。 */
  readonly onLayoutMetrics?: (metrics: GraphLayoutMetrics) => void;
  readonly onPanChange: (pan: { x: number; y: number }) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onSelectNode: (nodeId: string) => void;
  /** 点击非叶节点时触发：折叠节点展开、展开的非叶节点收起。 */
  readonly onToggleExpand?: (nodeId: string) => void;
}
