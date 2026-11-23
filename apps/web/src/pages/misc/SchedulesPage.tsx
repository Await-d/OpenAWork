import type { CronJobRecord } from '@openAwork/web-client';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SchedulesCardGrid } from './schedules/schedules-card-grid.js';
import { ScheduleForm } from './schedules/schedules-form.js';
import { SchedulesOverview } from './schedules/schedules-overview.js';
import { SchedulesSessionPicker } from './schedules/schedules-session-picker.js';
import { SchedulesTimeline } from './schedules/schedules-timeline.js';
import type {
  SchedulesDensity,
  SchedulesJobActions,
  SchedulesViewMode,
} from './schedules/schedules-view-types.js';
import { useSessionOptions } from './schedules/use-session-options.js';
import { useSchedulesClock } from './schedules/use-schedules-clock.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { HISTORY_PANEL_LIMIT, useSchedulesPage } from './use-schedules-page.js';
import './schedules/schedules-page.css';

/**
 * 定时任务管理页（装配层）。
 *
 * 布局：概览卡（KPI + 今日执行分布 + 失败告警）→ 工具条（搜索 / 状态筛选 / 排序）
 * → 卡片视图或时间轴视图。两个视图消费**同一份** `jobs` 与同一套动作，切换只换
 * 排布，不触发额外请求。
 *
 * 页面自身只做三件事：调 hook、把动作透传给视图、维护视图内的筛选与视角偏好；
 * 时间算术与分组在 `schedules/schedules-view-utils.ts`（纯函数 + 单测），
 * 渲染细节在 `schedules/*` 三个视图组件里。
 */

type SchedulesStatusFilter = 'all' | 'enabled' | 'running' | 'disabled' | 'failed';
type SchedulesSortKey = 'next' | 'name' | 'fires';

const STATUS_FILTERS: ReadonlyArray<{ value: SchedulesStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'running', label: '运行中' },
  { value: 'disabled', label: '已停用' },
  { value: 'failed', label: '最近失败' },
];

/** 视图偏好（sessionStorage）：只影响本标签页，跨标签页互不干扰。 */
const VIEW_MODE_STORAGE_KEY = 'openAwork.schedules.viewMode';
/** 卡片密度偏好（D-02）：与视图偏好同族，同样只影响本标签页。 */
const DENSITY_STORAGE_KEY = 'openAwork.schedules.density';

function readStoredViewMode(): SchedulesViewMode {
  try {
    return window.sessionStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'timeline'
      ? 'timeline'
      : 'cards';
  } catch {
    // 隐私模式 / 存储被禁用：退回默认视角即可，不影响页面功能。
    return 'cards';
  }
}

function storeViewMode(mode: SchedulesViewMode): void {
  try {
    window.sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // 存不住就不存：偏好不是关键路径。
  }
}

