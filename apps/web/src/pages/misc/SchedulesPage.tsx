import { CronManager } from '@openAwork/shared-ui';
import type { CronJob, CronJobDeliveryMode } from '@openAwork/shared-ui';
import {
  createCronClient,
  type CronExecutionRecord,
  type CronJobRecord,
} from '@openAwork/web-client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import {
  emptyScheduleDraft,
  formatTimestamp,
  toCreateJobInput,
  type ScheduleFormDraft,
} from '../../components/schedules/schedule-form-utils.js';
import { useAuthStore } from '../../stores/auth/auth.js';

const sharedUiThemeVars = {
  '--color-surface': 'var(--bg-overlay)',
  '--color-border': 'var(--border-default)',
  '--color-text': 'var(--fg-strong)',
  '--color-muted': 'var(--fg-muted)',
  '--color-accent': 'var(--accent)',
  '--color-bg': 'var(--bg-base)',
  '--color-background': 'var(--bg-base)',
  '--color-foreground': 'var(--fg-strong)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--fg-on-accent)',
} as React.CSSProperties;

const KIND_OPTIONS = [
  { value: 'cron', label: 'cron 表达式' },
  { value: 'every', label: '固定间隔' },
  { value: 'at', label: '单次（到点执行）' },
] as const;

/**
 * 网关视图模型 → `shared-ui` 的 `CronJob`。
 *
 * 字段名与语义由网关侧 `cron/schedule-display.ts` 统一派生；这里只做窄化，
 * 不再用 `as unknown as` 掩盖缺失字段。
 */
function toCronManagerJob(job: CronJobRecord): CronJob {
  return {
    id: job.id,
    name: job.name,
    scheduleKind: job.scheduleKind,
    scheduleDisplay: job.scheduleDisplay,
    prompt: job.prompt,
    status: job.status,
    // 运行中只影响徽章与「立即运行」，不影响停用（见 CronJob.running 的说明）。
    running: job.running,
    deliveryMode: job.delivery_mode,
    ...(job.lastFiredAt !== null ? { lastFiredAt: job.lastFiredAt } : {}),
    ...(job.nextFireAt !== null ? { nextFireAt: job.nextFireAt } : {}),
    fireCount: job.fireCount,
  };
}

/**
 * 定时任务管理页。
 *
 * 此前该页把网关返回的原始记录直接 `as unknown as CronJob[]`：`scheduleKind`
 * 与 `schedule_kind` 不匹配、`scheduleDisplay` / `status` / `fireCount` 全部缺失，
 * 于是列表一片空白、`CronManager` 的「启用 / 禁用」按钮因 `status` 为 undefined
 * 而永不渲染；「添加任务」只打日志，「计划任务」区块又只是本地 state（刷新即丢），
 * 删除请求也没有 catch（失败时界面毫无反应）。
 *
 * 现在：网关已下发派生视图（见 `cron/schedule-display.ts`），这里只做
 * 「调用 —— 刷新 —— 反馈」三件事，每个动作都带显式成功 / 失败提示。
 */
