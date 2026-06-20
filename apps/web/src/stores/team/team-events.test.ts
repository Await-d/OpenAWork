import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeTeamEventsReconnectDelay,
  dispatchTeamEvent,
  resolveTeamEventsLivenessAction,
  getTeamNotificationEventKey,
  hydrateClarificationStore,
  hydrateNotificationStore,
  hydrateTeamRuntimeStores,
  resolveTeamEventsCloseStrategy,
  useClarificationStore,
  useHandoffStore,
  useLayerStore,
  useTeamNotificationStore,
} from './team-events.js';
import { useTeamToolCallStore, useTeamUsageStore } from './team-usage.js';

beforeEach(() => {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  useClarificationStore.getState().clear();
  useTeamNotificationStore.getState().clear();
  useTeamUsageStore.getState().clear();
  useTeamToolCallStore.getState().clear();
});

describe('computeTeamEventsReconnectDelay', () => {
  it('按指数退避增长并封顶', () => {
    expect(computeTeamEventsReconnectDelay(0)).toBe(2000);
    expect(computeTeamEventsReconnectDelay(1)).toBe(4000);
    expect(computeTeamEventsReconnectDelay(2)).toBe(8000);
    expect(computeTeamEventsReconnectDelay(10)).toBe(30000);
  });
});

describe('resolveTeamEventsLivenessAction (§0.150 半开探活)', () => {
  it('服务端活动在容忍窗口内时继续发送 ping', () => {
    expect(
      resolveTeamEventsLivenessAction({
        msSinceLastServerActivity: 10_000,
        livenessTimeoutMs: 40_000,
      }),
    ).toBe('ping');
  });

  it('刚好等于容忍窗口时仍发 ping（边界不误杀）', () => {
    expect(
      resolveTeamEventsLivenessAction({
        msSinceLastServerActivity: 40_000,
        livenessTimeoutMs: 40_000,
      }),
    ).toBe('ping');
  });

  it('服务端静默超过容忍窗口时判定为 reconnect（半开 → 拆除重连）', () => {
    expect(
      resolveTeamEventsLivenessAction({
        msSinceLastServerActivity: 40_001,
        livenessTimeoutMs: 40_000,
      }),
    ).toBe('reconnect');
  });

  it('使用默认容忍窗口（无显式参数）', () => {
    // 默认 40s：单次丢失 pong（15s 间隔）不会误判，长期静默才 reconnect。
    expect(resolveTeamEventsLivenessAction({ msSinceLastServerActivity: 16_000 })).toBe('ping');
    expect(resolveTeamEventsLivenessAction({ msSinceLastServerActivity: 60_000 })).toBe(
      'reconnect',
    );
  });
});

describe('resolveTeamEventsCloseStrategy', () => {
  it('认证失败时停止重连', () => {
    expect(
      resolveTeamEventsCloseStrategy({
        closeCode: 1008,
        lastErrorCode: 'UNAUTHORIZED',
        manualDisconnect: false,
        online: true,
      }),
    ).toEqual({
      lastError: 'team-events 认证失效，请重新登录后再连接。',
      shouldReconnect: false,
      state: 'stopped',
    });
  });

  it('离线时保持 offline 并等待恢复', () => {
    expect(
      resolveTeamEventsCloseStrategy({
        closeCode: 1006,
        lastErrorCode: null,
        manualDisconnect: false,
        online: false,
      }),
    ).toEqual({
      lastError: '当前网络离线，等待网络恢复。',
      shouldReconnect: true,
      state: 'offline',
    });
  });

  it('手动断开时直接 stopped', () => {
    expect(
      resolveTeamEventsCloseStrategy({
        closeCode: 1000,
        lastErrorCode: null,
        manualDisconnect: true,
        online: true,
      }),
    ).toEqual({
      lastError: null,
      shouldReconnect: false,
      state: 'stopped',
    });
  });
});

