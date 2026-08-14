import { describe, it, expect, vi } from 'vitest';
import { MessageBusImpl } from '../message-bus.js';
import type { TeamMessage } from '../team-message.js';

describe('MessageBusImpl', () => {
  it('应该能订阅和取消订阅', () => {
    const bus = new MessageBusImpl();
    const handler = vi.fn();

    bus.subscribe('agent-01', handler);
    expect(bus.getPendingCount('agent-01')).toBe(0);

    bus.unsubscribe('agent-01');
    expect(bus.getPendingCount('agent-01')).toBe(0);
  });

  it('应该能发布消息到指定接收者', async () => {
    const bus = new MessageBusImpl();
    const handler = vi.fn();

    bus.subscribe('agent-02', handler);

    const message: TeamMessage = {
      id: 'msg-001',
      from: 'agent-01',
      to: 'agent-02',
      content: 'Hello',
      type: 'request',
      priority: 'normal',
      timestamp: Date.now(),
    };

    bus.publish(message);

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalledWith(message);
    expect(bus.getPendingCount('agent-02')).toBe(1);
  });

  it('应该能广播消息到所有订阅者', async () => {
    const bus = new MessageBusImpl();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe('agent-01', handler1);
    bus.subscribe('agent-02', handler2);

    const message: TeamMessage = {
      id: 'msg-002',
      from: 'coordinator',
      content: 'Broadcast message',
      type: 'broadcast',
      priority: 'normal',
      timestamp: Date.now(),
    };

    bus.publish(message);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // coordinator 不是订阅者，所以两个 agent 都应该收到
    expect(handler1).toHaveBeenCalledWith(message);
    expect(handler2).toHaveBeenCalledWith(message);
  });

  it('路由应该排除发送者本身', () => {
    const bus = new MessageBusImpl();
    bus.subscribe('agent-01', vi.fn());
    bus.subscribe('agent-02', vi.fn());

    const message: TeamMessage = {
      id: 'msg-003',
      from: 'agent-01',
      to: ['agent-01', 'agent-02'],
      content: 'Test',
      type: 'request',
      priority: 'normal',
      timestamp: Date.now(),
    };

    const recipients = bus.route(message);

    expect(recipients).not.toContain('agent-01');
    expect(recipients).toContain('agent-02');
  });

  it('队列应该有长度限制', async () => {
    const bus = new MessageBusImpl();
    bus.subscribe('agent-01', vi.fn());

    // 发送 150 条消息（超过限制 100）
    for (let i = 0; i < 150; i++) {
      const message: TeamMessage = {
        id: `msg-${i}`,
        from: 'coordinator',
        to: 'agent-01',
        content: `Message ${i}`,
        type: 'request',
        priority: 'normal',
        timestamp: Date.now(),
      };
      bus.publish(message);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 队列应该被限制在 100 条
    expect(bus.getPendingCount('agent-01')).toBe(100);
  });
});
