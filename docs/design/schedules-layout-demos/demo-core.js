/* OpenAWork 定时任务页布局候选 · 共享数据与外壳
   数据取自网关真实字段（CronJobRecord / CronExecutionRecord），
   时间轴固定为 2026-11-02 14:20，保证各方案对照时数值一致。 */
(function () {
  'use strict';

  var NOW = new Date('2026-11-02T14:20:00');

  var JOBS = [
    {
      id: 'job_daily_brief',
      name: '每日站会摘要',
      kind: 'cron',
      expr: '0 9 * * *',
      tz: 'Asia/Shanghai',
      status: 'enabled',
      running: false,
      delivery: 'desktop',
      fireCount: 42,
      lastFiredAt: '2026-11-02T09:00:00',
      lastResult: 'completed',
      durationMs: 18400,
      nextFireAt: '2026-11-03T09:00:00',
      prompt: '汇总今天收到的通知与待办，输出 5 条要点，并标出需要我拍板的项。',
    },
    {
      id: 'job_inbox_cleanup',
      name: '周一收件箱清理',
      kind: 'cron',
      expr: '0 10 * * 1',
      tz: 'Asia/Shanghai',
      status: 'enabled',
      running: false,
      delivery: 'session',
      deliveryTarget: '会话 inbox-triage',
      fireCount: 7,
      lastFiredAt: '2026-10-26T10:00:00',
      lastResult: 'completed',
      durationMs: 46200,
      nextFireAt: '2026-11-09T10:00:00',
      prompt: '把收件箱里超过 3 天未回复的邮件挑出来，按发件人分组，草拟回复要点。',
    },
    {
      id: 'job_health_probe',
      name: '服务健康巡检',
      kind: 'every',
      expr: '每 30 分钟',
      tz: 'Asia/Shanghai',
      status: 'enabled',
      running: true,
      delivery: 'none',
      fireCount: 128,
      lastFiredAt: '2026-11-02T14:00:00',
      lastResult: 'completed',
      durationMs: 6100,
      nextFireAt: '2026-11-02T14:30:00',
      prompt: '检查网关与桌面端的连通性，异常时给出可能原因与下一步排查命令。',
    },
    {
      id: 'job_weekly_report',
      name: '每周五周报',
      kind: 'cron',
      expr: '0 18 * * 5',
      tz: 'Asia/Shanghai',
      status: 'disabled',
      running: false,
      delivery: 'desktop',
      fireCount: 3,
      lastFiredAt: '2026-10-30T18:00:00',
      lastResult: 'failed',
      durationMs: 120000,
      lastError: '模型调用超时（120s）：上游 provider 在 3 次重试后仍未返回',
      nextFireAt: null,
      prompt: '汇总本周合并的 PR、关闭的 issue 与延期项，生成周报草稿。',
    },
    {
      id: 'job_reply_reminder',
      name: '给张工回邮件提醒',
      kind: 'at',
      expr: '2026-11-03 10:30',
      tz: 'Asia/Shanghai',
      status: 'enabled',
      running: false,
      delivery: 'desktop',
      fireCount: 0,
      lastFiredAt: null,
      lastResult: null,
      durationMs: null,
      nextFireAt: '2026-11-03T10:30:00',
      prompt: '提醒我回复张工关于接口联调时间的邮件，并附上当前排期。',
    },
    {
      id: 'job_night_backup',
      name: '夜间会话备份',
      kind: 'every',
      expr: '每 6 小时',
      tz: 'Asia/Shanghai',
      status: 'disabled',
      running: false,
      delivery: 'none',
      fireCount: 61,
      lastFiredAt: '2026-11-01T00:00:00',
      lastResult: 'skipped',
      durationMs: null,
      lastError: '上一轮执行仍在运行，本次 tick 跳过',
      nextFireAt: null,
      prompt: '把最近 6 小时的会话导出到产物目录，只保留元数据。',
    },
    {
      id: 'job_artifact_archive',
      name: '产物目录归档',
      kind: 'cron',
      expr: '30 23 * * *',
      tz: 'Asia/Shanghai',
      status: 'enabled',
      running: false,
      delivery: 'none',
      fireCount: 19,
      lastFiredAt: '2026-11-01T23:30:00',
      lastResult: 'completed',
      durationMs: 9300,
      nextFireAt: '2026-11-02T23:30:00',
      prompt: '把超过 30 天的产物打包归档，同时输出占用空间变化。',
    },
  ];

  var HISTORY = {
    job_daily_brief: [
      {
        id: 'ex_1',
        status: 'completed',
        startedAt: '2026-11-02T09:00:00',
        durationMs: 18400,
        sessionId: 'sess_9f21',
        outputPreview:
          '今日要点\n1. 网关并发上限已调到 3，长任务会互相挡；建议把巡检拆到独立通道。\n2. 桌面端 0.9.7 的两个崩溃单已合并修复，待今晚出包。\n3. 需要你拍板：会话扩展是否默认开启渠道管理（涉及权限模型）。',
      },
      {
        id: 'ex_2',
        status: 'completed',
        startedAt: '2026-11-01T09:00:00',
        durationMs: 15200,
        sessionId: 'sess_8c07',
        outputPreview:
          '今日要点\n1. 待办 4 项，其中 1 项已逾期 2 天。\n2. 依赖的模型版本将在周五下线，需确认迁移时间。',
      },
      {
        id: 'ex_3',
        status: 'failed',
        startedAt: '2026-10-31T09:00:00',
        durationMs: 120000,
        error: '模型调用超时（120s）：上游 provider 在 3 次重试后仍未返回',
        sessionId: 'sess_7712',
        outputPreview: '',
      },
    ],
    job_inbox_cleanup: [
      {
        id: 'ex_4',
        status: 'completed',
        startedAt: '2026-10-26T10:00:00',
        durationMs: 46200,
        sessionId: 'sess_6ab1',
        outputPreview:
          '3 封待回复：\n· 李工 — 排期确认（可当天回）\n· 供应商 A — 报价延期（需财务确认）\n· 客户 B — 环境权限（已超 5 天）',
      },
    ],
    job_health_probe: [
      {
        id: 'ex_5',
        status: 'completed',
        startedAt: '2026-11-02T14:00:00',
        durationMs: 6100,
        outputPreview: '网关 200 / 桌面端 200，会话写入延迟 12ms。无需处理。',
      },
      {
        id: 'ex_6',
        status: 'skipped',
        startedAt: '2026-11-02T13:30:00',
        durationMs: null,
        error: '全局并发已达上限（3），本次到点触发跳过',
      },
    ],
    job_weekly_report: [
      {
        id: 'ex_7',
        status: 'failed',
        startedAt: '2026-10-30T18:00:00',
        durationMs: 120000,
        error: '模型调用超时（120s）：上游 provider 在 3 次重试后仍未返回',
        sessionId: 'sess_550e',
        outputPreview: '',
      },
    ],
    job_night_backup: [
      {
        id: 'ex_8',
        status: 'skipped',
        startedAt: '2026-11-01T00:00:00',
        durationMs: null,
        error: '上一轮执行仍在运行，本次 tick 跳过',
      },
    ],
    job_artifact_archive: [
      {
        id: 'ex_9',
        status: 'completed',
        startedAt: '2026-11-01T23:30:00',
        durationMs: 9300,
        sessionId: 'sess_44c8',
        outputPreview: '归档 128 个文件（1.4 GiB → 220 MiB），产物目录剩余 3.1 GiB。',
      },
    ],
  };

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function parse(iso) {
    return iso ? new Date(iso) : null;
  }

  function absTime(iso) {
    var d = parse(iso);
    if (!d) return '—';
    return (
      d.getMonth() + 1 + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  function clockTime(iso) {
    var d = parse(iso);
    if (!d) return '—';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function dayLabel(iso) {
    var d = parse(iso);
    if (!d) return '未排期';
    var diff = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
        new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())) /
        86400000,
    );
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    if (diff > 1 && diff < 7) return '周' + '日一二三四五六'[d.getDay()];
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  }

  function relative(iso) {
    var d = parse(iso);
    if (!d) return '已停用';
    var ms = d - NOW;
    var past = ms < 0;
    var min = Math.round(Math.abs(ms) / 60000);
    var text;
    if (min < 1) text = '不到 1 分钟';
    else if (min < 60) text = min + ' 分钟';
    else if (min < 60 * 24) text = Math.round(min / 60) + ' 小时';
    else text = Math.round(min / (60 * 24)) + ' 天';
    return past ? text + '前' : text + '后';
  }

  function duration(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    return Math.round(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
  }

  var RESULT_LABEL = {
    completed: '成功',
    failed: '失败',
    running: '运行中',
    skipped: '跳过',
    expired: '已过期',
  };

  var DELIVERY_LABEL = {
    desktop: '通知我',
    session: '投到会话',
    none: '不投递',
    channel: '渠道回发',
  };

  var KIND_LABEL = { cron: 'cron', every: '间隔', at: '单次' };

  var kindTagClass = { cron: 'tag-cron', every: 'tag-every', at: 'tag-at' };

  function resultClass(status) {
    if (status === 'failed') return 'status-failed';
    if (status === 'running') return 'status-running';
    if (!status || status === 'skipped' || status === 'expired') return 'status-disabled';
    return 'status-enabled';
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text).replace(
      /[&<>"']/g,
      function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      },
    );
  }

  function kindTag(job) {
    return '<span class="tag ' + kindTagClass[job.kind] + '">' + KIND_LABEL[job.kind] + '</span>';
  }

  function statusBadge(job) {
    if (job.running) {
      return '<span class="status status-running"><i class="dot dot-pulse"></i>运行中</span>';
    }
    return job.status === 'enabled'
      ? '<span class="status status-enabled"><i class="dot"></i>已启用</span>'
      : '<span class="status status-disabled"><i class="dot"></i>已停用</span>';
  }

  var PLANS = [
    { id: 'a', file: 'option-a-master-detail.html', label: 'A 双栏详情' },
    { id: 'b', file: 'option-b-compact-table.html', label: 'B 紧凑表格' },
    { id: 'c', file: 'option-c-card-grid.html', label: 'C 卡片网格' },
    { id: 'd', file: 'option-d-timeline.html', label: 'D 时间轴' },
    { id: 'e', file: 'option-e-hybrid.html', label: 'E 卡片+时间轴' },
  ];

  function mountShell(currentId) {
    var mode = document.documentElement.dataset.mode || 'dark';
    var nav = document.createElement('nav');
    nav.className = 'demo-nav';
    var links = PLANS.map(function (plan) {
      return (
        '<a class="btn' +
        (plan.id === currentId ? ' btn-accent' : '') +
        '" ' +
        (plan.id === currentId ? 'aria-current="true" ' : '') +
        'href="./' +
        plan.file +
        '">' +
        plan.label +
        '</a>'
      );
    }).join('');
    nav.innerHTML =
      '<span class="demo-nav-label">布局方案</span>' +
      links +
      '<a class="btn" href="./index.html">方案总览</a>' +
      '<span class="spacer"></span>' +
      '<span class="demo-note">演示数据固定为 2026-11-02 14:20</span>' +
      '<button type="button" class="btn btn-icon" id="demo-theme" title="切换暗/亮主题">' +
      (mode === 'dark' ? '☾' : '☀') +
      '</button>';

    document.body.appendChild(nav);

    var themeButton = nav.querySelector('#demo-theme');
    themeButton.addEventListener('click', function () {
      var next = document.documentElement.dataset.mode === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.mode = next;
      themeButton.textContent = next === 'dark' ? '☾' : '☀';
    });
  }

  function historyFor(jobId) {
    return HISTORY[jobId] || [];
  }

  window.SD = {
    now: NOW,
    jobs: JOBS,
    plans: PLANS,
    historyFor: historyFor,
    absTime: absTime,
    clockTime: clockTime,
    dayLabel: dayLabel,
    relative: relative,
    duration: duration,
    resultLabel: function (status) {
      return RESULT_LABEL[status] || '未执行';
    },
    deliveryLabel: function (mode) {
      return DELIVERY_LABEL[mode] || '不投递';
    },
    kindLabel: function (job) {
      return KIND_LABEL[job.kind];
    },
    kindTag: kindTag,
    statusBadge: statusBadge,
    resultClass: resultClass,
    escapeHtml: escapeHtml,
    mountShell: mountShell,
  };
})();