describe('hydrateTeamRuntimeStores', () => {
  it('会用 runtime snapshot 重建 handoff 与 layer 状态', () => {
    hydrateTeamRuntimeStores({
      handoffs: [
        {
          claimedAt: '2026-05-25T10:00:00.000Z',
          completedAt: null,
          failureReason: null,
          fromRoleLayer: 'pm2',
          fromSessionId: 'session-pm2',
          id: 'handoff-1',
          recoverableFailure: true,
          retryCount: 2,
          startedAt: '2026-05-25T10:00:05.000Z',
          state: 'running',
          toRoleLayer: 'executor',
          toSessionId: 'session-executor',
          updatedAt: '2026-05-25T10:01:00.000Z',
        },
      ],
      sessions: [
        {
          id: 'session-pm2',
          parentSessionId: 'session-pm1',
          roleLayer: 'pm2',
          stateStatus: 'running',
          title: 'PM2 Session',
        },
        {
          id: 'session-executor',
          parentSessionId: 'session-pm2',
          roleInstance: {
            rootSessionId: 'session-root',
            roleLayer: 'executor',
            personaKey: 'executor:frontend',
            displayName: '前端开发者',
          },
          roleLayer: 'executor',
          stateStatus: 'idle',
          title: 'Executor Session',
        },
      ],
    });

    const handoff = useHandoffStore.getState().handoffs.get('handoff-1');
    expect(handoff).toMatchObject({
      failureReason: null,
      fromSessionId: 'session-pm2',
      id: 'handoff-1',
      fromRoleLayer: 'pm2',
      recoverableFailure: true,
      retryCount: 2,
      sessionId: 'session-executor',
      state: 'running',
      toSessionId: 'session-executor',
      toRoleLayer: 'executor',
    });
    expect(handoff?.startedAt).toBe(Date.parse('2026-05-25T10:00:05.000Z'));

    expect(useLayerStore.getState().nodes.get('session-pm2')).toMatchObject({
      parentSessionId: 'session-pm1',
      roleLayer: 'pm2',
      sessionId: 'session-pm2',
      state: 'running',
      title: 'PM2 Session',
    });
    expect(useLayerStore.getState().nodes.get('session-executor')).toMatchObject({
      parentSessionId: 'session-pm2',
      rootSessionId: 'session-root',
      roleLayer: 'executor',
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
      sessionId: 'session-executor',
      state: 'idle',
      title: 'Executor Session',
    });
  });
});

describe('dispatchTeamEvent · 角色实例展示', () => {
  it('handoff.started 会把 assignedMember 写入 layer 节点', () => {
    dispatchTeamEvent({
      type: 'handoff.started',
      taskId: 'handoff-role-instance',
      sessionId: 'session-executor',
      timestamp: 100,
      payload: {
        fromRoleLayer: 'pm2',
        toRoleLayer: 'executor',
        fromSessionId: 'session-pm2',
        toSessionId: 'session-executor',
        state: 'running',
        assignedMember: {
          id: 'executor-frontend',
          displayName: '前端开发者',
          personaKey: 'executor:frontend',
          specialty: 'frontend',
        },
      },
    });

    expect(useLayerStore.getState().nodes.get('session-executor')).toMatchObject({
      displayName: '前端开发者',
      parentSessionId: 'session-pm2',
      personaKey: 'executor:frontend',
      roleLayer: 'executor',
      sessionId: 'session-executor',
      state: 'running',
    });
  });
});

