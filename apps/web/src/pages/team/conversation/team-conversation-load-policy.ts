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
