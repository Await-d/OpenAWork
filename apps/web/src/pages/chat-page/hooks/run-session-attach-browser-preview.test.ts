// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createInitialAttachProgressState,
  runSessionAttachEffect,
} from './run-session-attach-effect.js';
import type { SessionAttachDeps } from './session-attach-deps.js';

function createHarness() {
  const ref = <T>(current: T) => ({ current });
  let handlers: Parameters<SessionAttachDeps['client']['attachToActiveStream']>[1] | undefined;
  const openBrowserPreview = vi.fn();
  const setBrowserPreviewUrl = vi.fn();
  const setEditorMode = vi.fn();
  const activeSessionRef = ref<string | null>('session-1');
  const values = {
    activeGatewayStreamSessionId: null,
    activeSessionRef,
    activeStreamStartedAt: null,
    currentSessionId: 'session-1',
    currentSessionViewRef: ref({ sessionId: 'session-1', epoch: 1 }),
    isCurrentSessionRequest: (sid: string) => activeSessionRef.current === sid,
    isPageActive: true,
    isSessionSnapshotReady: true,
    sessionModesHydrated: true,
    sessionStateStatus: 'running',
    streaming: false,
    streamingRef: ref(false),
    recoveryActiveStream: null,
    recoveredStreamSnapshot: null,
    attachRetryScheduledSessionId: null,
    attachRetryExhausted: false,
    attachAttemptedSessionRef: ref(null),
    attachOwnerSessionIdRef: ref(null),
    attachEligibilitySignatureRef: ref(null),
    attachAttemptWindowRef: ref({ sessionId: 'session-1', count: 0, startedAt: 0 }),
    attachProgressRef: ref(createInitialAttachProgressState()),
    lastAttachAttemptTimestampRef: ref(0),
    currentAssistantStreamMessageIdRef: ref(null),
    stoppingStreamRef: ref(false),
    streamRevealTargetRef: ref(''),
    streamRevealVisibleRef: ref(''),
    streamRevealTargetCodePointsRef: ref<string[]>([]),
    streamRevealVisibleCodePointCountRef: ref(0),
    streamRevealNextAllowedAtRef: ref(0),
    devServerDetectedTerminalIdsRef: ref(new Set<string>()),
    effectiveModelId: 'model',
    effectiveProviderId: '',
    gatewayUrl: 'http://gateway.test',
    openBrowserPreview,
    setBrowserPreviewUrl,
    setEditorMode,
    sessionTerminals: { applyRunEvent: vi.fn() },
    client: {
      attachToActiveStream: vi.fn((_sid: string, callbacks: NonNullable<typeof handlers>) => {
        handlers = callbacks;
        return Promise.resolve(false);
      }),
      getActiveStreamClientRequestId: () => null,
    },
  };
  // 未参与本用例的状态 setter 仍为 spy；实际路由、检测及会话守卫运行真实代码。
  const deps = new Proxy(values, {
    get: (target, key) => (Reflect.has(target, key) ? Reflect.get(target, key) : vi.fn()),
  }) as unknown as SessionAttachDeps;
  runSessionAttachEffect(deps);
  if (!handlers) throw new Error('attach 未启动');
  return { handlers, openBrowserPreview, setBrowserPreviewUrl, setEditorMode, activeSessionRef };
}

describe('attach 浏览器预览路由', () => {
  it('恢复流检测开发服务后经布局入口打开且不重复处理同一终端', () => {
    const h = createHarness();
    const event = {
      type: 'terminal_output' as const,
      terminalId: 'dev',
      outputBytesTotal: 29,
      outputTail: 'Local: http://localhost:5173/',
    };
    h.handlers.onEvent?.(event);
    h.handlers.onEvent?.(event);
    expect(h.openBrowserPreview).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:5173/',
      'currentTab',
    );
    expect(h.setBrowserPreviewUrl).not.toHaveBeenCalled();
    expect(h.setEditorMode).not.toHaveBeenCalled();
  });

  it('会话切走后忽略迟到的恢复流开发服务事件', () => {
    const h = createHarness();
    h.activeSessionRef.current = 'session-2';
    h.handlers.onEvent?.({
      type: 'terminal_output',
      terminalId: 'dev',
      outputBytesTotal: 29,
      outputTail: 'Local: http://localhost:5173/',
    });
    expect(h.openBrowserPreview).not.toHaveBeenCalled();
  });
});