describe('hydrateClarificationStore', () => {
  it('会用 runtime snapshot 覆盖待处理项，并保留本地已答/已忽略状态', () => {
    useClarificationStore.getState().markAnswered('local-answered', '已有答案');
    useClarificationStore.setState({
      items: [
        {
          id: 'local-answered',
          sessionId: 'pm1-session',
          fromSessionId: 'pm1-session',
          question: '已有问题',
          context: '已有上下文',
          createdAt: 1,
          status: 'answered',
          answer: '已有答案',
          answeredAt: 2,
        },
      ],
      pendingCount: 0,
    });

    hydrateClarificationStore([
      {
        context: '登录模块',
        createdAt: 10,
        fromSessionId: 'pm1-session',
        id: 'q-1',
        question: '认证方式？',
        sessionId: 'pm1-session',
        status: 'pending',
      },
      {
        context: '已有上下文',
        createdAt: 1,
        fromSessionId: 'pm1-session',
        id: 'local-answered',
        question: '已有问题',
        sessionId: 'pm1-session',
        status: 'pending',
      },
    ]);

    const items = useClarificationStore.getState().items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'q-1',
          status: 'pending',
        }),
        expect.objectContaining({
          id: 'local-answered',
          status: 'answered',
          answer: '已有答案',
        }),
      ]),
    );
    expect(useClarificationStore.getState().pendingCount).toBe(1);
  });
});

describe('hydrateNotificationStore', () => {
  it('会合并 runtime 恢复通知并按唯一键去重', () => {
    useTeamNotificationStore.getState().push({
      layer: 'pm2',
      payload: { summary: '已存在通知' },
      sessionId: 'session-1',
      taskId: 'task-1',
      timestamp: 100,
      type: 'escalation_request',
    });

    hydrateNotificationStore([
      {
        layer: 'pm2',
        payload: { summary: '已存在通知' },
        sessionId: 'session-1',
        taskId: 'task-1',
        timestamp: 100,
        type: 'escalation_request',
      },
      {
        layer: 'executor',
        payload: { summary: '执行进度 3/5' },
        sessionId: 'session-2',
        taskId: 'task-2',
        timestamp: 200,
        type: 'progress_report',
      },
    ]);

    const state = useTeamNotificationStore.getState();
    expect(state.events).toHaveLength(2);
    expect(state.unreadCount).toBe(2);
    expect(state.events[1]).toMatchObject({
      type: 'progress_report',
      payload: { summary: '执行进度 3/5' },
    });
  });
});

describe('useTeamNotificationStore read lifecycle', () => {
  it('markEventRead / markEventUnread 会和 unreadCount 保持一致', () => {
    const first = {
      layer: 'pm2',
      payload: { summary: '阻塞通知' },
      sessionId: 'session-1',
      taskId: 'task-1',
      timestamp: 100,
      type: 'escalation_request',
    } as const;
    const second = {
      layer: 'executor',
      payload: { summary: '执行进度 3/5' },
      sessionId: 'session-2',
      taskId: 'task-2',
      timestamp: 200,
      type: 'progress_report',
    } as const;

    useTeamNotificationStore.getState().push(first);
    useTeamNotificationStore.getState().push(second);
    expect(useTeamNotificationStore.getState().unreadCount).toBe(2);

    const firstKey = getTeamNotificationEventKey(first);
    useTeamNotificationStore.getState().markEventRead(firstKey);
    expect(useTeamNotificationStore.getState().readEventKeys.has(firstKey)).toBe(true);
    expect(useTeamNotificationStore.getState().unreadCount).toBe(1);

    useTeamNotificationStore.getState().markEventUnread(firstKey);
    expect(useTeamNotificationStore.getState().readEventKeys.has(firstKey)).toBe(false);
    expect(useTeamNotificationStore.getState().unreadCount).toBe(2);
  });

  it('事件滚出 100 条窗口后，readEventKeys 不会无界增长且 unreadCount 一致', () => {
    const store = useTeamNotificationStore.getState();
    // 推 60 条并全部标记已读：events 与 readEventKeys 都是 60。
    for (let i = 0; i < 60; i += 1) {
      const event = {
        payload: { summary: `批次A-${i}` },
        sessionId: `sa-${i}`,
        taskId: `ta-${i}`,
        timestamp: 1_000 + i,
        type: 'progress_report',
      } as const;
      store.push(event);
      useTeamNotificationStore.getState().markEventRead(getTeamNotificationEventKey(event));
    }
    expect(useTeamNotificationStore.getState().events).toHaveLength(60);
    expect(useTeamNotificationStore.getState().readEventKeys.size).toBe(60);
    expect(useTeamNotificationStore.getState().unreadCount).toBe(0);

    // 再推 100 条新事件（不标记已读）：events 封顶 100，最早的 60 条全部被挤出。
    for (let i = 0; i < 100; i += 1) {
      useTeamNotificationStore.getState().push({
        payload: { summary: `批次B-${i}` },
        sessionId: `sb-${i}`,
        taskId: `tb-${i}`,
        timestamp: 2_000 + i,
        type: 'progress_report',
      });
    }

    const finalState = useTeamNotificationStore.getState();
    // events 封顶 100。
    expect(finalState.events).toHaveLength(100);
    // 被挤出的已读事件其 key 已从 readEventKeys 清除（不再无界增长）：
    // 存活的 100 条全是未读的批次B，故 readEventKeys 应为空。
    expect(finalState.readEventKeys.size).toBe(0);
    // unreadCount 与存活缓冲一致：100 条都未读。
    expect(finalState.unreadCount).toBe(100);
    // readEventKeys 中的每个 key 都必须对应一条仍存活的事件。
    const survivingKeys = new Set(finalState.events.map(getTeamNotificationEventKey));
    for (const key of finalState.readEventKeys) {
      expect(survivingKeys.has(key)).toBe(true);
    }
  });
});

