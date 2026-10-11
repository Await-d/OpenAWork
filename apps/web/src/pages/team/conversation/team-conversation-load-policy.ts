import type { SessionStateStatus } from '../../../components/conversation-runtime/session/session-runtime.js';
import type { TeamRoleLayer } from '../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../hooks/recoverable-read-model.js';

const TEAM_CONVERSATION_RECOVERY_RETRY_BASE_MS = 2_000;
const TEAM_CONVERSATION_RECOVERY_RETRY_MAX_MS = 30_000;
const TEAM_CONVERSATION_PROVIDERS_RETRY_BASE_MS = 2_000;
const TEAM_CONVERSATION_PROVIDERS_RETRY_MAX_MS = 30_000;
/** 默认加载最近 50 轮（与 MultiLayerFeed / LayerChat 窗口一致）。 */
export const TEAM_CONVERSATION_INITIAL_TURN_LIMIT = 50;
/** 上滑无感加载：每次再扩 50 轮。 */
export const TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT = 50;
/**
 * 团队会话快照轮询时，向 `/recovery` 索取的活跃 run events 条数上限。
 *
 * 该 hook 的 runEvents 只喂 `TeamRunEventsPreview`：先把连续 `text_delta` 合并成条目，
 * 再 `slice(-8)` 取最后 8 条渲染。原始 delta 的条数远多于条目数，200 条原始事件已经
 * 覆盖远超 8 条合并后条目所需的窗口，同时把单次响应钉在常数体积。
 *
 * 取有界窗口是**必需**的而非优化：活跃 scope（clientRequestId）的 run event 行数随这一
 * 轮 run 的时长只增不减（每个 delta chunk 一行，retention 只按 scope 保留、在飞 scope
 * 永不清理），而本 hook 在 `sessionStateStatus === 'running'` 期间每 2.5s 轮询一次。
 * 不设上限时单次请求要全量读 + 逐行 JSON.parse + 整包回传，轮询越久越慢。
 */
export const TEAM_RECOVERY_RUN_EVENT_LIMIT = 200;

export function computeTeamConversationRecoveryRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_CONVERSATION_RECOVERY_RETRY_BASE_MS,
    maxMs: TEAM_CONVERSATION_RECOVERY_RETRY_MAX_MS,
  });
}

export function formatTeamConversationRecoveryLoadError(input: {
  hasCachedSnapshot: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队会话快照失败。',
    hasRetainedData: input.hasCachedSnapshot,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '会话快照',
    retryable: input.result.retryable,
  });
}

export function computeTeamConversationProvidersRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_CONVERSATION_PROVIDERS_RETRY_BASE_MS,
    maxMs: TEAM_CONVERSATION_PROVIDERS_RETRY_MAX_MS,
  });
}

export function formatTeamConversationProvidersLoadError(input: {
  hasCachedProviders: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载 Provider 列表失败。',
    hasRetainedData: input.hasCachedProviders,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: 'Provider 列表',
    retryable: input.result.retryable,
  });
}

export function resolveSessionSidebarRunState(
  streaming: boolean,
  sessionStateStatus: SessionStateStatus | null,
): 'idle' | 'running' | 'paused' {
  if (streaming || sessionStateStatus === 'running') {
    return 'running';
  }
  if (sessionStateStatus === 'paused') {
    return 'paused';
  }
  return 'idle';
}

export function isSessionBusyForSidebar(
  streaming: boolean,
  sessionStateStatus: SessionStateStatus | null,
): boolean {
  return streaming || sessionStateStatus === 'running' || sessionStateStatus === 'paused';
}

export function toTeamRoleLayer(value: string | null | undefined): TeamRoleLayer | null {
  switch (value) {
    case 'user':
    case 'reception':
    case 'pm1':
    case 'pm2':
    case 'executor':
    case 'tester':
    case 'reviewer':
      return value;
    default:
      return null;
  }
}
