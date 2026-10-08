/**
 * 客户端错误诊断中枢。
 *
 * 目标：让「客户端出的错」一定留下可排查的痕迹。落地方式是一个进程级单例
 * `ClientErrorRecorder` + 全局捕获安装：
 *
 * - **无条件本地记录**：不依赖遥测授权、不依赖登录态。此前全局 `error` 监听挂在
 *   遥测门禁下，未授权用户的所有错误直接消失，开发者完全看不到。
 * - **补齐未处理 Promise 拒绝**：`unhandledrejection` 承载着 fire-and-forget 请求
 *   与事件回调里的真实故障，此前完全没有采集。
 * - **可导出**：错误页与设置面板都可以把 `exportClientErrorDiagnostics()` 的结果
 *   直接交给用户反馈，不必依赖能否连上对方浏览器控制台。
 *
 * 上报（外发）是**另一件事**：由 `use-telemetry` 订阅本记录器，仅在用户已同意遥测
 * 时才把记录转成 `error_boundary` 事件。记录与上报的解耦保证「隐私约束」不被削弱，
 * 同时「排查能力」不再被授权状态绑架。
 */
import { ClientErrorRecorder, installGlobalErrorCapture } from '@openAwork/logger';
import { logger } from './logger.js';

/**
 * 容量 200 条：足以覆盖一次会话内的多次故障，又不至于让 localStorage/内存占用失控。
 * 去重窗口 3s：React 嵌套 ErrorBoundary 会为同一次渲染错误逐层上报。
 */
export const clientErrorRecorder = new ClientErrorRecorder({
  capacity: 200,
  dedupeWindowMs: 3_000,
});

// 记录器 → 本地 logger。每条错误都写一条 error 级日志，带脱敏后的消息与堆栈。
clientErrorRecorder.subscribe((record) => {
  logger.error(
    `[client:${record.source}] ${record.name}: ${record.message}`,
    ...(record.stack ? [record.stack] : []),
  );
});

function buildContext(): Record<string, string> {
  const context: Record<string, string> = {
    href: globalThis.location?.href?.slice(0, 500) ?? 'unknown',
  };
  const version = globalThis.localStorage?.getItem('app_version');
  if (version) context.appVersion = version;
  const platform = globalThis.navigator?.platform;
  if (platform) context.platform = platform;
  return context;
}

let uninstallGlobalCapture: (() => void) | null = null;

/**
 * 安装全局捕获。幂等：重复调用（例如 HMR 或二次挂载）不会叠加监听器，
 * 否则同一条错误会被记录 N 次，反而淹没真实故障。
 */
export function installClientErrorCapture(): void {
  if (uninstallGlobalCapture) return;
  uninstallGlobalCapture = installGlobalErrorCapture({
    recorder: clientErrorRecorder,
    buildContext,
  });
}

/** 仅供测试：卸载并复位，使 `installClientErrorCapture` 可再次生效。 */
export function resetClientErrorCaptureForTest(): void {
  uninstallGlobalCapture?.();
  uninstallGlobalCapture = null;
}

/** 手动记录一条错误（用于 catch 块里已知但未冒泡的错误）。 */
export function recordClientError(
  error: unknown,
  context?: Record<string, string>,
): void {
  clientErrorRecorder.record({
    source: 'manual',
    error,
    ...(context ? { context } : {}),
  });
}

/**
 * 导出诊断文本，供用户复制反馈。
 *
 * 除错误记录外还带上运行环境——很多「无法复现」的问题靠版本号 / UA 就能定位。
 */
export function exportClientErrorDiagnostics(): string {
  const lines = [clientErrorRecorder.toText(), '', '── 环境 ──'];
  const version = globalThis.localStorage?.getItem('app_version') ?? 'unknown';
  lines.push(`版本：${version}`);
  lines.push(`地址：${globalThis.location?.href ?? 'unknown'}`);
  lines.push(`UA：${globalThis.navigator?.userAgent ?? 'unknown'}`);
  return lines.join('\n');
}