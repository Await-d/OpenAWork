import { create } from 'zustand';
import type { IslandAgentState, IslandGatewayHealth } from './island-types.js';

/**
 * 灵动岛窗口专属 store。
 *
 * 注意:island 是**独立 WebView**,与主窗口的 Zustand 互不共享内存。本 store
 * 只作为 island 窗口的本地渲染态,所有数据经 Tauri 事件流入(见 IslandApp)。
 */
export interface IslandAgentStatePayload {
  state: IslandAgentState;
  sessionId: string | null;
  title: string | null;
  preview: string;
}

export interface IslandViewState {
  /** 当前 Agent 运行态。 */
  agentState: IslandAgentState;
  /** 当前网关健康态。 */
  gatewayHealth: IslandGatewayHealth;
  /** 当前会话 id(无则 null)。 */
  activeSessionId: string | null;
  /** 当前会话标题(可空)。 */
  sessionTitle: string | null;
  /** 最后一条消息预览(已截断)。 */
  lastMessagePreview: string;
  /** 是否处于展开态。 */
  expanded: boolean;
  /** 窗口是否可见(仅用于内部状态镜像)。 */
  visible: boolean;
}

export interface IslandStore extends IslandViewState {
  applyAgentState: (payload: IslandAgentStatePayload) => void;
  applyGatewayHealth: (health: IslandGatewayHealth) => void;
  setExpanded: (expanded: boolean) => void;
  setVisible: (visible: boolean) => void;
}

export const useIslandStore = create<IslandStore>((set) => ({
  agentState: 'idle',
  gatewayHealth: 'stopped',
  activeSessionId: null,
  sessionTitle: null,
  lastMessagePreview: '',
  expanded: false,
  visible: true,
  applyAgentState: ({ state, sessionId, title, preview }) =>
    set({
      agentState: state,
      activeSessionId: sessionId,
      sessionTitle: title,
      lastMessagePreview: preview,
    }),
  applyGatewayHealth: (health) => set({ gatewayHealth: health }),
  setExpanded: (expanded) => set({ expanded }),
  setVisible: (visible) => set({ visible }),
}));
