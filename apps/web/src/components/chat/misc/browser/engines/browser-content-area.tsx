/**
 * 内置浏览器的内容区：Tauri 原生 webview 的加载 / 错误占位，或 iframe 预览
 * （就绪状态条 + iframe + 跨域提示）。
 *
 * 页面就绪探测与"iframe 已加载 URL"标记跟内容区强相关，因此一并收在这里由本
 * 组件持有；宿主只提供 URL、刷新信号与日志上报回调。
 */

import { useEffect, useRef, type RefObject } from 'react';
import { BrowserReadinessBar } from '../BrowserReadinessBar.js';
import { injectConsoleProxy } from '../console-proxy.js';
import { isLocalhostUrl } from '../browser-storage.js';
import { resolveDevicePreset } from '../device-presets.js';
import { usePageReadiness } from '../use-page-readiness.js';
import type { ConsoleEntry } from '../browser-console-types.js';
import { CdpLiveEngine } from './cdp-live-engine.js';
import type { BrowserLiveSession } from '../hooks/use-browser-live-session.js';

interface BrowserContentAreaProps {
  containerRef: RefObject<HTMLDivElement | null>;
  isTauri: boolean;
  webviewReady: boolean;
  webviewError: string | null;
  activeUrl: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  activeTabId: string;
  refreshKey: number;
  hidden: boolean;
  appendLogToActiveTab: (entry: ConsoleEntry) => void;
  consoleOpen: boolean;
  onRefreshRequested: () => void;
  /** CDP 实时引擎可用且支持 screencast：接管内容区（iframe 保留为回退）。 */
  liveActive: boolean;
  liveSession: BrowserLiveSession | null;
  /** CDP 实时引擎是否可用（与是否 screencast 无关）：可用时跨域页面同样由 CDP 采集日志。 */
  liveAvailable: boolean;
  pickArmed: boolean;
  onPickConsumed: () => void;
  /** 拾取被 Esc 取消：宿主解除武装。 */
  onPickCancel: () => void;
  /** 拾取意图（composer 引用 / 检查器取完整样式）；缺省 composer。 */
  pickIntent?: 'composer' | 'styles';
  /** 拾取坐标上报：宿主记录后供检查器复用。 */
  onPickPoint?: (point: { x: number; y: number }) => void;
  /** 设备预设 id：iframe 回退分支按它给容器定尺寸（自适应 = 铺满面板）。 */
  devicePresetId: string;
  /** 纯前端缩放档位（1 = 100%）。 */
  zoom: number;
}

