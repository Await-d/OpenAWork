import { beforeEach, describe, expect, it } from 'vitest';
import { useIslandStore, type IslandViewState } from './island-store.js';

const INITIAL_STATE: IslandViewState = {
  agentState: 'idle',
  gatewayHealth: 'stopped',
  activeSessionId: null,
  sessionTitle: null,
  lastMessagePreview: '',
  expanded: false,
  visible: true,
};

function view(state: ReturnType<typeof useIslandStore.getState>): IslandViewState {
  const {
    agentState,
    gatewayHealth,
    activeSessionId,
    sessionTitle,
    lastMessagePreview,
    expanded,
    visible,
  } = state;
  return {
    agentState,
    gatewayHealth,
    activeSessionId,
    sessionTitle,
    lastMessagePreview,
    expanded,
    visible,
  };
}

beforeEach(() => {
  useIslandStore.setState(INITIAL_STATE);
});

describe('applyAgentState', () => {
  it('完整写入 state / sessionId / title / preview', () => {
    useIslandStore.getState().applyAgentState({
      state: 'streaming',
      sessionId: 'sess-1',
      title: '调试会话',
      preview: '正在生成代码…',
    });
    expect(view(useIslandStore.getState())).toMatchObject({
      agentState: 'streaming',
      activeSessionId: 'sess-1',
      sessionTitle: '调试会话',
      lastMessagePreview: '正在生成代码…',
    });
  });

  it('sessionId 可为 null(无活动会话)', () => {
    useIslandStore.getState().applyAgentState({
      state: 'completed',
      sessionId: null,
      title: null,
      preview: '',
    });
    expect(view(useIslandStore.getState())).toMatchObject({
      agentState: 'completed',
      activeSessionId: null,
      sessionTitle: null,
    });
  });
});

describe('applyGatewayHealth', () => {
  it('更新网关健康态', () => {
    useIslandStore.getState().applyGatewayHealth('healthy');
    expect(useIslandStore.getState().gatewayHealth).toBe('healthy');
  });
});

describe('setExpanded / setVisible', () => {
  it('独立切换,互不影响', () => {
    const store = useIslandStore.getState();
    store.setExpanded(true);
    expect(useIslandStore.getState().expanded).toBe(true);
    expect(useIslandStore.getState().visible).toBe(true);

    store.setVisible(false);
    expect(useIslandStore.getState().visible).toBe(false);
    expect(useIslandStore.getState().expanded).toBe(true);
  });
});

describe('状态转移(完整生命周期)', () => {
  it('running → streaming → completed 顺序收敛', () => {
    const { applyAgentState } = useIslandStore.getState();
    applyAgentState({ state: 'running', sessionId: 's1', title: 'T', preview: '' });
    applyAgentState({ state: 'streaming', sessionId: 's1', title: 'T', preview: '…' });
    applyAgentState({ state: 'completed', sessionId: 's1', title: 'T', preview: '完成' });
    expect(view(useIslandStore.getState())).toMatchObject({
      agentState: 'completed',
      activeSessionId: 's1',
      lastMessagePreview: '完成',
    });
  });
});
