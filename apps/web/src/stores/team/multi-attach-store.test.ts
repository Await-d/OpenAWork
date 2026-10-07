import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { useMultiAttachStore } from './multi-attach-store.js';

const SESSION_ID = 'session-multi-attach';

function resetStore(): void {
  useMultiAttachStore.setState({
    sessions: new Map(),
    handlers: new Map(),
    processedRowIds: new Map(),
    pendingEvents: new Map(),
  });
}

function buildTextDelta(delta: string): RunEvent {
  return {
    type: 'text_delta',
    delta,
  };
}

beforeEach(() => {
  resetStore();
});

describe('multi-attach-store', () => {
  it('事件先到、handler 后注册时会补发缓存的流式事件', () => {
    const store = useMultiAttachStore.getState();
    store.setSessionState(SESSION_ID, 'connected');

    store.dispatchEvent(SESSION_ID, buildTextDelta('hello'), {
      rowId: 1,
      clientRequestId: 'req-1',
    });

    const received: Array<{ event: RunEvent; rowId: number; clientRequestId?: string }> = [];
    const unregister = store.registerHandler(SESSION_ID, (event, meta) => {
      received.push({
        event,
        rowId: meta.rowId,
        ...(meta.clientRequestId ? { clientRequestId: meta.clientRequestId } : {}),
      });
    });

    expect(received).toEqual([
      {
        event: buildTextDelta('hello'),
        rowId: 1,
        clientRequestId: 'req-1',
      },
    ]);
    expect(useMultiAttachStore.getState().pendingEvents.get(SESSION_ID)).toBeUndefined();

    store.dispatchEvent(SESSION_ID, buildTextDelta('hello'), {
      rowId: 1,
      clientRequestId: 'req-1',
    });
    expect(received).toHaveLength(1);

    unregister();
  });

  it('连接已关闭后仍会补发排队事件', () => {
    const store = useMultiAttachStore.getState();
    store.setSessionState(SESSION_ID, 'connected');
    store.dispatchEvent(SESSION_ID, buildTextDelta('queued-after-close'), {
      rowId: 3,
      clientRequestId: 'req-3',
    });
    store.setSessionState(SESSION_ID, 'closed');

    const received: Array<{ event: RunEvent; rowId: number; clientRequestId?: string }> = [];
    const unregister = store.registerHandler(SESSION_ID, (event, meta) => {
      received.push({
        event,
        rowId: meta.rowId,
        ...(meta.clientRequestId ? { clientRequestId: meta.clientRequestId } : {}),
      });
    });

    expect(received).toEqual([
      {
        event: buildTextDelta('queued-after-close'),
        rowId: 3,
        clientRequestId: 'req-3',
      },
    ]);
    expect(useMultiAttachStore.getState().pendingEvents.get(SESSION_ID)).toBeUndefined();

    unregister();
  });

  it('removeSession 会同时清理去重与待补发缓存', () => {
    const store = useMultiAttachStore.getState();
    store.setSessionState(SESSION_ID, 'connected');
    store.dispatchEvent(SESSION_ID, buildTextDelta('queued'), { rowId: 2 });

    expect(useMultiAttachStore.getState().processedRowIds.get(SESSION_ID)?.has(2)).toBe(true);
    expect(useMultiAttachStore.getState().pendingEvents.get(SESSION_ID)).toHaveLength(1);

    store.removeSession(SESSION_ID);

    const next = useMultiAttachStore.getState();
    expect(next.sessions.has(SESSION_ID)).toBe(false);
    expect(next.processedRowIds.has(SESSION_ID)).toBe(false);
    expect(next.pendingEvents.has(SESSION_ID)).toBe(false);
  });

  it('dispatchEvent 单次写入同时更新 lastRowId 与 lastEventAt，重复 rowId 提前返回', () => {
    const store = useMultiAttachStore.getState();
    store.setSessionState(SESSION_ID, 'connected');

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(111);
    store.dispatchEvent(SESSION_ID, buildTextDelta('hi'), { rowId: 7 });

    const status = useMultiAttachStore.getState().sessions.get(SESSION_ID);
    expect(status?.lastRowId).toBe(7);
    expect(status?.lastEventAt).toBe(111);

    nowSpy.mockReturnValue(222);
    store.dispatchEvent(SESSION_ID, buildTextDelta('hi-again'), { rowId: 7 });
    expect(useMultiAttachStore.getState().sessions.get(SESSION_ID)?.lastEventAt).toBe(111);

    nowSpy.mockRestore();
  });
});
