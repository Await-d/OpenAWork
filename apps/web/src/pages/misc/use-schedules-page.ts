import {
  createCronClient,
  type CronClient,
  type CronExecutionRecord,
  type CronJobRecord,
} from '@openAwork/web-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageActivation } from '../../components/common/routing/CachedRouteOutlet.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import {
  emptyScheduleDraft,
  toCreateJobInput,
  type ScheduleDeliveryMode,
  type ScheduleFormDraft,
} from '../../components/schedules/schedule-form-utils.js';
import { useAuthStore } from '../../stores/auth/auth.js';

/** 历史面板最多展示条数（网关只对最近若干条生成产出摘要）。 */
export const HISTORY_PANEL_LIMIT = 5;

/**
 * 后台轮询间隔 —— **只在 SSE 不可用时**生效（降级路径）。
 *
 * 列表里展示的「运行中 / 下次触发 / 上次失败」都会在服务端变化，页面停着不刷新
 * 会让用户误以为任务没跑（尤其 `every` 任务）。首选通道是任务专用 SSE
 * （`GET /cron/events`，见 `docs/api/scheduled-tasks-contract.md`），事件到达即静默
 * 重拉列表；轮询只在 SSE 断连（`onerror`）期间顶上，连接恢复即刻停止。
 */
export const SCHEDULES_POLL_INTERVAL_MS = 15_000;

/** SSE 事件名（网关 `routes/cron-events.ts` 固定下发这一个事件）。 */
export const SCHEDULES_SSE_EVENT_NAME = 'cron.jobs.changed';

/**
 * 事件去抖窗口：一次用户操作可能触发多条事件（例如「创建」在网关侧同时发
 * `created`，随后手动运行又发 `run_started` / `run_finished`），逐条重拉会把
 * `GET /cron/jobs` 连打好几次。合并到一次静默刷新即可——载荷只表达「有变化」，
 * 不携带需要逐条应用的增量。
 */
export const SCHEDULES_EVENT_DEBOUNCE_MS = 300;

/** 构造 SSE 地址：EventSource 无法设请求头，token 只能走查询串（仓库既有约定）。 */
function buildCronEventsUrl(gatewayUrl: string, token: string): string {
  return `${gatewayUrl}/cron/events?token=${encodeURIComponent(token)}`;
}

/** 关闭旧的请求代号：轮询与动作后的刷新可能并发，晚到的旧响应必须被丢弃。 */
interface ReloadSeqRef {
  current: number;
}

/**
 * 拉取一次任务列表，并把「请求代号是否已过期 / 失败 / 附加数据」全部算出。
 *
 * 刻意做成**模块级普通函数**（非组件 / 非 hook）：原先这段 `try/catch` 直接写在
 * 组件里，会触发 React Compiler 的 `compiler-limit`（try 内条件块 / finally）
 * 而让整个组件退出自动 memoization。整段下沉后调用方恢复接管，错误处理逐字不变。
 */
async function runReload(input: {
  client: CronClient;
  token: string;
  seq: number;
  seqRef: ReloadSeqRef;
}): Promise<{
  stale: boolean;
  failure: Error | null;
  jobs: CronJobRecord[];
}> {
  let jobs: CronJobRecord[] = [];
  let failure: Error | null = null;
  try {
    jobs = await input.client.list(input.token);
  } catch (reason) {
    failure = reason instanceof Error ? reason : new Error('加载定时任务失败');
  }

  // 已有更新的请求发出 → 本次响应过期，直接丢弃（不覆盖列表、不动提示）。
  if (input.seq !== input.seqRef.current) {
    return { stale: true, failure: null, jobs: [] };
  }

  // 列表响应已带上每个任务的最近一次执行（`job.lastExecution`，网关一次批量查），
  // 不再逐任务拉 `/history?limit=1`（那是 N+1：任务数 × HTTP + SQL）。
  // 视图直接从 job 上读，这里不再额外派一份 map（原 `latestExecutions` 已随重构下线）。
  return { stale: false, failure, jobs };
}

/** 统一的动作包装：失败一律给出可见提示，成功后重拉列表保证与服务端一致。 */
async function runActionOnce(input: {
  token: string | null;
  jobId: string | undefined;
  label: string;
  action: () => Promise<void>;
  reload: (silent?: boolean) => Promise<void>;
  setBusyJobId: (jobId: string | null) => void;
  setError: (message: string | null) => void;
}): Promise<void> {
  if (!input.token) return;
  input.setBusyJobId(input.jobId ?? null);
  let failure: Error | null = null;
  try {
    await input.action();
    await input.reload();
    toast(`已${input.label}`, 'success');
  } catch (reason) {
    failure = reason instanceof Error ? reason : new Error(`${input.label}失败`);
  }
  if (failure) {
    input.setError(failure.message);
    toast(failure.message, 'error');
  }
  input.setBusyJobId(null);
}

