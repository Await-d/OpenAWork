import { describe, it, expect, beforeEach } from 'vitest';
import { TeamStoreImpl } from '../../team.js';
import type { TeamMember } from '../../team-member.js';

describe('Team Communication Integration', () => {
  let teamStore: TeamStoreImpl;
  const sessionId = 'test-session-001';

  beforeEach(() => {
    teamStore = new TeamStoreImpl();
    teamStore.startTeam(sessionId, 'Test Team', 'Integration test team');
  });

  it('场景1: 成员注册后应该自动订阅消息总线', () => {
    const member: TeamMember = {
      id: 'agent-01',
      name: 'Executor',
      role: 'executor',
      status: 'idle',
      messageQueue: [],
      capabilities: ['code', 'test'],
    };

    teamStore.addMember(sessionId, member);

    const team = teamStore.getTeam(sessionId);
    expect(team?.members).toHaveLength(1);
    expect(team?.members[0]?.id).toBe('agent-01');
  });

  it('场景2: 完整的请求-响应通信链路', async () => {
    // 添加两个成员
    teamStore.addMember(sessionId, {
      id: 'pm',
      name: 'Project Manager',
      role: 'pm1',
      status: 'idle',
      messageQueue: [],
      capabilities: ['plan'],
    });

    teamStore.addMember(sessionId, {
      id: 'executor',
      name: 'Executor',
      role: 'executor',
      status: 'idle',
      messageQueue: [],
      capabilities: ['code'],
    });

    // PM 发送请求
    teamStore.addMessage(sessionId, {
      from: 'pm',
      to: 'executor',
      content: '请实现用户登录功能',
      type: 'request',
      priority: 'high',
      requiresAck: true,
      timestamp: Date.now(),
    });

    // 等待消息处理
    await new Promise((resolve) => setTimeout(resolve, 50));

    const team = teamStore.getTeam(sessionId);
    const executorMember = team?.members.find((m) => m.id === 'executor');

    // 验证 executor 收到消息
    expect(executorMember?.messageQueue).toHaveLength(1);
    expect(executorMember?.messageQueue[0]?.type).toBe('request');

    // Executor 发送响应
    const requestMsg = executorMember?.messageQueue[0];
    teamStore.addMessage(sessionId, {
      from: 'executor',
      to: 'pm',
      replyTo: requestMsg?.id,
      content: '已完成登录功能实现',
      type: 'response',
      priority: 'normal',
      timestamp: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const pmMember = team?.members.find((m) => m.id === 'pm');
    expect(pmMember?.messageQueue).toHaveLength(1);
    expect(pmMember?.messageQueue[0]?.type).toBe('response');
    expect(pmMember?.messageQueue[0]?.replyTo).toBe(requestMsg?.id);
  });

  it('场景3: 广播消息应该分发到所有成员（除发送者）', async () => {
    // 添加 3 个成员
    ['agent-01', 'agent-02', 'agent-03'].forEach((id) => {
      teamStore.addMember(sessionId, {
        id,
        name: id,
        role: 'executor',
        status: 'idle',
        messageQueue: [],
        capabilities: [],
      });
    });

    // agent-01 发送广播
    teamStore.addMessage(sessionId, {
      from: 'agent-01',
      content: '团队会议开始',
      type: 'broadcast',
      priority: 'normal',
      timestamp: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const team = teamStore.getTeam(sessionId);
    const agent01 = team?.members.find((m) => m.id === 'agent-01');
    const agent02 = team?.members.find((m) => m.id === 'agent-02');
    const agent03 = team?.members.find((m) => m.id === 'agent-03');

    // agent-01 不应该收到自己的广播
    expect(agent01?.messageQueue).toHaveLength(0);

    // agent-02 和 agent-03 应该收到
    expect(agent02?.messageQueue).toHaveLength(1);
    expect(agent03?.messageQueue).toHaveLength(1);
  });

  it('场景4: 任务交接应该触发状态转换', async () => {
    teamStore.addMember(sessionId, {
      id: 'executor',
      name: 'Executor',
      role: 'executor',
      status: 'working',
      currentTask: 'task-001',
      messageQueue: [],
      capabilities: [],
    });

    teamStore.addMember(sessionId, {
      id: 'reviewer',
      name: 'Reviewer',
      role: 'reviewer',
      status: 'idle',
      messageQueue: [],
      capabilities: [],
    });

    // Executor 完成任务，交接给 Reviewer
    teamStore.addMessage(sessionId, {
      from: 'executor',
      to: 'reviewer',
      content: '代码已完成，请审查',
      type: 'handoff',
      priority: 'high',
      structuredData: {
        taskId: 'task-001',
        artifacts: ['src/login.ts', 'tests/login.test.ts'],
      },
      timestamp: Date.now(),
    });

    // 更新 executor 状态为完成
    teamStore.updateMember(sessionId, 'executor', {
      status: 'done',
      currentTask: undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const team = teamStore.getTeam(sessionId);
    const executor = team?.members.find((m) => m.id === 'executor');
    const reviewer = team?.members.find((m) => m.id === 'reviewer');

    expect(executor?.status).toBe('done');
    expect(reviewer?.messageQueue).toHaveLength(1);
    expect(reviewer?.messageQueue[0]?.type).toBe('handoff');
  });

  it('场景5: 成员进入 waiting_for_input 状态后应该阻塞', () => {
    teamStore.addMember(sessionId, {
      id: 'pm',
      name: 'PM',
      role: 'pm1',
      status: 'working',
      messageQueue: [],
      capabilities: [],
    });

    // PM 需要等待用户输入
    teamStore.updateMember(sessionId, 'pm', {
      status: 'waiting_for_input',
      waitingFor: 'user',
    });

    // 发送询问消息
    teamStore.addMessage(sessionId, {
      from: 'pm',
      to: 'user',
      content: '请提供详细需求',
      type: 'question',
      priority: 'high',
      requiresAck: true,
      timestamp: Date.now(),
    });

    const team = teamStore.getTeam(sessionId);
    const pm = team?.members.find((m) => m.id === 'pm');

    expect(pm?.status).toBe('waiting_for_input');
    expect(pm?.waitingFor).toBe('user');
  });

  it('场景6: 高并发消息路由性能测试', async () => {
    // 添加 10 个成员
    for (let i = 1; i <= 10; i++) {
      teamStore.addMember(sessionId, {
        id: `agent-${i.toString().padStart(2, '0')}`,
        name: `Agent ${i}`,
        role: 'executor',
        status: 'idle',
        messageQueue: [],
        capabilities: [],
      });
    }

    const startTime = Date.now();

    // 发送 100 条消息
    for (let i = 0; i < 100; i++) {
      teamStore.addMessage(sessionId, {
        from: 'coordinator',
        content: `Message ${i}`,
        type: 'broadcast',
        priority: 'normal',
        timestamp: Date.now(),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const duration = Date.now() - startTime;

    // 验证性能：100 条消息分发到 10 个成员应该在 500ms 内完成
    expect(duration).toBeLessThan(500);

    const team = teamStore.getTeam(sessionId);
    team?.members.forEach((member) => {
      expect(member.messageQueue.length).toBeLessThanOrEqual(100);
    });
  });

  it('场景7: 消息队列应该有长度限制（防止内存泄漏）', async () => {
    teamStore.addMember(sessionId, {
      id: 'agent-01',
      name: 'Agent 01',
      role: 'executor',
      status: 'idle',
      messageQueue: [],
      capabilities: [],
    });

    // 发送 150 条消息（超过队列限制 100）
    for (let i = 0; i < 150; i++) {
      teamStore.addMessage(sessionId, {
        from: 'coordinator',
        to: 'agent-01',
        content: `Message ${i}`,
        type: 'request',
        priority: 'normal',
        timestamp: Date.now(),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const team = teamStore.getTeam(sessionId);
    const agent = team?.members.find((m) => m.id === 'agent-01');

    // 队列应该被限制在 100 条以内
    expect(agent?.messageQueue.length).toBeLessThanOrEqual(100);
  });
});
