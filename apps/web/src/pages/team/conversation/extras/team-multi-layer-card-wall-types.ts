import type { RoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import type { LayerMessages } from './team-layer-messages.js';

/**
 * 卡片墙渲染权限条所需的字段。
 *
 * 刻意不直接依赖 web-client 的 `PendingPermissionRequest`：卡片墙是纯展示层，
 * 它只需要知道「这条权限要显示成什么」，不需要知道「后端返回了什么」。
 * `PendingPermissionRequest` 结构上是本类型的超集，调用方直接透传即可。
 */
export interface CardPendingPermission {
  requestId: string;
  sessionId: string;
  status: 'pending' | 'approved' | 'rejected';
  toolName: string;
  reason: string;
  scope: string;
  riskLevel: string;
  previewAction?: string;
}

export type CardStatus =
  'streaming' | 'active' | 'error' | 'idle' | 'empty' | 'completed' | 'failed' | 'cancelled';

export interface CardStatusTone {
  color: string;
  label: string;
  pulse: boolean;
  /** 状态图标。终态用图标而不是色点，让「已结束」在一堆卡片里一眼可辨。 */
  glyph: string;
}

export interface LayerLane {
  layer: string;
  identity: RoleLayerIdentity;
  instances: LayerMessages[];
  messageCount: number;
}

/** 终态卡片状态。已结束的实例必须继续出卡片，所以这几个状态是一等展示态。 */
export type TerminalCardStatus = Extract<CardStatus, 'completed' | 'failed' | 'cancelled'>;