/** 只认白名单里的值：脏数据（手改 / 旧版本写入）一律回落默认档。 */
function readStoredDensity(): SchedulesDensity {
  try {
    return window.sessionStorage.getItem(DENSITY_STORAGE_KEY) === 'compact'
      ? 'compact'
      : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function storeDensity(density: SchedulesDensity): void {
  try {
    window.sessionStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // 同 storeViewMode：偏好存不住不影响功能。
  }
}

function matchesStatusFilter(job: CronJobRecord, filter: SchedulesStatusFilter): boolean {
  if (filter === 'enabled') return job.status === 'enabled';
  if (filter === 'running') return job.running === true;
  if (filter === 'disabled') return job.status === 'disabled';
  if (filter === 'failed') return job.lastExecution?.status === 'failed';
  return true;
}

function matchesKeyword(job: CronJobRecord, keyword: string): boolean {
  if (keyword.length === 0) return true;
  const haystack = `${job.name} ${job.prompt} ${job.schedule_expr ?? ''}`.toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

/** 未排期任务（停用 / 无 nextFireAt）永远排在最后，避免混进「最近要跑」的行列。 */
function selectVisibleJobs(
  jobs: CronJobRecord[],
  keyword: string,
  filter: SchedulesStatusFilter,
  sortKey: SchedulesSortKey,
): CronJobRecord[] {
  const list = jobs.filter(
    (job) => matchesStatusFilter(job, filter) && matchesKeyword(job, keyword),
  );
  if (sortKey === 'name') {
    return list.toSorted((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  }
  if (sortKey === 'fires') {
    return list.toSorted((left, right) => right.fireCount - left.fireCount);
  }
  return list.toSorted((left, right) => {
    const leftNext = left.nextFireAt ?? Number.POSITIVE_INFINITY;
    const rightNext = right.nextFireAt ?? Number.POSITIVE_INFINITY;
    return leftNext - rightNext;
  });
}

export default function SchedulesPage() {
  const navigate = useNavigate();
  const nowMs = useSchedulesClock();
  const {
    jobs,
    loading,
    busyJobId,
    error,
    showForm,
    draft,
    submitting,
    historyJobId,
    historyView,
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
    pendingSessionDelivery,
    handleHistory,
    closeHistory,
  } = useSchedulesPage();

  // 会话选择器的数据只在弹层打开时拉（`enabled`），页面本身不多一次请求。
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
  } = useSessionOptions({
    enabled: pendingSessionDelivery !== null,
    gatewayUrl,
    token,
  });

  const [viewMode, setViewMode] = useState<SchedulesViewMode>(readStoredViewMode);
  const [density, setDensity] = useState<SchedulesDensity>(readStoredDensity);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<SchedulesStatusFilter>('all');
  const [sortKey, setSortKey] = useState<SchedulesSortKey>('next');

  const visibleJobs = selectVisibleJobs(jobs, keyword.trim(), statusFilter, sortKey);
  const emptyText =
    jobs.length > 0 ? '没有符合筛选条件的任务。' : '暂无定时规则，点击上方「添加任务」创建第一个。';

  const actions: SchedulesJobActions = {
    busyJobId,
    onEnable: (jobId) => {
      void handleEnable(jobId);
    },
    onDisable: (jobId) => {
      void handleDisable(jobId);
    },
    onRunNow: (jobId) => {
      void handleRunNow(jobId);
    },
    onDelete: (jobId) => {
      void handleDelete(jobId);
    },
    onDeliveryChange: (jobId, mode) => {
      void handleDeliveryChange(jobId, mode);
    },
    onOpenHistory: (jobId, jobName) => {
      // 同一个任务再点一次即收起：历史是内联展开的，不需要再请求一次。
      if (historyView !== null && historyView.jobId === jobId) {
        closeHistory();
        return;
      }
      void handleHistory(jobId, jobName);
    },
  };

  const switchView = (mode: SchedulesViewMode) => {
    setViewMode(mode);
    storeViewMode(mode);
  };

  const switchDensity = (next: SchedulesDensity) => {
    setDensity(next);
    storeDensity(next);
  };

  return (
    <div className="page-root">
      {/* 用 <header> 而非 div：页头是一个 landmark，否则 axe 会把里面的视图切换器
          判成「内容不在 landmark 内」（region 规则）。样式仍走 .page-header 类。 */}
      <header className="page-header">
        <h1 className="page-title">定时任务</h1>
        <span className="page-subtitle sch-header-subtitle">
          概览 + 卡片 / 时间轴，同一份数据两种视角
        </span>
        <div style={{ flex: 1 }} />
        <div className="sch-switch" role="group" aria-label="视图切换">
          <button
            type="button"
            aria-pressed={viewMode === 'cards'}
            onClick={() => switchView('cards')}
          >
            卡片视图
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'timeline'}
            onClick={() => switchView('timeline')}
          >
            时间轴视图
          </button>
        </div>
        <button type="button" onClick={toggleForm} className="btn-accent">
          {showForm ? '取消新建' : '添加任务'}
        </button>
      </header>

      <div className="page-content">
        <div className="sch-page-body">
          {error && (
            <div role="alert" className="sch-error">
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

          {loading && jobs.length === 0 ? (
            <div className="sch-loading">正在加载定时任务…</div>
          ) : (
            <>
              <SchedulesOverview jobs={jobs} nowMs={nowMs} actions={actions} />

              <div className="sch-toolbar">
                <input
                  type="search"
                  placeholder="搜索任务名 / 提示词 / 表达式…"
                  aria-label="搜索定时任务"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className="sch-chip"
                    aria-pressed={statusFilter === filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
                <span className="sch-toolbar-spacer" />
                <span className="sch-busy">
                  显示 {visibleJobs.length} / {jobs.length} 条
                </span>
                {viewMode === 'cards' && (
                  <>
                    <select
                      aria-label="排序方式"
                      value={sortKey}
                      onChange={(event) => setSortKey(event.target.value as SchedulesSortKey)}
                    >
                      <option value="next">按下次执行时间</option>
                      <option value="name">按名称</option>
                      <option value="fires">按运行次数</option>
                    </select>
                    {/* 密度只作用于卡片网格（D-02），所以只在卡片视图渲染：
                        否则时间轴下会出现一个点了没有任何反应的控件。 */}
                    <div className="sch-switch" role="group" aria-label="卡片密度">
                      <button
                        type="button"
                        aria-pressed={density === 'comfortable'}
                        onClick={() => switchDensity('comfortable')}
                      >
                        舒适
                      </button>
                      <button
                        type="button"
                        aria-pressed={density === 'compact'}
                        onClick={() => switchDensity('compact')}
                      >
                        紧凑
                      </button>
                    </div>
                  </>
                )}
                {busyJobId !== null && <span className="sch-busy">正在处理任务 {busyJobId}…</span>}
              </div>

              {viewMode === 'cards' ? (
                <SchedulesCardGrid
                  jobs={visibleJobs}
                  nowMs={nowMs}
                  actions={actions}
                  historyView={historyView}
                  historyJobId={historyJobId}
                  onOpenSession={(sessionId) => navigate(`/chat/${sessionId}`)}
                  emptyText={emptyText}
                  historyLimit={HISTORY_PANEL_LIMIT}
                  density={density}
                />
              ) : (
                <SchedulesTimeline
                  jobs={visibleJobs}
                  nowMs={nowMs}
                  actions={actions}
                  historyView={historyView}
                  historyJobId={historyJobId}
                  onOpenSession={(sessionId) => navigate(`/chat/${sessionId}`)}
                  emptyText={emptyText}
                  historyLimit={HISTORY_PANEL_LIMIT}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* 选择会话弹层（`AppDialog` 走 portal，挂在这里只为就近可读）。
          「投到会话」不再用 window.prompt 手填 id。 */}
      {pendingSessionDelivery !== null && (
        <SchedulesSessionPicker
          jobName={pendingSessionDelivery.jobName}
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          busy={busyJobId !== null}
          onSelect={(sessionId) => void confirmSessionDelivery(sessionId)}
          onDismiss={cancelSessionDelivery}
        />
      )}
    </div>
  );
}
