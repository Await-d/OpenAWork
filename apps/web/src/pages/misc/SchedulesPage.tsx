import { CronManager, ScheduleManagerUI } from '@openAwork/shared-ui';
import type { CronJob, ScheduleTaskItem } from '@openAwork/shared-ui';
import React, { useEffect, useState } from 'react';
import { createCronClient } from '@openAwork/web-client';
import { logger } from '../../utils/log/logger.js';
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

export default function SchedulesPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [tasks, setTasks] = useState<ScheduleTaskItem[]>([]);

  useEffect(() => {
    if (!token) return;
    void createCronClient(gatewayUrl)
      .list(token)
      .then((items) => {
        setJobs(items as unknown as CronJob[]);
      })
      .catch(() => undefined);
  }, [token, gatewayUrl]);

  const cronClient = createCronClient(gatewayUrl);

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">定时任务</span>
        <span className="page-subtitle">管理自动化定时规则与计划任务</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => logger.info('Add schedule triggered')}
          className="btn-accent"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ marginRight: 4 }}
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          添加任务
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
          <div>
            <span className="section-label">定时规则</span>
            <div className="content-card" style={sharedUiThemeVars}>
              {jobs.length === 0 ? (
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
                  jobs={jobs}
                  onEnable={(id) => {
                    if (!token) return;
                    void cronClient
                      .setEnabled(token, id, true)
                      .then(() =>
                        setJobs((prev) =>
                          prev.map((j) => (j.id === id ? { ...j, status: 'enabled' } : j)),
                        ),
                      );
                  }}
                  onDisable={(id) => {
                    if (!token) return;
                    void cronClient
                      .setEnabled(token, id, false)
                      .then(() =>
                        setJobs((prev) =>
                          prev.map((j) => (j.id === id ? { ...j, status: 'disabled' } : j)),
                        ),
                      );
                  }}
                  onDelete={(id) => {
                    if (!token) return;
                    void cronClient
                      .remove(token, id)
                      .then(() => setJobs((prev) => prev.filter((j) => j.id !== id)));
                  }}
                  onRunNow={(id) => logger.info('Run job now', id)}
                  onAdd={() => logger.info('Add job triggered')}
                />
              )}
            </div>
          </div>
          <div>
            <span className="section-label">计划任务</span>
            <div className="content-card" style={sharedUiThemeVars}>
              <ScheduleManagerUI
                tasks={tasks}
                onToggle={(id, enabled) =>
                  setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)))
                }
                onRemove={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
                onAdd={(name, kind, expr) =>
                  setTasks((prev) => [
                    ...prev,
                    { id: `st${Date.now()}`, name, kind, expression: expr, enabled: true },
                  ])
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