describe('useHandoffStore · 请求载荷摘要', () => {
  it('从事件 payload 提取 summary（rewrittenIntent 优先）并固定', () => {
    const store = useHandoffStore.getState();
    store.applyEvent({
      type: 'handoff.created',
      taskId: 'h-summary-1',
      sessionId: 'sess-1',
      timestamp: 1,
      payload: {
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        state: 'pending',
        sourceIntent: '原始意图',
        rewrittenIntent: '改写后的意图',
      },
    });
    expect(useHandoffStore.getState().handoffs.get('h-summary-1')?.summary).toBe('改写后的意图');

    // 后续事件不带 summary 字段时不覆盖已固定的 summary
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId: 'h-summary-1',
      sessionId: 'sess-1',
      timestamp: 2,
      payload: { state: 'running' },
    });
    expect(useHandoffStore.getState().handoffs.get('h-summary-1')?.summary).toBe('改写后的意图');
  });

  it('payload 无可用文案时 summary 为 undefined', () => {
    useHandoffStore.getState().applyEvent({
      type: 'handoff.created',
      taskId: 'h-summary-2',
      sessionId: 'sess-2',
      timestamp: 1,
      payload: { fromRoleLayer: 'pm1', toRoleLayer: 'pm2', state: 'pending' },
    });
    expect(useHandoffStore.getState().handoffs.get('h-summary-2')?.summary).toBeUndefined();
  });

  it('会保留事件里的真实 fromSessionId / toSessionId', () => {
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId: 'h-session-ids',
      sessionId: 'pm2-session',
      timestamp: 10,
      payload: {
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
        fromSessionId: 'pm1-session',
        toSessionId: 'pm2-session',
        state: 'running',
      },
    });

    expect(useHandoffStore.getState().handoffs.get('h-session-ids')).toMatchObject({
      fromSessionId: 'pm1-session',
      sessionId: 'pm2-session',
      toSessionId: 'pm2-session',
    });
  });

  it('会保留 handoff.failed 事件里的失败原因、重试轮次与可恢复标记', () => {
    useHandoffStore.getState().applyEvent({
      type: 'handoff.failed',
      taskId: 'h-failure-meta',
      sessionId: 'sess-failed',
      timestamp: 20,
      payload: {
        fromRoleLayer: 'pm2',
        toRoleLayer: 'executor',
        state: 'failed',
        reason: 'runner-fail',
        retryCount: 3,
        recoverableFailure: true,
      },
    });

    expect(useHandoffStore.getState().handoffs.get('h-failure-meta')).toMatchObject({
      failureReason: 'runner-fail',
      recoverableFailure: true,
      retryCount: 3,
      state: 'failed',
    });
  });
});

