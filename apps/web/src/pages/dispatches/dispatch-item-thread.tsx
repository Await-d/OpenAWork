import type { DispatchAttempt, DispatchItem, DispatchItemAction } from '@openAwork/shared';
import { useActionState, useState } from 'react';
import { roleLabels } from './dispatch-labels.js';
import { DispatchStatusBadge } from './dispatch-status-badge.js';
import { dispatchError } from './use-dispatches.js';

const kinds = { initial: '首次执行', 'follow-up': '追问', retry: '重试' };
const failures = {
  'model-unavailable': '执行模型不可用。请检查账户模型配置。',
  'generation-failed': '模型生成失败。',
  'gateway-stopped': '网关停止，执行已中断。',
};

function AttemptEntry({ attempt }: { attempt: DispatchAttempt }) {
  return (
    <li className="dispatch-attempt dispatch-stack">
      <div className="dispatch-attempt-head">
        <h4>
          第 {attempt.number} 次 · {kinds[attempt.kind]}
        </h4>
        <span className="dispatch-attempt-state">
          {attempt.stopRequested && attempt.status === 'running' ? (
            '正在停止'
          ) : (
            <DispatchStatusBadge status={attempt.status} />
          )}
        </span>
      </div>
      {attempt.question && (
        <p className="dispatch-text dispatch-quote">
          <strong>追问：</strong>
          {attempt.question}
        </p>
      )}
      {attempt.result && (
        <div className="dispatch-result">
          <span className="dispatch-result-label">结果</span>
          <p className="dispatch-text">{attempt.result}</p>
        </div>
      )}
      {attempt.error && (
        <p className="dispatch-error" role="alert">
          {failures[attempt.error]}
        </p>
      )}
    </li>
  );
}

export function DispatchItemThread({
  item,
  locked,
  busy,
  act,
}: {
  item: DispatchItem;
  locked: boolean;
  busy: boolean;
  act: (action: DispatchItemAction) => Promise<unknown>;
}) {
  const attempts = [...item.attempts].sort((a, b) => a.number - b.number);
  const latest = attempts[attempts.length - 1];
  const [question, setQuestion] = useState('');
  const [error, submit, pending] = useActionState(async (_previous: string, form: FormData) => {
    const kind = form.get('kind');
    if (!latest || busy || (locked && kind !== 'cancel')) return '';
    try {
      if (kind === 'follow-up') {
        if (!question.trim()) return '请输入追问内容。';
        await act({ kind, expectedAttemptId: latest.id, question: question.trim() });
        setQuestion('');
      } else if (kind === 'cancel' || kind === 'retry') {
        await act({ kind, expectedAttemptId: latest.id });
      }
      return '';
    } catch (cause) {
      return dispatchError(cause, '无法更新此事项，请核对最新状态后重试。');
    }
  }, '');
  const canCancel =
    latest && !latest.stopRequested && (latest.status === 'queued' || latest.status === 'running');
  const canRetry =
    !locked &&
    (latest?.status === 'failed' ||
      latest?.status === 'interrupted' ||
      latest?.status === 'cancelled');
  const canAsk = !locked && latest?.status === 'succeeded';

  return (
    <article className="dispatch-stack dispatch-inset dispatch-item">
      <div className="dispatch-item-head">
        <h3>{item.title}</h3>
        <span className="dispatch-role">{roleLabels[item.role]}</span>
      </div>
      <dl className="dispatch-facts">
        <div>
          <dt>目标</dt>
          <dd className="dispatch-text">{item.objective}</dd>
        </div>
        <div>
          <dt>验收条件</dt>
          <dd className="dispatch-text">{item.acceptance}</dd>
        </div>
      </dl>
      {item.hasEarlierAttempts && <p className="dispatch-hint">目前仅显示最近的执行记录。</p>}
      {attempts.length ? (
        <ol className="dispatch-history">
          {attempts.map((attempt) => (
            <AttemptEntry key={attempt.id} attempt={attempt} />
          ))}
        </ol>
      ) : (
        <p className="dispatch-hint">暂无执行记录。</p>
      )}
      {(canCancel || canRetry || canAsk) && (
        <form action={submit} className="dispatch-stack dispatch-item-actions">
          {canAsk && (
            <label>
              追问此事项
              <textarea
                required
                rows={2}
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={pending || busy}
              />
            </label>
          )}
          <div className="dispatch-actions">
            {canAsk && (
              <button
                className="dispatch-primary"
                name="kind"
                value="follow-up"
                disabled={pending || busy || question.trim().length === 0}
              >
                发送追问
              </button>
            )}
            {canRetry && (
              <button
                className="dispatch-primary"
                name="kind"
                value="retry"
                disabled={pending || busy}
              >
                重试此事项
              </button>
            )}
            {canCancel && (
              <button
                className="dispatch-danger"
                name="kind"
                value="cancel"
                disabled={pending || busy}
              >
                取消此事项
              </button>
            )}
          </div>
        </form>
      )}
      {pending && <p role="status">正在更新此事项…</p>}
      {error && (
        <p role="alert" className="dispatch-error">
          {error}
        </p>
      )}
    </article>
  );
}
