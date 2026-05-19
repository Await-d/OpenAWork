import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export type ScheduleKind = 'at' | 'every' | 'cron';

export type CronJobStatus = 'enabled' | 'disabled' | 'running';

export interface CronJob {
  id: string;
  name: string;
  scheduleKind: ScheduleKind;
  scheduleDisplay: string;
  prompt: string;
  status: CronJobStatus;
  lastFiredAt?: number;
  nextFireAt?: number;
  fireCount: number;
}

export interface CronManagerProps {
  jobs: CronJob[];
  onEnable?: (jobId: string) => void;
  onDisable?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
  onRunNow?: (jobId: string) => void;
  onAdd?: () => void;
  style?: CSSProperties;
}

const KIND_COLOR: Record<ScheduleKind, string> = {
  at: 'var(--accent))',
  every: 'var(--aux))',
  cron: color.warning,
};

const KIND_LABEL: Record<ScheduleKind, string> = {
  at: '于',
  every: '每',
  cron: 'cron',
};

const STATUS_COLOR: Record<CronJobStatus, string> = {
  enabled: color.success,
  disabled: 'var(--fg-muted))',
  running: color.contrast,
};

const STATUS_LABEL: Record<CronJobStatus, string> = {
  enabled: '已启用',
  disabled: '已禁用',
  running: '运行中',
};

function fmtTime(ms?: number): string {
  if (ms === undefined || ms === null) return '—';
  return new Date(ms).toLocaleString();
}

export function CronManager({
  jobs,
  onEnable,
  onDisable,
  onDelete,
  onRunNow,
  onAdd,
  style,
}: CronManagerProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--bg-overlay))',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.875rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          background: 'var(--bg-raised)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-muted))',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          定时任务（{jobs.length}）
        </span>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            style={{
              background: 'var(--accent))',
              color: color.fgOnAccent,
              border: 'none',
              borderRadius: 5,
              padding: '0.25rem 0.6rem',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + 新建任务
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div
          style={{
            padding: '1.25rem',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--fg-muted))',
          }}
        >
          暂无定时任务配置
        </div>
      ) : (
        jobs.map((job, i) => (
          <div
            key={job.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0.6rem 0.875rem',
              borderTop: i > 0 ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--fg-strong))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 180,
                  }}
                >
                  {job.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: KIND_COLOR[job.scheduleKind],
                    padding: '0.1rem 0.4rem',
                    borderRadius: 4,
                    background: 'var(--bg-raised)',
                    border: `1px solid ${KIND_COLOR[job.scheduleKind]}40`,
                    flexShrink: 0,
                  }}
                >
                  {KIND_LABEL[job.scheduleKind]}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted))',
                    fontFamily: 'monospace',
                    flexShrink: 0,
                  }}
                >
                  {job.scheduleDisplay}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 2,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--fg-muted))' }}>
                  上次：{fmtTime(job.lastFiredAt)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted))' }}>
                  下次：{fmtTime(job.nextFireAt)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted))' }}>
                  运行次数：{job.fireCount}
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: STATUS_COLOR[job.status],
                flexShrink: 0,
                padding: '0.15rem 0.45rem',
                borderRadius: 4,
                background: 'var(--bg-raised)',
                border: `1px solid ${STATUS_COLOR[job.status]}40`,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {job.status === 'running' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: color.contrast,
                    animation: 'cron-pulse 1s ease-in-out infinite',
                  }}
                />
              )}
              {STATUS_LABEL[job.status]}
            </span>

            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {job.status === 'disabled' && onEnable && (
                <button
                  type="button"
                  onClick={() => onEnable(job.id)}
                  style={{
                    background: color.successMuted,
                    color: 'var(--success))',
                    border: 'none',
                    borderRadius: 5,
                    padding: '0.25rem 0.6rem',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  启用
                </button>
              )}
              {job.status === 'enabled' && onDisable && (
                <button
                  type="button"
                  onClick={() => onDisable(job.id)}
                  style={{
                    background: color.dangerMuted,
                    color: color.complementHover,
                    border: 'none',
                    borderRadius: 5,
                    padding: '0.25rem 0.6rem',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  禁用
                </button>
              )}
              {onRunNow && (
                <button
                  type="button"
                  onClick={() => job.status !== 'running' && onRunNow(job.id)}
                  disabled={job.status === 'running'}
                  title={job.status === 'running' ? '运行中' : 'Run now'}
                  style={{
                    background:
                      job.status === 'running'
                        ? 'var(--bg-raised)'
                        : 'var(--accent))',
                    color: job.status === 'running' ? 'var(--fg-muted))' : color.fgOnAccent,
                    border:
                      job.status === 'running' ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
                    borderRadius: 5,
                    padding: '0.25rem 0.6rem',
                    fontSize: 11,
                    cursor: job.status === 'running' ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {job.status === 'running' ? (
                    <>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: color.contrast,
                        }}
                      />
                      运行中
                    </>
                  ) : (
                    '立即运行'
                  )}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(job.id)}
                  title="删除任务"
                  style={{
                    background: 'transparent',
                    color: 'var(--fg-muted))',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 5,
                    padding: '0.25rem 0.5rem',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))
      )}

      <style>{`
        @keyframes cron-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
