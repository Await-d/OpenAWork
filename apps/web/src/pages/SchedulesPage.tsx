import { CronManager, ScheduleManagerUI } from '@openAwork/shared-ui';
import type { CronJob, ScheduleTaskItem } from '@openAwork/shared-ui';
import React, { useEffect, useState } from 'react';
import { logger } from '../utils/logger.js';
import { useAuthStore } from '../stores/auth.js';

const sharedUiThemeVars = {
  '--color-surface': 'var(--surface)',
  '--color-border': 'var(--border)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
  '--color-bg': 'var(--bg)',
  '--color-background': 'var(--bg)',
  '--color-foreground': 'var(--text)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--accent-text)',
} as React.CSSProperties;

export default function SchedulesPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [tasks, setTasks] = useState<ScheduleTaskItem[]>([]);

  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${gatewayUrl}/cron/jobs`, { headers }).then(
        (r) => r.json() as Promise<{ jobs: CronJob[] }>,
      ),
    ]).then(([data]) => {
      setJobs(data.jobs);
    });
  }, [token, gatewayUrl]);

  const apiFetch = (path: string, init?: RequestInit) =>
    fetch(`${gatewayUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">定时任务</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => logger.info('Add schedule triggered')}
          className="btn-accent"
        >
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
            gap: 16,
          }}
        >
          <div>
            <span className="section-label">定时规则</span>
            <div className="content-card" style={sharedUiThemeVars}>
              <CronManager
                jobs={jobs}
                onEnable={(id) => {
                  void apiFetch(`/cron/jobs/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: true }),
                  }).then(() =>
                    setJobs((prev) =>
                      prev.map((j) => (j.id === id ? { ...j, status: 'enabled' } : j)),
                    ),
                  );
                }}
                onDisable={(id) => {
                  void apiFetch(`/cron/jobs/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: false }),
                  }).then(() =>
                    setJobs((prev) =>
                      prev.map((j) => (j.id === id ? { ...j, status: 'disabled' } : j)),
                    ),
                  );
                }}
                onDelete={(id) => {
                  void apiFetch(`/cron/jobs/${id}`, { method: 'DELETE' }).then(() =>
                    setJobs((prev) => prev.filter((j) => j.id !== id)),
                  );
                }}
                onRunNow={(id) => logger.info('Run job now', id)}
                onAdd={() => logger.info('Add job triggered')}
              />
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
