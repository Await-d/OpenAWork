import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export type ScheduleKind = 'at' | 'every' | 'cron';

/**
 * 启停态。**刻意不含 `'running'`**：把「运行中」并进 status 会让下方的启停按钮
 * 一起被隐藏（`status === 'disabled'` / `'enabled'` 都不成立），长任务因此无法被
 * 停止。运行中信息由 `CronJob.running` 单独承载。
 */
export type CronJobStatus = 'enabled' | 'disabled';

/** 结果投递方式；与网关 `delivery_mode` 一一对应。 */
export type CronJobDeliveryMode = 'none' | 'session' | 'desktop';

export interface CronJob {
  id: string;
  name: string;
  scheduleKind: ScheduleKind;
  scheduleDisplay: string;
  prompt: string;
  /** 启停态，**不含「运行中」**（见 `CronJobStatus` 的说明）。 */
  status: CronJobStatus;
  /**
   * 结果投递方式。缺省视为 `'none'`（存量任务就是这种）。
   *
   * 之所以要在列表行就能改：`delivery_mode: 'none'` 的任务跑完后产出只落在执行
   * 会话里，用户收不到任何东西；若界面没有修改入口，只能删掉重建任务。
   */
  deliveryMode?: CronJobDeliveryMode;
  /**
   * 该任务当前是否有一次执行在途。与 `status` 分开：
   * 「运行中」只是提示，不得影响启用 / 停用按钮的可用性——任务跑飞了恰恰是最
   * 需要按停的时刻。
   */
  running?: boolean;
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
  /** 传入时每行渲染「投递方式」下拉；不传则完全不显示该控件（其它端不受影响）。 */
  onDeliveryChange?: (jobId: string, mode: CronJobDeliveryMode) => void;
  style?: CSSProperties;
}

const DELIVERY_OPTIONS: ReadonlyArray<{ value: CronJobDeliveryMode; label: string }> = [
  { value: 'desktop', label: '通知我' },
  { value: 'session', label: '投到会话' },
  { value: 'none', label: '不投递' },
];

const DELIVERY_LABEL: Readonly<Record<CronJobDeliveryMode, string>> = {
  desktop: '通知我',
  session: '投到会话',
  none: '不投递',
};

const KIND_COLOR: Record<ScheduleKind, string> = {
  at: 'var(--accent)',
  every: 'var(--aux)',
  cron: color.warning,
};

const KIND_LABEL: Record<ScheduleKind, string> = {
  at: '于',
  every: '每',
  cron: 'cron',
};

const STATUS_COLOR: Record<CronJobStatus, string> = {
  enabled: color.success,
  disabled: 'var(--fg-muted)',
};

const STATUS_LABEL: Record<CronJobStatus, string> = {
  enabled: '已启用',
  disabled: '已禁用',
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
  onDeliveryChange,
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
        background: 'var(--bg-overlay)',
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
            color: 'var(--fg-muted)',
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
              background: 'var(--accent)',
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
            color: 'var(--fg-muted)',
          }}
        >
          暂无定时任务配置
        </div>
      ) : (
        jobs.map((job, i) => {
          // 「运行中」独立于启停态：只影响徽章与「立即运行」按钮，绝不影响停用。
          const isRunning = job.running === true;
          return (
            <div
              key={job.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0.6rem 0.875rem',
                borderTop:
                  i > 0 ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
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
                      color: 'var(--fg-strong)',
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
                      color: 'var(--fg-muted)',
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
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    上次：{fmtTime(job.lastFiredAt)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    下次：{fmtTime(job.nextFireAt)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    运行次数：{job.fireCount}
                  </span>
                </div>
              </div>

              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: isRunning ? color.contrast : STATUS_COLOR[job.status],
                  flexShrink: 0,
                  padding: '0.15rem 0.45rem',
                  borderRadius: 4,
                  background: 'var(--bg-raised)',
                  border: `1px solid ${isRunning ? color.contrast : STATUS_COLOR[job.status]}40`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {isRunning && (
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
                {isRunning ? '运行中' : STATUS_LABEL[job.status]}
              </span>

              {onDeliveryChange && (
                <select
                  value={job.deliveryMode ?? 'none'}
                  aria-label="结果投递方式"
                  title={`结果投递方式：${DELIVERY_LABEL[job.deliveryMode ?? 'none']}`}
                  onChange={(event) =>
                    onDeliveryChange(job.id, event.target.value as CronJobDeliveryMode)
                  }
                  style={{
                    background: 'var(--bg-raised)',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 5,
                    color:
                      (job.deliveryMode ?? 'none') === 'none' ? 'var(--fg-muted)' : color.fgDefault,
                    cursor: 'pointer',
                    flexShrink: 0,
                    fontSize: 11,
                    padding: '0.2rem 0.35rem',
                  }}
                >
                  {DELIVERY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}

              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {job.status === 'disabled' && onEnable && (
                  <button
                    type="button"
                    onClick={() => onEnable(job.id)}
                    style={{
                      background: color.successMuted,
                      color: 'var(--success)',
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
                    onClick={() => !isRunning && onRunNow(job.id)}
                    disabled={isRunning}
                    title={isRunning ? '运行中' : 'Run now'}
                    style={{
                      background: isRunning ? 'var(--bg-raised)' : 'var(--accent)',
                      color: isRunning ? 'var(--fg-muted)' : color.fgOnAccent,
                      border: isRunning
                        ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                        : 'none',
                      borderRadius: 5,
                      padding: '0.25rem 0.6rem',
                      fontSize: 11,
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {isRunning ? (
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
                      color: 'var(--fg-muted)',
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
          );
        })
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
