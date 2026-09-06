import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectTeamEvents, disconnectTeamEvents } from './team-events.js';

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    TestSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
  }
  addEventListener = vi.fn();
}

afterEach(() => {
  disconnectTeamEvents();
  TestSocket.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('team-events 连接切换', () => {
  it('旧连接延迟 close 不得清空新连接或用旧凭据重连', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', TestSocket);
    connectTeamEvents('http://localhost:3000', 'old');
    const old = TestSocket.instances[0]!;
    disconnectTeamEvents();
    connectTeamEvents('http://localhost:3000', 'new');
    old.onclose?.({ code: 1006 });
    old.onerror?.();
    vi.advanceTimersByTime(30_000);
    connectTeamEvents('http://localhost:3000', 'new');
    expect(TestSocket.instances).toHaveLength(2);
    expect(TestSocket.instances[1]?.url).toContain('token=new');
  });
});
