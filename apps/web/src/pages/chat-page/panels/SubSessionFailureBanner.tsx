import { useEffect, useRef, useState } from 'react';
import type { SessionTask } from '@openAwork/web-client';
import { formatTimeoutSourceLabel, getStatusLabel } from './sub-agent-run-list.js';
import './SubSessionFailureBanner.css';

export interface SubSessionFailureBannerProps {
  readonly childSessionId: string;
  readonly failedTasks: readonly SessionTask[];
  readonly onOpenFullSession: (sessionId: string) => void;
  readonly sessionStateStatus: string | undefined;
}

type CopyFeedback = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_RESET_MS = 1500;
const MISSING_ERROR_TEXT = '未记录错误详情';

function resolveTaskIdentity(task: SessionTask): string {
  const title = task.title.trim();
  if (title) {
    return title;
  }

  const assignedAgent = task.assignedAgent?.trim();
  if (assignedAgent) {
    return assignedAgent;
  }

  return task.id.slice(0, 8);
}

function resolveErrorMessage(task: SessionTask): string | null {
  const errorMessage = task.errorMessage;
  return errorMessage && errorMessage.trim().length > 0 ? errorMessage : null;
}

function buildFailureReport(
  childSessionId: string,
  failedTasks: readonly SessionTask[],
  sessionStateStatus: string | undefined,
): string {
  const lines: string[] = [
    '子代理执行失败',
    `会话 ID：${childSessionId}`,
    `会话状态：${sessionStateStatus ?? '未知'}`,
    `失败任务数：${failedTasks.length}`,
  ];

  failedTasks.forEach((task, index) => {
    const errorMessage = resolveErrorMessage(task);
    const timeoutSourceLabel =
      task.terminalReason === 'timeout' && task.timeoutSource
        ? formatTimeoutSourceLabel(task.timeoutSource)
        : '无';

    lines.push(
      '',
      `[${index + 1}] ${resolveTaskIdentity(task)}`,
      '状态：失败',
      `错误：${errorMessage ?? MISSING_ERROR_TEXT}`,
      `终止原因：${task.terminalReason ?? '未知'}`,
      `超时来源：${timeoutSourceLabel}`,
    );
  });

  if (failedTasks.length === 0 && sessionStateStatus === 'error') {
    lines.push('', '会话级错误：未记录任务级错误详情，请打开完整会话查看上下文。');
  }

  return lines.join('\n');
}

export function SubSessionFailureBanner({
  childSessionId,
  failedTasks,
  onOpenFullSession,
  sessionStateStatus,
}: SubSessionFailureBannerProps) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>('idle');
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  const orderedFailedTasks = [...failedTasks].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const hasSessionLevelError = sessionStateStatus === 'error';

  if (orderedFailedTasks.length === 0 && !hasSessionLevelError) {
    return null;
  }

  const scheduleCopyReset = (): void => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }

    copyResetTimerRef.current = window.setTimeout(() => {
      copyResetTimerRef.current = null;
      setCopyFeedback('idle');
    }, COPY_FEEDBACK_RESET_MS);
  };

  const handleCopy = async (): Promise<void> => {
    const report = buildFailureReport(childSessionId, orderedFailedTasks, sessionStateStatus);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setCopyFeedback('failed');
      scheduleCopyReset();
      return;
    }

    try {
      await clipboard.writeText(report);
      setCopyFeedback('copied');
    } catch {
      setCopyFeedback('failed');
    }
    scheduleCopyReset();
  };

  const copyLabel =
    copyFeedback === 'copied' ? '已复制' : copyFeedback === 'failed' ? '复制失败' : '复制错误';

  return (
    <section className="sub-session-failure-banner" role="alert" aria-label="子代理执行失败">
      <div className="sub-session-failure-banner__header">
        <svg
          aria-hidden="true"
          className="sub-session-failure-banner__icon"
          fill="none"
          height="13"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="13"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <span className="sub-session-failure-banner__title">子代理执行失败</span>
        {orderedFailedTasks.length > 0 && (
          <span className="sub-session-failure-banner__count">
            {orderedFailedTasks.length} 个失败任务
          </span>
        )}
      </div>

      {orderedFailedTasks.length > 0 && (
        <ul className="sub-session-failure-banner__list">
          {orderedFailedTasks.map((task) => {
            const identity = resolveTaskIdentity(task);
            const errorMessage = resolveErrorMessage(task);
            const timeoutHint =
              task.terminalReason === 'timeout' && task.timeoutSource
                ? `超时原因：${formatTimeoutSourceLabel(task.timeoutSource)}`
                : null;

            return (
              <li className="sub-session-failure-banner__item" key={task.id}>
                <div className="sub-session-failure-banner__identity">
                  <span className="sub-session-failure-banner__name" title={identity}>
                    {identity}
                  </span>
                  <span className="sub-session-failure-banner__status">
                    {getStatusLabel(task.status)}
                  </span>
                </div>
                {errorMessage ? (
                  <pre className="sub-session-failure-banner__error">{errorMessage}</pre>
                ) : (
                  <p className="sub-session-failure-banner__error sub-session-failure-banner__error--empty">
                    {MISSING_ERROR_TEXT}
                  </p>
                )}
                {timeoutHint && (
                  <div className="sub-session-failure-banner__timeout">{timeoutHint}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {orderedFailedTasks.length === 0 && hasSessionLevelError && (
        <p className="sub-session-failure-banner__session-fallback">
          子代理会话处于错误状态，但未记录任务级错误详情。打开完整会话查看最近一次输出与上下文。
        </p>
      )}

      <div className="sub-session-failure-banner__actions">
        <button
          className="sub-session-failure-banner__action sub-session-failure-banner__action--copy"
          data-copy-state={copyFeedback}
          onClick={() => void handleCopy()}
          type="button"
        >
          {copyLabel}
        </button>
        <button
          className="sub-session-failure-banner__action sub-session-failure-banner__action--open"
          onClick={() => onOpenFullSession(childSessionId)}
          type="button"
        >
          打开完整会话 →
        </button>
      </div>
    </section>
  );
}
