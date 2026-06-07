import type { SessionTask } from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isRuntimeTaskInSessionScope,
  isSessionInScope,
} from './team-runtime-session-scope.js';

interface SessionScopeRecord {
  id: string;
  parentSessionId: string | null;
}

export interface TeamRuntimeOverviewScopeResult<
  THandoff extends Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId'>,
  TTask extends Pick<SessionTask, 'sessionId'>,
  TSession extends SessionScopeRecord,
  TMessage,
  TAudit extends { sessionId?: string | null },
  TSharedSession,
> {
  sessionScope: Set<string> | null;
  handoffs: THandoff[];
  runtimeTasks: TTask[];
  sessions: TSession[];
  messages: TMessage[];
  auditLogs: TAudit[];
  sharedSessions: TSharedSession[];
}

export function scopeTeamRuntimeOverviewData<
  THandoff extends Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId'>,
  TTask extends Pick<SessionTask, 'sessionId'>,
  TSession extends SessionScopeRecord,
  TMessage extends { id: string; sessionId?: string | null },
  TAudit extends { sessionId?: string | null },
  TSharedSession extends { sessionId: string },
>(input: {
  selectedSessionId: string | null;
  handoffs: THandoff[];
  runtimeTasks: TTask[];
  sessions: TSession[];
  messages: TMessage[];
  auditLogs: TAudit[];
  sharedSessions: TSharedSession[];
}): TeamRuntimeOverviewScopeResult<THandoff, TTask, TSession, TMessage, TAudit, TSharedSession> {
  if (!input.selectedSessionId) {
    return {
      sessionScope: null,
      handoffs: input.handoffs,
      runtimeTasks: input.runtimeTasks,
      sessions: input.sessions,
      messages: input.messages,
      auditLogs: input.auditLogs,
      sharedSessions: input.sharedSessions,
    };
  }

  const sessionScope = collectSessionScope(input.selectedSessionId, input.sessions);
  return {
    sessionScope,
    handoffs: input.handoffs.filter((handoff) => isHandoffInSessionScope(handoff, sessionScope)),
    runtimeTasks: input.runtimeTasks.filter((task) =>
      isRuntimeTaskInSessionScope(task, sessionScope),
    ),
    sessions: input.sessions.filter((session) => sessionScope.has(session.id)),
    messages: input.messages.filter((message) =>
      isSessionInScope(message.sessionId ?? undefined, sessionScope),
    ),
    // audit log 现在开始逐步具备 sessionId 归属字段。对已归属的记录做真过滤；
    // 还未补 sessionId 的旧记录继续保留，避免在过渡期把审计轨迹误清空。
    auditLogs: input.auditLogs.filter(
      (log) => !log.sessionId || isSessionInScope(log.sessionId, sessionScope),
    ),
    sharedSessions: input.sharedSessions.filter((session) => sessionScope.has(session.sessionId)),
  };
}
