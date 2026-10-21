// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope } from '@openAwork/shared';
import { toLiveScrollMetrics, useLiveScrollMetrics } from './use-live-scroll-metrics.js';
import type { BrowserLivePhase, BrowserLiveSession } from './use-browser-live-session.js';

interface SessionHarness {
  session: BrowserLiveSession;
  sent: Array<Record<string, unknown>>;
  emit: (envelope: BrowserLiveEnvelope) => void;
}

function createSessionHarness(phase: BrowserLivePhase = 'connected'): SessionHarness {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Set<(envelope: BrowserLiveEnvelope) => void>();

  return {
    sent,
    emit: (envelope) => {
      for (const listener of [...listeners]) listener(envelope);
    },
    session: {
      availability: null,
      phase,
      lastError: null,
      unavailableHint: null,
      send: (message) => {
        sent.push(message as unknown as Record<string, unknown>);
      },
      screenshot: () => Promise.resolve(null),
      close: () => undefined,
      recheckAvailability: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

function scrollEnvelope(payload: Record<string, unknown>): BrowserLiveEnvelope {
  return { ch: 'scroll', seq: 1, ts: 0, payload };
}

function frameEnvelope(scrollOffsetY: number): BrowserLiveEnvelope {
  return {
    ch: 'frame',
    seq: 2,
    ts: 0,
    payload: {
      mimeType: 'image/jpeg',
      data: '',
      deviceWidth: 200,
      deviceHeight: 100,
      offsetTop: 0,
      pageScaleFactor: 1,
      scrollOffsetX: 0,
      scrollOffsetY,
      frameSessionId: 1,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('toLiveScrollMetrics', () => {
  it('接受完整形状并把越界滚动位置夹到上限', () => {
    expect(
      toLiveScrollMetrics({
        scrollY: 999,
        maxScrollY: 300,
        viewportHeight: 200,
        contentHeight: 500,
      }),
    ).toEqual({ scrollY: 300, maxScrollY: 300, viewportHeight: 200, contentHeight: 500 });
  });

  it('字段缺失 / 非数字时返回 null', () => {
    expect(toLiveScrollMetrics(null)).toBeNull();
    expect(toLiveScrollMetrics({ scrollY: 0, maxScrollY: 0, viewportHeight: 0 })).toBeNull();
    expect(
      toLiveScrollMetrics({
        scrollY: '0',
        maxScrollY: 300,
        viewportHeight: 200,
        contentHeight: 500,
      }),
    ).toBeNull();
  });
});

describe('useLiveScrollMetrics', () => {
  it('连接后请求指标，收到 scroll 回包写进状态', () => {
    const harness = createSessionHarness();
    const { result } = renderHook(() =>
      useLiveScrollMetrics({ session: harness.session, enabled: true, resetKey: 'tab:a' }),
    );

    expect(harness.sent).toContainEqual({ ch: 'control', action: 'scroll.metrics' });

    act(() => {
      harness.emit(
        scrollEnvelope({ scrollY: 120, maxScrollY: 600, viewportHeight: 300, contentHeight: 900 }),
      );
    });

    expect(result.current.metrics).toEqual({
      scrollY: 120,
      maxScrollY: 600,
      viewportHeight: 300,
      contentHeight: 900,
    });
  });

  it('帧元数据把 thumb 位置拉回真实滚动值并夹到上限', () => {
    const harness = createSessionHarness();
    const { result } = renderHook(() =>
      useLiveScrollMetrics({ session: harness.session, enabled: true, resetKey: 'tab:a' }),
    );

    act(() => {
      harness.emit(
        scrollEnvelope({ scrollY: 0, maxScrollY: 300, viewportHeight: 200, contentHeight: 500 }),
      );
      harness.emit(frameEnvelope(180));
    });
    expect(result.current.metrics?.scrollY).toBe(180);

    // 超过 maxScroll 的偏移按上限收敛，避免 thumb 被画出轨道。
    act(() => harness.emit(frameEnvelope(900)));
    expect(result.current.metrics?.scrollY).toBe(300);
  });

  it('resetKey 变化时清空旧指标并重新请求', () => {
    const harness = createSessionHarness();
    const { result, rerender } = renderHook(
      (props: { resetKey: string }) =>
        useLiveScrollMetrics({ session: harness.session, enabled: true, resetKey: props.resetKey }),
      { initialProps: { resetKey: 'tab:a' } },
    );

    act(() => {
      harness.emit(
        scrollEnvelope({ scrollY: 40, maxScrollY: 300, viewportHeight: 200, contentHeight: 500 }),
      );
    });
    expect(result.current.metrics?.scrollY).toBe(40);

    const before = harness.sent.length;
    rerender({ resetKey: 'tab:b' });

    expect(result.current.metrics).toBeNull();
    expect(harness.sent.length).toBeGreaterThan(before);
    expect(harness.sent.at(-1)).toEqual({ ch: 'control', action: 'scroll.metrics' });
  });

  it('enabled=false 时清空指标且不再请求', () => {
    const harness = createSessionHarness();
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useLiveScrollMetrics({
          session: harness.session,
          enabled: props.enabled,
          resetKey: 'tab:a',
        }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      harness.emit(
        scrollEnvelope({ scrollY: 40, maxScrollY: 300, viewportHeight: 200, contentHeight: 500 }),
      );
    });

    const before = harness.sent.length;
    rerender({ enabled: false });

    expect(result.current.metrics).toBeNull();
    expect(harness.sent.length).toBe(before);
  });
});