export interface SchedulesPageState {
  jobs: CronJobRecord[];
  loading: boolean;
  busyJobId: string | null;
  error: string | null;
  showForm: boolean;
  draft: ScheduleFormDraft;
  submitting: boolean;
  historyJobId: string | null;
  historyView: { jobId: string; jobName: string; entries: CronExecutionRecord[] } | null;
  /**
   * 「投递到会话」正在等待用户挑目标会话。
   *
   * 之前这一步用 `window.prompt` 让用户手填会话 id：既无法校验（填错要到下次执行
   * 才以「目标会话不存在」失败），也无法撤销。现在改为挂起重试：用户选中会话后由
   * `confirmSessionDelivery` 真正落库，取消则原样不动。
   */
  pendingSessionDelivery: { jobId: string; jobName: string } | null;
}

export interface SchedulesPageActions {
  setDraft: (next: ScheduleFormDraft) => void;
  toggleForm: () => void;
  handleCreate: () => Promise<void>;
  handleEnable: (jobId: string) => Promise<void>;
  handleDisable: (jobId: string) => Promise<void>;
  handleDelete: (jobId: string) => Promise<void>;
  handleRunNow: (jobId: string) => Promise<void>;
  /** `mode === 'session'` 时**不落库**，只挂起等待选择器（见 `pendingSessionDelivery`）。 */
  handleDeliveryChange: (jobId: string, mode: ScheduleDeliveryMode) => Promise<void>;
  /** 选择器确认：把挂起的任务改成投递到该会话。 */
  confirmSessionDelivery: (sessionId: string) => Promise<void>;
  /** 选择器取消：清掉挂起状态，不做任何写入。 */
  cancelSessionDelivery: () => void;
  handleHistory: (jobId: string, jobName: string) => Promise<void>;
  closeHistory: () => void;
}

/**
 * `/schedules` 页的全部数据与动作逻辑。
 *
 * 页面只做渲染与事件派发，这样刷新 / 轮询 / 覆盖防护 / 错误与空态都能被单测
 * 直接覆盖，不需要渲染真实组件。**不引入新的全局状态或第二套数据源**：数据仍
 * 只来自网关 `CronClient`，这里只是把原先写在页面里的编排逻辑搬进 hook。
 */
