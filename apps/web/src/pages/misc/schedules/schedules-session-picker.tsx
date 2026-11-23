import { useState } from 'react';
import {
  AppDialog,
  DialogActionButton,
  DialogError,
  DialogIconBadge,
} from '../../../components/common/modal/AppDialog.js';
import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';
import type { SessionOption } from './use-session-options.js';
import './schedules-session-picker.css';

/**
 * 「投递到会话」的会话选择弹层。
 *
 * 取代 `window.prompt` 手填会话 id：填错要等下次执行才以「目标会话不存在」失败，
 * 用户根本发现不了。这里从真实会话列表里选，选中即提交。
 *
 * 由调用方通过**挂载/卸载**控制开关（`{pending && <SchedulesSessionPicker …/>}`），
 * 因此每次打开都是新实例、搜索词自动重置。
 */
export function SchedulesSessionPicker({
  jobName,
  sessions,
  loading,
  error,
  busy,
  onSelect,
  onDismiss,
}: {
  jobName: string;
  sessions: SessionOption[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  onSelect: (sessionId: string) => void;
  onDismiss: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const needle = keyword.trim().toLowerCase();
  const filtered =
    needle.length === 0
      ? sessions
      : sessions.filter(
          (session) =>
            session.title.toLowerCase().includes(needle) ||
            session.id.toLowerCase().includes(needle),
        );

  return (
    <AppDialog
      badge={
        <DialogIconBadge>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 21l1.9-4.7a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
          </svg>
        </DialogIconBadge>
      }
      title="投递到哪个会话？"
      description={`「${jobName}」执行完成后，产出会写进你选的会话。`}
      onDismiss={onDismiss}
      footerRight={
        <DialogActionButton variant="secondary" label="取消" disabled={busy} onClick={onDismiss} />
      }
    >
      <input
        type="search"
        className="sch-picker-search"
        placeholder="搜索会话标题或 id…"
        aria-label="搜索会话"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />

      {loading ? <div className="sch-picker-state">正在读取会话…</div> : null}
      {error !== null ? <DialogError message={error} /> : null}

      {!loading && error === null ? (
        filtered.length === 0 ? (
          <div className="sch-picker-state">
            {sessions.length === 0 ? '还没有任何会话，先新建一个再回来。' : '没有匹配的会话。'}
          </div>
        ) : (
          <ul className="sch-picker-list" aria-label="会话列表">
            {filtered.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="sch-picker-item"
                  disabled={busy}
                  onClick={() => onSelect(session.id)}
                >
                  <span className="sch-picker-title">{session.title}</span>
                  <span className="sch-picker-meta">
                    {session.id}
                    {session.updatedAt === null ? '' : ` · ${formatTimestamp(session.updatedAt)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </AppDialog>
  );
}