export default function SchedulesPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [jobs, setJobs] = useState<CronJobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<ScheduleFormDraft>(() => emptyScheduleDraft());
  const [submitting, setSubmitting] = useState(false);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  /** 执行历史面板（含产出摘要与「查看执行现场」跳转）。 */
  const [historyView, setHistoryView] = useState<{
    jobId: string;
    jobName: string;
    entries: CronExecutionRecord[];
  } | null>(null);
  /** 按任务缓存最近一次执行结果，用于在列表里直接标出「上次失败」与原因。 */
  const [latestExecutions, setLatestExecutions] = useState<
    Record<string, CronExecutionRecord | undefined>
  >({});

  const navigate = useNavigate();
  const client = useMemo(() => createCronClient(gatewayUrl), [gatewayUrl]);

  const reload = useCallback(async (): Promise<void> => {
    if (!token) {
      setJobs([]);
      return;
    }
    setLoading(true);
    // React Compiler 的两条硬限制（`compiler-limit`，会让整个组件退出自动
    // memoization）：① 不能有带 finalizer 的 try/finally；② try 块内不能出现
    // 条件 / 逻辑运算等「值块」。故 try 内**只保留唯一一次取数**，其余逻辑
    // （判错、附加数据、收尾）全部挪到块外。
    let nextJobs: CronJobRecord[] = [];
    let failure: Error | null = null;
    try {
      nextJobs = await client.list(token);
    } catch (reason) {
      failure = reason instanceof Error ? reason : new Error('加载定时任务失败');
    }

    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }

    setJobs(nextJobs);
    setError(null);

    // 顺带取每个任务的最近一次执行：列表行要直接标出「上次失败」与原因，
    // 否则用户只能逐个点开历史才能发现任务早已空转失败（本次问题的核心症状）。
    //
    // 用 allSettled 而非 all：某条 history 失败（例如该任务恰被另一端删除 →
    // 404）**不能**让整个列表判定为加载失败——主数据已经拿到了，失败的只是
    // 「附带的失败提示」这一展示增强，静默降级为该项无标记即可。
    // `allSettled` 本身不抛错，因此它安全地留在 try 之外。
    const settled = await Promise.allSettled(
      // 只要最新一条、不要摘要：这里只用来在列表行标「上次失败」。
      // 请求摘要会为每条执行读一次执行会话的全部消息，10 个任务就是数十次全量
      // 会话读取（且渠道任务的执行会话是复用的，历史越长越慢）。
      nextJobs.map(
        async (job) =>
          [
            job.id,
            (await client.history(token, job.id, { limit: 1, includePreview: false }))[0],
          ] as const,
      ),
    );
    const entries: Array<readonly [string, CronExecutionRecord | undefined]> = [];
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value[1] !== undefined) {
        entries.push(item.value);
      }
    }
    setLatestExecutions(Object.fromEntries(entries));
    setLoading(false);
  }, [client, token]);

  useEffect(() => {
    // 明确接住 rejection：`reload` 主路径已用 try/catch 兜住，但 try 之外的
    // 代码（附加数据、收尾）若意外抛出，浮空 promise 会变成无人处理的 rejection。
    void reload().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '加载定时任务失败');
      setLoading(false);
    });
  }, [reload]);

  /** 统一的动作包装：失败一律给出可见提示，成功后重拉列表保证与服务端一致。 */
  const runAction = useCallback(
    async (label: string, action: () => Promise<void>, jobId?: string): Promise<void> => {
      if (!token) return;
      setBusyJobId(jobId ?? null);
      // 同上：避免 try/finally（React Compiler `compiler-limit`）。
      let failure: Error | null = null;
      try {
        await action();
        await reload();
        toast(`已${label}`, 'success');
      } catch (reason) {
        failure = reason instanceof Error ? reason : new Error(`${label}失败`);
      }
      if (failure) {
        setError(failure.message);
        toast(failure.message, 'error');
      }
      setBusyJobId(null);
    },
    [reload, token],
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!token) return;
    setSubmitting(true);
    // 同上：避免 try/finally（React Compiler `compiler-limit`）。
    // `toCreateJobInput` 的校验错误与网络错误同路径处理，用户看到同一条原因。
    let failure: Error | null = null;
    try {
      const input = toCreateJobInput(draft);
      await client.create(token, input);
      await reload();
      setShowForm(false);
      setDraft(emptyScheduleDraft());
      setError(null);
      toast('已创建定时任务', 'success');
    } catch (reason) {
      failure = reason instanceof Error ? reason : new Error('创建定时任务失败');
    }
    if (failure) {
      setError(failure.message);
      toast(failure.message, 'error');
    }
    setSubmitting(false);
  }, [client, draft, reload, token]);

  /**
   * 切换某条任务的投递方式。
   *
   * `session` 需要目标会话 id，而列表行没有足够空间放输入框——用一次 `prompt`
   * 询问（空则放弃本次修改）。这样 `delivery_mode: 'none'` 的存量任务终于能
   * 改成「通知我」，不必删掉重建。
   */
  const handleDeliveryChange = useCallback(
    async (jobId: string, mode: CronJobDeliveryMode): Promise<void> => {
      if (!token) return;
      let patch: Parameters<typeof client.update>[2] | null = { delivery_mode: mode };
      if (mode === 'session') {
        const target = window.prompt('把结果投递到哪个会话？请填会话 id（留空取消）', '');
        if (target === null || target.trim().length === 0) {
          patch = null;
        } else {
          patch = { delivery_mode: 'session', delivery_target: target.trim() };
        }
      }
      if (patch === null) return;

      setBusyJobId(jobId);
      let failure: Error | null = null;
      try {
        await client.update(token, jobId, patch);
      } catch (reason) {
        failure = reason instanceof Error ? reason : new Error('修改投递方式失败');
      }
      setBusyJobId(null);
      if (failure) {
        toast(failure.message, 'error');
        return;
      }
      toast(
        mode === 'none' ? '已改为不投递（产出仍可在执行历史查看）' : '投递方式已更新',
        'success',
      );
      void reload();
    },
    [client, reload, token],
  );

  const handleHistory = useCallback(
    async (jobId: string, jobName: string): Promise<void> => {
      setHistoryJobId(jobId);
      if (!token) return;
      // React Compiler 限制：try 块内不能出现条件等「值块」（若整个块被当作
      // 可内联的表达式会让整组件退出优化），也不能用 finally。
      // 故 try 内只保留唯一的取数调用，格式化与提示全部挪到外面。
      let entries: CronExecutionRecord[] = [];
      let failure: Error | null = null;
      try {
        entries = await client.history(token, jobId);
      } catch (reason) {
        failure = reason instanceof Error ? reason : new Error('读取执行历史失败');
      }
      if (failure) {
        toast(failure.message, 'error');
        setHistoryView(null);
      } else if (entries.length === 0) {
        toast('该任务暂无执行历史', 'info');
        setHistoryView({ jobId, jobName, entries: [] });
      } else {
        // 用面板而非 toast：用户需要读到**产出摘要**并跳到执行现场，
        // toast 8 秒就消失、也无法点击——「任务成功但内容取不到」正是这么来的。
        setHistoryView({ jobId, jobName, entries: entries.slice(0, HISTORY_PANEL_LIMIT) });
      }
      setHistoryJobId(null);
    },
    [client, token],
  );

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">定时任务</span>
        <span className="page-subtitle">管理自动化定时规则，任务由网关后台按时执行</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowForm((v) => !v)} className="btn-accent">
          {showForm ? '取消新建' : '添加任务'}
        </button>
      </div>
      <div className="page-content">
        <div
          style={{
            maxWidth: 'var(--content-max-width)',
            margin: '0 auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {error && (
            <div
              role="alert"
              style={{
                border: '1px solid var(--complement-border)',
                background: 'var(--complement-muted)',
                color: 'var(--complement)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {showForm && (
            <ScheduleForm
              draft={draft}
              submitting={submitting}
              onChange={setDraft}
              onSubmit={() => void handleCreate()}
            />
          )}

          <FailedRunsPanel jobs={jobs} latestExecutions={latestExecutions} />

          {historyView && (
            <HistoryPanel
              view={historyView}
              onClose={() => setHistoryView(null)}
              onOpenSession={(sessionId) => navigate(`/chat/${sessionId}`)}
            />
          )}

          <div>
            <span className="section-label">定时规则</span>
            <div className="content-card" style={sharedUiThemeVars}>
              {loading && jobs.length === 0 ? (
                <div
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    color: 'var(--fg-muted)',
                    fontSize: 12,
                  }}
                >
                  正在加载定时任务…
                </div>
              ) : jobs.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                    padding: '28px 16px',
                    color: 'var(--fg-muted)',
                    textAlign: 'center',
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ opacity: 0.5 }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                    暂无定时规则，点击上方「添加任务」创建第一个。
                  </span>
                </div>
              ) : (
                <CronManager
                  jobs={jobs.map(toCronManagerJob)}
                  onEnable={(id) =>
                    void runAction(
                      '启用定时任务',
                      async () => {
                        if (!token) return;
                        await client.setEnabled(token, id, true);
                      },
                      id,
                    )
                  }
                  onDisable={(id) =>
                    void runAction(
                      '停用定时任务',
                      async () => {
                        if (!token) return;
                        await client.setEnabled(token, id, false);
                      },
                      id,
                    )
                  }
                  onDelete={(id) =>
                    void runAction(
                      '删除定时任务',
                      async () => {
                        if (!token) return;
                        await client.remove(token, id);
                      },
                      id,
                    )
                  }
                  onRunNow={(id) =>
                    void runAction(
                      '触发定时任务',
                      async () => {
                        if (!token) return;
                        await client.runNow(token, id);
                      },
                      id,
                    )
                  }
                  onAdd={() => setShowForm(true)}
                />
              )}
              {busyJobId && (
                <div
                  style={{
                    borderTop: '1px solid var(--border-default)',
                    padding: '8px 14px',
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                  }}
                >
                  正在处理任务 {busyJobId}…
                </div>
              )}
            </div>
          </div>

          <div>
            <span className="section-label">执行历史</span>
            <div className="content-card" style={sharedUiThemeVars}>
              {jobs.length === 0 ? (
                <div style={{ padding: '18px 16px', color: 'var(--fg-muted)', fontSize: 12 }}>
                  创建任务后可在这里查看最近执行结果。
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 14px' }}>
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => void handleHistory(job.id, job.name)}
                      disabled={historyJobId === job.id}
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: 6,
                        background: 'var(--bg-raised)',
                        color: 'var(--fg-strong)',
                        padding: '0.35rem 0.7rem',
                        fontSize: 11,
                        cursor: historyJobId === job.id ? 'wait' : 'pointer',
                      }}
                    >
                      {job.name}
                      {job.last_fired_at
                        ? ` · 上次 ${formatTimestamp(job.last_fired_at)}`
                        : ' · 未执行'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 历史面板最多展示条数（网关只对最近若干条生成产出摘要）。 */
const HISTORY_PANEL_LIMIT = 5;

/**
 * 执行历史面板。
 *
 * 替代原先的 toast：toast 8 秒消失、无法点击，导致「任务显示 completed 但
 * 用户拿不到内容」。这里直接呈现每次执行的**产出摘要**，并提供「查看执行现场」
 * 跳到该次执行所用的会话（`delivery_mode: 'none'` 时这是唯一的内容出口）。
 */
function HistoryPanel({
  view,
  onClose,
  onOpenSession,
}: {
  view: { jobId: string; jobName: string; entries: CronExecutionRecord[] };
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="content-card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>「{view.jobName}」执行历史</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          关闭
        </button>
      </div>
      {view.entries.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>该任务暂无执行历史。</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {view.entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                paddingTop: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color:
                      entry.status === 'failed'
                        ? 'var(--complement)'
                        : entry.status === 'running'
                          ? 'var(--aux)'
                          : 'var(--success)',
                  }}
                >
                  {entry.status === 'completed'
                    ? '成功'
                    : entry.status === 'failed'
                      ? '失败'
                      : '运行中'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  {formatTimestamp(entry.started_at)}
                </span>
                {entry.session_id && (
                  <button
                    type="button"
                    onClick={() => onOpenSession(entry.session_id!)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                      borderRadius: 5,
                      color: 'var(--fg-muted)',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '0.1rem 0.4rem',
                    }}
                  >
                    查看执行现场
                  </button>
                )}
              </div>
              {entry.error && (
                <div style={{ fontSize: 11, color: 'var(--complement)', wordBreak: 'break-word' }}>
                  {entry.error}
                </div>
              )}
              {entry.outputPreview ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-strong)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 160,
                    overflow: 'auto',
                    lineHeight: 1.55,
                  }}
                >
                  {entry.outputPreview}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  {entry.status === 'completed'
                    ? '（这条较早的执行没有留下摘要，可点「查看执行现场」看完整内容）'
                    : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 「最近执行失败」提示面板。
 *
 * 本次问题的核心症状是「任务显示成功、实际什么都没做」——用户必须先想到去点
 * 「执行历史」才可能发现。这里把失败**主动推到列表页顶部**：只要有任务最近一次
 * 执行是 failed，就显示任务名 + 时间 + 原因（例如「会话当时正忙」）。
 */
function FailedRunsPanel({
  jobs,
  latestExecutions,
}: {
  jobs: CronJobRecord[];
  latestExecutions: Record<string, CronExecutionRecord | undefined>;
}) {
  const failures = jobs.flatMap((job) => {
    const entry = latestExecutions[job.id];
    return entry?.status === 'failed' ? [{ job, entry }] : [];
  });

  if (failures.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        border: '1px solid var(--complement-border)',
        background: 'var(--complement-muted)',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--complement)' }}>
        {failures.length} 个任务最近一次执行失败
      </span>
      {failures.map(({ job, entry }) => (
        <div key={job.id} style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--fg-strong)' }}>
          <span style={{ fontWeight: 600 }}>{job.name}</span>
          <span style={{ color: 'var(--fg-muted)' }}> · {formatTimestamp(entry.started_at)}</span>
          <div style={{ color: 'var(--fg-muted)', wordBreak: 'break-word' }}>
            {entry.error ?? '未记录失败原因'}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleForm({
  draft,
  submitting,
  onChange,
  onSubmit,
}: {
  draft: ScheduleFormDraft;
  submitting: boolean;
  onChange: (next: ScheduleFormDraft) => void;
  onSubmit: () => void;
}) {
  const patch = (partial: Partial<ScheduleFormDraft>) => onChange({ ...draft, ...partial });

  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 10,
        background: 'var(--bg-overlay)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <span className="section-label">新建定时任务</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="任务名称"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          style={inputStyle}
        />
        <select
          value={draft.kind}
          onChange={(event) => patch({ kind: event.target.value as ScheduleFormDraft['kind'] })}
          style={inputStyle}
          aria-label="调度类型"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {draft.kind === 'cron' && (
          <>
            <input
              type="text"
              placeholder="0 9 * * *"
              value={draft.cronExpr}
              onChange={(event) => patch({ cronExpr: event.target.value })}
              style={{ ...inputStyle, minWidth: 160, fontFamily: 'monospace' }}
              aria-label="cron 表达式"
            />
            <input
              type="text"
              placeholder="时区（如 Asia/Shanghai）"
              value={draft.tz}
              onChange={(event) => patch({ tz: event.target.value })}
              style={{ ...inputStyle, minWidth: 160 }}
              aria-label="时区"
            />
          </>
        )}

        {draft.kind === 'every' && (
          <>
            <input
              type="number"
              min={1}
              value={draft.everyValue}
              onChange={(event) => patch({ everyValue: event.target.value })}
              style={{ ...inputStyle, minWidth: 90 }}
              aria-label="间隔数值"
            />
            <select
              value={draft.everyUnit}
              onChange={(event) =>
                patch({ everyUnit: event.target.value as ScheduleFormDraft['everyUnit'] })
              }
              style={inputStyle}
              aria-label="间隔单位"
            >
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
              <option value="days">天</option>
            </select>
          </>
        )}

        {draft.kind === 'at' && (
          <input
            type="datetime-local"
            value={draft.atLocal}
            onChange={(event) => patch({ atLocal: event.target.value })}
            style={inputStyle}
            aria-label="触发时间"
          />
        )}
      </div>

      <textarea
        placeholder="任务提示词：到点后让 AI 做什么（例如「总结今天的未读邮件并发送到这里」）"
        value={draft.prompt}
        onChange={(event) => patch({ prompt: event.target.value })}
        rows={3}
        style={{ ...inputStyle, minWidth: '100%', resize: 'vertical', lineHeight: 1.5 }}
      />

      {/* 投递方式：任务跑完的结果送到哪里。不选「不投递」时产出会真正出现在
          用户能看到的地方（桌面通知 / 指定会话），避免「跑了但什么都没有」。 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={draft.deliveryMode}
          onChange={(event) =>
            patch({ deliveryMode: event.target.value as ScheduleFormDraft['deliveryMode'] })
          }
          style={inputStyle}
          aria-label="结果投递方式"
        >
          <option value="desktop">结果通知我（桌面 / 网页）</option>
          <option value="session">投递到指定会话</option>
          <option value="none">不投递（只看执行历史）</option>
        </select>
        {draft.deliveryMode === 'session' && (
          <input
            type="text"
            placeholder="目标会话 id"
            value={draft.deliveryTarget}
            onChange={(event) => patch({ deliveryTarget: event.target.value })}
            style={{ ...inputStyle, minWidth: 260 }}
            aria-label="目标会话 id"
          />
        )}
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {draft.deliveryMode === 'none'
            ? '任务会正常执行，但产出不会主动送达——只能在执行历史里查看。'
            : '失败时同样会通知，不会出现「静默失败」。'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-accent"
          disabled={submitting}
          onClick={onSubmit}
          style={{ cursor: submitting ? 'wait' : 'pointer' }}
        >
          {submitting ? '创建中…' : '创建任务'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          cron 使用 5 段表达式（分 时 日 月 周）；间隔最小 1 分钟。
        </span>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  padding: '0.45rem 0.6rem',
  fontSize: 12,
  minWidth: 140,
};