describe('useHandoffStore · 事件单调性守卫 (#9)', () => {
  it('较旧 timestamp 的乱序事件不会让状态从 completed 回退', () => {
    const taskId = 'h-mono-1';
    // 正常推进到终态 completed（timestamp=300）
    useHandoffStore.getState().applyEvent({
      type: 'handoff.created',
      taskId,
      sessionId: 'sess-mono',
      timestamp: 100,
      payload: { fromRoleLayer: 'pm2', toRoleLayer: 'executor', state: 'pending' },
    });
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId,
      sessionId: 'sess-mono',
      timestamp: 200,
      payload: { state: 'running' },
    });
    useHandoffStore.getState().applyEvent({
      type: 'handoff.completed',
      taskId,
      sessionId: 'sess-mono',
      timestamp: 300,
      payload: { state: 'completed' },
    });
    expect(useHandoffStore.getState().handoffs.get(taskId)?.state).toBe('completed');
    expect(useHandoffStore.getState().handoffs.get(taskId)?.endedAt).toBe(300);

    // 断连补发：一条**较旧**的 running 事件（timestamp=200）迟到。必须被丢弃，
    // 不能把状态回退成 running、也不能清掉 endedAt。
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId,
      sessionId: 'sess-mono',
      timestamp: 200,
      payload: { state: 'running' },
    });
    expect(useHandoffStore.getState().handoffs.get(taskId)?.state).toBe('completed');
    expect(useHandoffStore.getState().handoffs.get(taskId)?.endedAt).toBe(300);
    expect(useHandoffStore.getState().handoffs.get(taskId)?.updatedAt).toBe(300);
  });

  it('合法的 retry（running→pending，timestamp 更新）仍被接受', () => {
    const taskId = 'h-mono-2';
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId,
      sessionId: 'sess-retry',
      timestamp: 100,
      payload: { fromRoleLayer: 'pm2', toRoleLayer: 'executor', state: 'running' },
    });
    expect(useHandoffStore.getState().handoffs.get(taskId)?.state).toBe('running');

    // recovery 把 running 退回 pending（retry）：带**更新**的 timestamp，应被接受。
    useHandoffStore.getState().applyEvent({
      type: 'handoff.requeued',
      taskId,
      sessionId: 'sess-retry',
      timestamp: 500,
      payload: { state: 'pending' },
    });
    expect(useHandoffStore.getState().handoffs.get(taskId)?.state).toBe('pending');
    expect(useHandoffStore.getState().handoffs.get(taskId)?.updatedAt).toBe(500);
  });

  it('相同 timestamp 的事件仍被接受（>= 边界）', () => {
    const taskId = 'h-mono-3';
    useHandoffStore.getState().applyEvent({
      type: 'handoff.started',
      taskId,
      sessionId: 'sess-eq',
      timestamp: 100,
      payload: { fromRoleLayer: 'pm2', toRoleLayer: 'executor', state: 'running' },
    });
    useHandoffStore.getState().applyEvent({
      type: 'handoff.completed',
      taskId,
      sessionId: 'sess-eq',
      timestamp: 100,
      payload: { state: 'completed' },
    });
    expect(useHandoffStore.getState().handoffs.get(taskId)?.state).toBe('completed');
  });
});

