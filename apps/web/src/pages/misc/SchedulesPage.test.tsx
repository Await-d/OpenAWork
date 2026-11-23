import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import SchedulesPage from './SchedulesPage.js';

/**
 * jsdom 无 `EventSource`：页面会建立任务专用 SSE（`GET /cron/events`）。
 * 本文件只验收渲染与交互，故用一个不做任何事的最小替身，避免因缺全局构造器
 * 让 effect 抛错（断连降级 / 去抖等行为由 `use-schedules-page.test.ts` 专门覆盖）。
 */
class NullEventSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(_url: string | URL) {}
  addEventListener(): void {}
  close(): void {}
}

beforeAll(() => {
  vi.stubGlobal('EventSource', NullEventSource);
});

const client = vi.hoisted(() => ({
  list: vi.fn(),
  history: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  remove: vi.fn(),
}));

/** 「投到会话」选择器的数据源（页面在弹层打开时才调用）。 */
const sessionsClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@openAwork/web-client', () => ({
  createCronClient: () => client,
  createSessionsClient: () => sessionsClient,
}));
vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: { accessToken: string; gatewayUrl: string }) => unknown) =>
    selector({ accessToken: 'token', gatewayUrl: 'http://localhost:3000' }),
}));
vi.mock('../../components/common/feedback/ToastNotification.js', () => ({ toast: vi.fn() }));

function job(): CronJobRecord {
  return {
    id: 'job-a',
    name: '每日同步',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '0 9 * * *',
    schedule_tz: 'Asia/Shanghai',
    prompt: '同步',
    enabled: true,
    delete_after_run: false,
    delivery_mode: 'desktop',
    delivery_target: null,
    last_fired_at: null,
    fire_count: 0,
    scheduleKind: 'cron',
    scheduleDisplay: '每天 9 点',
    status: 'enabled',
    running: false,
    fireCount: 0,
    lastFiredAt: null,
    nextFireAt: null,
    lastExecution: null,
  };
}

function entry(status: CronExecutionRecord['status']): CronExecutionRecord {
  return {
    id: `execution-${status}`,
    job_id: 'job-a',
    status,
    started_at: 1000,
    finished_at: 2000,
  };
}

function renderPage() {
  client.list.mockResolvedValue([job()]);
  render(
    <MemoryRouter>
      <SchedulesPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // 视角 / 密度偏好写在 sessionStorage 里，用例之间必须互不串味。
  window.sessionStorage.clear();
});

/** 页面上「结果投递方式」下拉的稳定查询名（页面另有排序下拉，不能用裸 combobox 判定）。 */
const DELIVERY_SELECT = { name: '结果投递方式' } as const;

describe('SchedulesPage', () => {
  it('保留渠道任务真实投递展示，禁用只更新启停而不回写投递方式', async () => {
    client.list.mockResolvedValue([{ ...job(), delivery_mode: 'channel' }]);
    client.setEnabled.mockResolvedValue(null);
    render(
      <MemoryRouter>
        <SchedulesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('渠道回发')).toBeTruthy();
    // 渠道任务的投递方式只能是纯文本：页面另外存在排序下拉，故按名称精确断言。
    expect(screen.queryByRole('combobox', DELIVERY_SELECT)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    expect(client.setEnabled).toHaveBeenCalledExactlyOnceWith('token', 'job-a', false);
    expect(client.update).not.toHaveBeenCalled();
  });

  it('非渠道任务可以就地改投递方式（此前页面从未接线）', async () => {
    client.update.mockResolvedValue(null);
    renderPage();
    const select = await screen.findByRole('combobox', DELIVERY_SELECT);
    fireEvent.change(select, { target: { value: 'none' } });
    expect(client.update).toHaveBeenCalledExactlyOnceWith('token', 'job-a', {
      delivery_mode: 'none',
    });
  });

  it('「投到会话」改为从会话列表里选，不再是 window.prompt 手填 id', async () => {
    client.update.mockResolvedValue(null);
    sessionsClient.list.mockResolvedValue([{ id: 'sess-1', title: '排期讨论' }]);
    renderPage();

    const select = await screen.findByRole('combobox', DELIVERY_SELECT);
    fireEvent.change(select, { target: { value: 'session' } });

    // 弹层出现，且此时**尚未**写网关（选完才算数）。
    expect(await screen.findByText('投递到哪个会话？')).toBeTruthy();
    expect(client.update).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /排期讨论/ }));

    await waitFor(() =>
      expect(client.update).toHaveBeenCalledExactlyOnceWith('token', 'job-a', {
        delivery_mode: 'session',
        delivery_target: 'sess-1',
      }),
    );
  });

  it('执行历史将 expired 明确显示为已过期，而不是绿色运行中', async () => {
    client.history.mockResolvedValue([entry('expired')]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '执行历史' }));
    const badge = await screen.findByText('已过期');
    // 语义色由 `data-tone` 契约承担（灰色系），不再依赖内联 style。
    expect(badge.getAttribute('data-tone')).toBe('muted');
    // 只看结果徽章：筛选条里另有一个同名的「运行中」按钮，不能把两者混为一谈。
    expect(screen.queryByText('运行中', { selector: '.sch-badge' })).toBeNull();
  });
});

describe('卡片密度（D-02）', () => {
  it('卡片视图可切「紧凑」：网格换档 + 偏好写入 sessionStorage', async () => {
    renderPage();

    expect(await screen.findByText('每日同步')).toBeTruthy();
    // 密度作为属性挂在网格上，CSS 才能按 data-density 换档（组件不写内联样式）。
    expect(document.querySelector('.sch-grid')?.getAttribute('data-density')).toBe('comfortable');
    expect(screen.getByRole('button', { name: '舒适' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '紧凑' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '紧凑' }));

    expect(document.querySelector('.sch-grid')?.getAttribute('data-density')).toBe('compact');
    expect(window.sessionStorage.getItem('openAwork.schedules.density')).toBe('compact');
  });

  it('密度控件只在卡片视图出现（时间轴下不留死控件）', async () => {
    renderPage();

    expect(await screen.findByRole('group', { name: '卡片密度' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '时间轴视图' }));

    expect(screen.queryByRole('group', { name: '卡片密度' })).toBeNull();
  });

  it('sessionStorage 不可用时退回默认视角与舒适密度，页面照常渲染', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      renderPage();

      expect(await screen.findByText('每日同步')).toBeTruthy();
      expect(document.querySelector('.sch-grid')?.getAttribute('data-density')).toBe('comfortable');
      expect(screen.getByRole('button', { name: '卡片视图' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
