/**
 * 前端遥测采集 hook。
 *
 * 职责：
 * - 初始化时从网关拉取同意状态，同步到 localStorage
 * - 暴露 trackEvent 方法（通过 web-client 上报到网关）
 * - 暴露 isTelemetryEnabled 状态
 * - 自动采集 app_start 事件（组件挂载且已同意时）
 * - 自动采集 error_boundary 事件（全局 error handler）
 *
 * 使用方式：
 * const { trackEvent, isTelemetryEnabled } = useTelemetry();
 * trackEvent('session_created', { sessionId: '...' });
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import { useAuthStore } from '../stores/auth/auth.js';

export type TelemetryConsentValue = 'accepted' | 'declined' | null;

interface UseTelemetryResult {
  /** 是否已同意遥测（可用于 UI 开关状态显示） */
  isTelemetryEnabled: boolean;
  /** 同意状态加载中 */
  isLoading: boolean;
  /** 上报遥测事件（静默失败，不抛出） */
  trackEvent: (
    name: 'app_start' | 'session_created' | 'tool_call' | 'skill_installed' | 'error_boundary',
    properties?: Record<string, string | number | boolean>,
  ) => void;
  /** 更新同意状态（同步到网关 + localStorage） */
  updateConsent: (status: 'accepted' | 'declined') => Promise<void>;
}

export function useTelemetry(): UseTelemetryResult {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [isTelemetryEnabled, setIsTelemetryEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const appStartTracked = useRef(false);

  // 从网关拉取同意状态
  useEffect(() => {
    if (!accessToken || !gatewayUrl) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = (await createSettingsClient(gatewayUrl).getTelemetryConsent(
          accessToken,
        )) as { status?: string | null };

        if (cancelled) return;

        const status = result?.status ?? null;
        const enabled = status === 'accepted';
        setIsTelemetryEnabled(enabled);

        // 同步到 localStorage 作为缓存
        if (status === 'accepted' || status === 'declined') {
          localStorage.setItem('telemetry_consent', status);
        }
      } catch {
        // 网络失败时降级到 localStorage 缓存
        const cached = localStorage.getItem('telemetry_consent');
        setIsTelemetryEnabled(cached === 'accepted');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

  // 自动采集 app_start 事件
  useEffect(() => {
    if (!isTelemetryEnabled || appStartTracked.current || !accessToken || !gatewayUrl) return;
    appStartTracked.current = true;

    void createSettingsClient(gatewayUrl)
      .reportTelemetryEvent(accessToken, 'app_start', {
        platform: navigator.platform,
        userAgent: navigator.userAgent.slice(0, 200),
        timestamp: Date.now(),
      })
      .catch(() => undefined);
  }, [isTelemetryEnabled, accessToken, gatewayUrl]);

  // 全局 error handler — 自动采集 error_boundary 事件
  useEffect(() => {
    if (!isTelemetryEnabled || !accessToken || !gatewayUrl) return;

    const handler = (event: ErrorEvent) => {
      const props: Record<string, string | number | boolean> = {
        errorName: event.error?.name ?? 'Error',
        message: (event.message ?? '').slice(0, 500),
        stack: (event.error?.stack ?? '').slice(0, 4000),
        platform: navigator.platform,
        appVersion: localStorage.getItem('app_version') ?? 'unknown',
        userAgent: navigator.userAgent.slice(0, 200),
      };

      createSettingsClient(gatewayUrl)
        .reportTelemetryEvent(accessToken, 'error_boundary', props)
        .catch(() => undefined);
    };

    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, [isTelemetryEnabled, accessToken, gatewayUrl]);

  const trackEvent = useCallback<UseTelemetryResult['trackEvent']>(
    (name, properties) => {
      if (!isTelemetryEnabled || !accessToken || !gatewayUrl) return;

      createSettingsClient(gatewayUrl)
        .reportTelemetryEvent(accessToken, name, properties)
        .catch(() => undefined);
    },
    [isTelemetryEnabled, accessToken, gatewayUrl],
  );

  const updateConsent = useCallback(
    async (status: 'accepted' | 'declined') => {
      // 先写 localStorage（即时生效）
      localStorage.setItem('telemetry_consent', status);
      localStorage.setItem('telemetry_consent_shown', '1');
      setIsTelemetryEnabled(status === 'accepted');

      // 同步到网关（失败不阻塞，localStorage 已生效）
      if (accessToken && gatewayUrl) {
        try {
          await createSettingsClient(gatewayUrl).updateTelemetryConsent(accessToken, status);
        } catch {
          // 网络失败不阻塞用户操作
        }
      }
    },
    [accessToken, gatewayUrl],
  );

  return {
    isTelemetryEnabled,
    isLoading,
    trackEvent,
    updateConsent,
  };
}