export function useSchedulesPage(): SchedulesPageState & SchedulesPageActions {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  /** 页面是否处于前台（`CachedRouteOutlet` 缓存里未激活的页面仍然挂着）。 */
  const pageActive = usePageActivation();
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
  /** 「投递到会话」的挂起目标：非空时页面渲染会话选择器。 */
  const [pendingSessionDelivery, setPendingSessionDelivery] = useState<{
    jobId: string;
    jobName: string;
  } | null>(null);

  const client = useMemo(() => createCronClient(gatewayUrl), [gatewayUrl]);
  /** 请求代号：轮询与动作后的 reload 可能并发，慢的那个若后到会把新列表覆盖成旧快照。 */
  const reloadSeq = useRef(0);

  const reload = useCallback(
    /**
     * @param silent 后台轮询时传 true：失败不弹横幅（避免网络抖动刷错误），
     *               也不显示首屏 loading。
     */
    async (silent = false): Promise<void> => {
      const seq = (reloadSeq.current += 1);
      if (!token) {
        // 未登录：清空列表并**复位 loading**。此处是「最新一次请求」的终点（旧的在飞请求
        // 随后会因 seq 过期而直接 return、不再收尾），若不复位，前一次非静默加载设下的
        // `loading=true` 会永久停留——页面定格在「正在加载定时任务…」。
        setJobs([]);
        if (!silent) setLoading(false);
        return;
      }
      if (!silent) setLoading(true);

      const result = await runReload({ client, token, seq, seqRef: reloadSeq });
      if (result.stale) return;

      if (result.failure) {
        if (!silent) setError(result.failure.message);
        setLoading(false);
        return;
      }

      setJobs(result.jobs);
      // 后台轮询成功不能顺手清掉用户刚看到的错误提示（例如创建校验失败）——
      // 那条错误还没被处理，15 秒后自己消失会让人以为已经恢复。
      if (!silent) setError(null);
      setLoading(false);
    },
    [client, token],
  );

  useEffect(() => {
    // 明确接住 rejection：`reload` 主路径已用 try/catch 兜住，但 try 之外的
    // 代码（附加数据、收尾）若意外抛出，浮空 promise 会变成无人处理的 rejection。
    // 页面处于缓存（未激活）时不拉首屏：激活那一刻由下方订阅 effect 立即补一次。
    if (!pageActive) return;
    void reload().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '加载定时任务失败');
      setLoading(false);
    });
  }, [pageActive, reload]);

  /**
   * 后台同步：**页面激活 与 文档可见**两者都成立时才建立订阅；任一从「不满足」变回
   * 「满足」时立即补一次，避免看到过期数据。
   *
   * `CachedRouteOutlet` 是 keep-alive 式路由缓存，切走后**不卸载**本页面，所以单看
   * `document.visibilityState` 会让被缓存的页面白拉全量列表并持续 setState。
   * 页面激活态由 `usePageActivation()` 下发（同 `TeamPageV2` 对缓存页的判定方式）。
   *
   * 数据通道分两级：
   * 1. 首选任务专用 SSE（`GET /cron/events`）：收到 `cron.jobs.changed` 后去抖
   *    （`SCHEDULES_EVENT_DEBOUNCE_MS`）再静默 `reload(true)`。事件载荷只有
   *    `{ reason, jobId }`，**刻意不携带状态**，客户端一律重拉 REST，避免
   *    「推送的旧快照覆盖刚拉的新数据」这类竞态。
   * 2. 降级轮询：`EventSource.onerror`（含 `readyState !== OPEN`）说明连接断了
   *    ——浏览器会按服务端下发的 `retry: 1000` 自动重连，但在重连成功前界面必须
   *    继续前进，否则代理静默掐断 SSE（`onerror` 只会触发一次，随后静默重连失败）
   *    时页面会**永久停滞且用户无感**。因此这里回退到 15 秒轮询，`onopen`（连接
   *    恢复）时立刻停掉轮询。这是「实时性优先、断连时宁可变慢也不能停止」的取舍。
   */
  useEffect(() => {
    // 页面处于缓存（未激活）时既不建连也不挂定时器：彻底停掉无效请求。
    if (!pageActive) return;
    // 重新激活 / 切回标签页后立即补一次（首屏加载由上一个 effect 负责，这里静默）。
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return;
      void reload(true).catch(() => undefined);
    };

    let pollTimer: number | null = null;
    /** 去抖定时器：同一批事件合并成一次静默刷新。 */
    let debounceTimer: number | null = null;
    let source: EventSource | null = null;

    const stopPolling = (): void => {
      if (pollTimer === null) return;
      window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = (): void => {
      if (pollTimer !== null) return;
      pollTimer = window.setInterval(refresh, SCHEDULES_POLL_INTERVAL_MS);
    };
    const flushPendingRefresh = (): void => {
      if (debounceTimer === null) return;
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
      refresh();
    };

    // 未登录 / 无网关地址：没有可订阅的流，退回纯轮询（与旧行为一致）。
    if (token && gatewayUrl) {
      source = new EventSource(buildCronEventsUrl(gatewayUrl, token));
      source.addEventListener(SCHEDULES_SSE_EVENT_NAME, () => {
        // 事件只说明「有变化」：丢弃载荷，去抖后静默重拉。
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          debounceTimer = null;
          refresh();
        }, SCHEDULES_EVENT_DEBOUNCE_MS);
      });
      source.onopen = () => {
        // 连接恢复：停掉降级轮询，并补一次断连期间可能漏掉的变更。
        stopPolling();
        flushPendingRefresh();
      };
      source.onerror = () => {
        startPolling();
      };
    } else {
      startPolling();
    }

    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      stopPolling();
      // **不**在此处 flush 待处理的去抖刷新：cleanup 会在 `pageActive` 变 false（页面
      // 被路由缓存切走后失活）时执行，而 `refresh()` 只判 `document.visibilityState`
      // ——标签仍可见，会真发一次请求，直接击穿 R-05 的「未激活不发请求」门控。
      // 去抖窗口内待处理的事件在卸载时丢弃即可：唯一会因此漏掉事件的场景是
      // 「token / gatewayUrl 变化导致 effect 重跑」，而那时 `reload` 身份也变了 →
      // 上方首屏加载 effect 会重跑并补一次加载，语义已覆盖；连接恢复时的补拉由
      // `onopen` 的 `flushPendingRefresh()` 负责，与激活门控无关。
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [gatewayUrl, pageActive, reload, token]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>, jobId?: string): Promise<void> => {
      await runActionOnce({
        token,
        jobId,
        label,
        action,
        reload,
        setBusyJobId,
        setError,
      });
    },
    [reload, token],
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!token) return;
    setSubmitting(true);
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
   * 把一条投递方式补丁真正写回网关（成功提示由调用方决定）。
   *
   * 抽出来是因为「选完会话」与「切换到通知我 / 不投递」走的是同一条写入路径，
   * 之前 `prompt` 分支把这两件事揉在一个函数里，导致选择器的接入无处落脚。
   */
  const applyDeliveryPatch = useCallback(
    async (
      jobId: string,
      patch: Parameters<CronClient['update']>[2],
      successText: string,
    ): Promise<void> => {
      if (!token) return;
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
      toast(successText, 'success');
      void reload();
    },
    [client, reload, token],
  );

  /**
   * 切换某条任务的投递方式。
   *
   * `session` 需要目标会话 id：这里只把任务挂起，由会话选择器（`SchedulesSessionPicker`）
   * 选中后走 `confirmSessionDelivery` 落库——不再用 `window.prompt` 手填 id，
   * 因为填错的会话要到下次执行才以「目标会话不存在」失败，用户无从发现。
   */
  const handleDeliveryChange = useCallback(
    async (jobId: string, mode: ScheduleDeliveryMode): Promise<void> => {
      if (!token) return;
      if (mode === 'session') {
        const job = jobs.find((item) => item.id === jobId);
        setPendingSessionDelivery({ jobId, jobName: job?.name ?? jobId });
        return;
      }
      await applyDeliveryPatch(
        jobId,
        { delivery_mode: mode },
        mode === 'none' ? '已改为不投递（产出仍可在执行历史查看）' : '投递方式已更新',
      );
    },
    [applyDeliveryPatch, jobs, token],
  );

  const confirmSessionDelivery = useCallback(
    async (sessionId: string): Promise<void> => {
      const pending = pendingSessionDelivery;
      if (pending === null) return;
      setPendingSessionDelivery(null);
      await applyDeliveryPatch(
        pending.jobId,
        { delivery_mode: 'session', delivery_target: sessionId },
        '投递方式已更新',
      );
    },
    [applyDeliveryPatch, pendingSessionDelivery],
  );

  const cancelSessionDelivery = useCallback(() => setPendingSessionDelivery(null), []);

  const handleHistory = useCallback(
    async (jobId: string, jobName: string): Promise<void> => {
      setHistoryJobId(jobId);
      if (!token) return;
      // 面板只展示最近 5 条：默认 limit=100 会白拉 95 条，还会触发服务端逐条读
      // 执行会话生成摘要（最多 5 条，但请求体与查询仍是 100 条）。
      let entries: CronExecutionRecord[] = [];
      let failure: Error | null = null;
      try {
        entries = await client.history(token, jobId, { limit: HISTORY_PANEL_LIMIT });
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
        setHistoryView({ jobId, jobName, entries });
      }
      setHistoryJobId(null);
    },
    [client, token],
  );

  const toggleForm = useCallback(() => setShowForm((value) => !value), []);
  const closeHistory = useCallback(() => setHistoryView(null), []);

  const handleEnable = useCallback(
    (jobId: string): Promise<void> =>
      runAction(
        '启用定时任务',
        async () => {
          if (!token) return;
          await client.setEnabled(token, jobId, true);
        },
        jobId,
      ),
    [client, runAction, token],
  );

  const handleDisable = useCallback(
    (jobId: string): Promise<void> =>
      runAction(
        '停用定时任务',
        async () => {
          if (!token) return;
          await client.setEnabled(token, jobId, false);
        },
        jobId,
      ),
    [client, runAction, token],
  );

  const handleDelete = useCallback(
    (jobId: string): Promise<void> =>
      runAction(
        '删除定时任务',
        async () => {
          if (!token) return;
          await client.remove(token, jobId);
        },
        jobId,
      ),
    [client, runAction, token],
  );

  const handleRunNow = useCallback(
    (jobId: string): Promise<void> =>
      runAction(
        '触发定时任务',
        async () => {
          if (!token) return;
          await client.runNow(token, jobId);
        },
        jobId,
      ),
    [client, runAction, token],
  );

  return {
    jobs,
    loading,
    busyJobId,
    error,
    showForm,
    draft,
    submitting,
    historyJobId,
    historyView,
    pendingSessionDelivery,
    setDraft,
    toggleForm,
    handleCreate,
    handleEnable,
    handleDisable,
    handleDelete,
    handleRunNow,
    handleDeliveryChange,
    confirmSessionDelivery,
    cancelSessionDelivery,
    handleHistory,
    closeHistory,
  };
}