describe('dispatchTeamEvent · 度量遥测事件不污染通知 / handoff store', () => {
  it('team_usage 事件只进 usage store，不进 notification / handoff store', () => {
    dispatchTeamEvent({
      // 后端复用 session.substate.changed 作为遥测信封类型
      type: 'session.substate.changed',
      sessionId: 'sess-telemetry',
      timestamp: 10,
      payload: {
        __teamEventKind: 'team_usage',
        sessionId: 'sess-telemetry',
        layer: 'pm1',
        provider: 'anthropic',
        inputTokens: 120,
        outputTokens: 30,
        costUsd: 0.05,
      },
    });

    // 不进"待回复"通知列表（否则会被大量阶段更新刷屏 + 触发 reload 风暴）
    expect(useTeamNotificationStore.getState().events).toHaveLength(0);
    expect(useTeamNotificationStore.getState().unreadCount).toBe(0);
    // 不进 handoff store
    expect(useHandoffStore.getState().handoffs.size).toBe(0);
    // 进 usage store
    expect(useTeamUsageStore.getState().byLayer.get('pm1')?.inputTokens).toBe(120);
    expect(useTeamUsageStore.getState().total.count).toBe(1);
  });

  it('team_tool_call / team_timing 同样不进通知列表', () => {
    useLayerStore.getState().addNode({
      sessionId: 'sess-t2',
      roleLayer: 'pm2',
      parentSessionId: null,
      state: 'running',
    });
    dispatchTeamEvent({
      type: 'session.substate.changed',
      sessionId: 'sess-t2',
      timestamp: 11,
      payload: {
        __teamEventKind: 'team_tool_call',
        sessionId: 'sess-t2',
        agentId: 'critic',
        toolName: 'read',
        durationMs: 40,
        success: false,
        errorMessage: 'denied',
      },
    });
    dispatchTeamEvent({
      type: 'session.substate.changed',
      sessionId: 'sess-t2',
      timestamp: 12,
      payload: { __teamEventKind: 'team_timing', sessionId: 'sess-t2', totalMs: 1500 },
    });
    expect(useTeamNotificationStore.getState().events).toHaveLength(0);
    expect(useTeamToolCallStore.getState().bySession.get('sess-t2')).toEqual({
      invocations: 1,
      failures: 1,
    });
    expect(useTeamToolCallStore.getState().byLayer.get('pm2')).toEqual({
      invocations: 1,
      failures: 1,
    });
    expect(useTeamToolCallStore.getState().byAgent.get('critic')?.get('read')).toBe(1);
    expect(useTeamToolCallStore.getState().bySessionTool.get('sess-t2')?.get('read')).toMatchObject(
      {
        invocations: 1,
        failures: 1,
        totalDurationMs: 40,
      },
    );
  });

  it('session 工具明细不会串入其他 session 的全局累计', () => {
    useLayerStore.getState().addNode({
      sessionId: 'sess-a',
      roleLayer: 'pm1',
      parentSessionId: null,
      state: 'running',
    });
    useLayerStore.getState().addNode({
      sessionId: 'sess-b',
      roleLayer: 'pm2',
      parentSessionId: null,
      state: 'running',
    });

    dispatchTeamEvent({
      type: 'session.substate.changed',
      sessionId: 'sess-a',
      timestamp: 1,
      payload: {
        __teamEventKind: 'team_tool_call',
        sessionId: 'sess-a',
        agentId: 'agent-a',
        toolName: 'read',
        durationMs: 15,
        success: true,
      },
    });
    dispatchTeamEvent({
      type: 'session.substate.changed',
      sessionId: 'sess-b',
      timestamp: 2,
      payload: {
        __teamEventKind: 'team_tool_call',
        sessionId: 'sess-b',
        agentId: 'agent-b',
        toolName: 'read',
        durationMs: 25,
        success: true,
      },
    });

    expect(useTeamToolCallStore.getState().byTool.get('read')?.invocations).toBe(2);
    expect(useTeamToolCallStore.getState().bySessionTool.get('sess-a')?.get('read')).toMatchObject({
      invocations: 1,
      totalDurationMs: 15,
    });
    expect(useTeamToolCallStore.getState().bySessionTool.get('sess-b')?.get('read')).toMatchObject({
      invocations: 1,
      totalDurationMs: 25,
    });
  });

  it('真正的 session.substate.changed（无 __teamEventKind）仍进通知列表', () => {
    dispatchTeamEvent({
      type: 'session.substate.changed',
      sessionId: 'sess-real',
      timestamp: 13,
      payload: { substate: 'drafting_spec' },
    });
    expect(useTeamNotificationStore.getState().events).toHaveLength(1);
    expect(useTeamNotificationStore.getState().events[0]?.type).toBe('session.substate.changed');
  });
});