export function BrowserContentArea({
  containerRef,
  isTauri,
  webviewReady,
  webviewError,
  activeUrl,
  iframeRef,
  activeTabId,
  refreshKey,
  hidden,
  appendLogToActiveTab,
  consoleOpen,
  onRefreshRequested,
  liveActive,
  liveSession,
  liveAvailable,
  pickArmed,
  onPickConsumed,
  onPickCancel,
  pickIntent,
  onPickPoint,
  devicePresetId,
  zoom,
}: BrowserContentAreaProps) {
  /**
   * 记录"iframe 已经成功加载过哪个 URL"。页面就绪探测成功后据此判断
   * 是否需要重新加载：只有当当前 URL 从没加载成功过（典型的"服务还没
   * 起来就先加载了"）才刷新，正常情况不会多打一次请求。
   */
  const iframeLoadedUrlRef = useRef<string | null>(null);

  // ── 页面就绪探测 ────────────────────────────────────────────────────
  // dev server 从启动到开始监听端口有几秒空窗，这段时间加载必然是错误页。
  // 这里主动探活，就绪后如果当前 URL 还没加载成功过就自动重载一次，
  // 用户不必再手动刷新；探测期间顶部状态条给出明确反馈。
  // Tauri 原生 webview 由宿主管理加载，不参与探测；实时引擎接管时 iframe 不渲染，
  // 探测也没有意义。
  const pageReadiness = usePageReadiness({
    url: activeUrl,
    enabled: !isTauri && !liveActive,
    onReady: () => {
      if (iframeLoadedUrlRef.current === activeUrl) return;
      onRefreshRequested();
    },
  });

  // URL 变化时重置"已加载"标记，让新地址重新走一次就绪判断。
  useEffect(() => {
    iframeLoadedUrlRef.current = null;
  }, [activeUrl]);

  // iframe 回退分支没有 UA 覆写能力：设备预设只体现为容器尺寸 + 纯前端缩放。
  const preset = resolveDevicePreset(devicePresetId);
  const deviceViewport =
    preset !== null && preset.width > 0 && preset.height > 0
      ? { width: preset.width, height: preset.height }
      : null;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isTauri ? (
        <>
          {!webviewReady && !webviewError && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--fg-muted)',
                fontSize: 12,
              }}
            >
              正在加载 Webview…
            </div>
          )}
          {webviewError && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 16,
                color: 'var(--fg-muted)',
                fontSize: 11,
                textAlign: 'center',
              }}
            >
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Webview 创建失败</span>
              <span style={{ maxWidth: 260, wordBreak: 'break-word' }}>{webviewError}</span>
            </div>
          )}
        </>
      ) : liveActive && liveSession !== null ? (
        <CdpLiveEngine
          session={liveSession}
          url={activeUrl}
          hidden={hidden}
          pickArmed={pickArmed}
          onPickConsumed={onPickConsumed}
          onPickCancel={onPickCancel}
          pickIntent={pickIntent}
          onPickPoint={onPickPoint}
          refreshKey={refreshKey}
          devicePresetId={devicePresetId}
          zoom={zoom}
        />
      ) : (
        <>
          <BrowserReadinessBar
            state={pageReadiness.state}
            attempt={pageReadiness.attempt}
            nextRetryInMs={pageReadiness.nextRetryInMs}
            url={activeUrl}
            onRetry={pageReadiness.retry}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              overflow: 'auto',
              scrollbarWidth: 'thin',
            }}
          >
            <div
              data-testid="browser-iframe-stage"
              style={{
                margin: 'auto',
                flexShrink: 0,
                width: deviceViewport?.width ?? '100%',
                height: deviceViewport?.height ?? '100%',
                transform: zoom === 1 ? undefined : `scale(${zoom})`,
                transformOrigin: 'center',
                display: hidden ? 'none' : undefined,
              }}
            >
              <iframe
                ref={iframeRef}
                key={`${activeTabId}-${refreshKey}`}
                src={activeUrl}
                title="内置浏览器"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  display: 'block',
                }}
                onLoad={() => {
                  iframeLoadedUrlRef.current = activeUrl;
                  try {
                    const iframeWindow = iframeRef.current?.contentWindow;
                    if (iframeWindow) {
                      injectConsoleProxy(iframeWindow);
                    }
                  } catch {
                    appendLogToActiveTab({
                      id: `${Date.now()}-info`,
                      level: 'info',
                      message: liveAvailable
                        ? `页面已加载: ${activeUrl}（控制台与网络由网关侧实时引擎采集）`
                        : `页面已加载: ${activeUrl}（跨域页面无法捕获控制台输出）`,
                      timestamp: Date.now(),
                    });
                  }
                }}
                onError={() => {
                  appendLogToActiveTab({
                    id: `${Date.now()}-err`,
                    level: 'error',
                    message: `无法加载: ${activeUrl}`,
                    timestamp: Date.now(),
                  });
                }}
              />
            </div>
          </div>
          {activeUrl && !isLocalhostUrl(activeUrl) && !consoleOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                right: 8,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'color-mix(in oklch, var(--bg-overlay) 95%, var(--warning) 5%)',
                border: '1px solid color-mix(in oklch, var(--warning) 30%, var(--border-default))',
                fontSize: 10,
                color: 'var(--fg-default)',
                pointerEvents: 'none',
                opacity: 0.9,
              }}
            >
              💡 提示：大多数外部网站禁止在 iframe
              中加载。本地开发服务器（localhost）可正常预览，外部站点请用「在系统浏览器中打开」。
            </div>
          )}
        </>
      )}
    </div>
  );
}
