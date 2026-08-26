import React, { useEffect, useState } from 'react';
import { createSettingsClient, createUsageClient } from '@openAwork/web-client';
import { UsageDashboard, CostOverview, ModelCostDisplay } from '@openAwork/shared-ui';
import type { MonthlyRecord, CostBreakdownItem } from '@openAwork/shared-ui';
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

interface ModelPriceEntry {
  modelName: string;
  providerId?: string;
  inputPer1m: number;
  outputPer1m: number;
  contextWindow?: number;
  cacheReadPer1m?: number;
  cacheWritePer1m?: number;
}

export default function UsagePage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [records, setRecords] = useState<MonthlyRecord[]>([]);
  const [budgetUsd, setBudgetUsd] = useState(20);
  const [monthlyCostUsd, setMonthlyCostUsd] = useState(0);
  const [breakdown, setBreakdown] = useState<CostBreakdownItem[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPriceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const usageClient = createUsageClient(gatewayUrl);
    const settingsClient = createSettingsClient(gatewayUrl);
    Promise.all([
      usageClient.getRecords(token),
      usageClient.getBreakdown(token),
      settingsClient.getModelPrices(token) as Promise<{ models: ModelPriceEntry[] }>,
    ])
      .then(([usageData, breakdownData, pricesData]) => {
        setRecords((usageData.records ?? []) as MonthlyRecord[]);
        setBudgetUsd(usageData.budgetUsd ?? 20);
        setMonthlyCostUsd(breakdownData.monthlyCostUsd ?? 0);
        setBreakdown(breakdownData.breakdown ?? []);
        setModelPrices(pricesData.models ?? []);
      })
      .finally(() => setLoading(false));
  }, [token, gatewayUrl]);

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">用量与费用</span>
        <span className="page-subtitle">{loading ? '加载中…' : '本月用量概览'}</span>
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
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div
                    className="omo-skel"
                    style={{ height: 12, width: 80, marginBottom: 10, borderRadius: 4 }}
                  />
                  <div
                    className="content-card"
                    style={{
                      padding: '24px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <div
                      className="omo-skel"
                      style={{ height: 14, width: '60%', borderRadius: 4 }}
                    />
                    <div
                      className="omo-skel"
                      style={{ height: 10, width: '40%', borderRadius: 4 }}
                    />
                    <div
                      className="omo-skel"
                      style={{ height: 32, width: '100%', borderRadius: 6 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div>
                <span className="section-label">月度用量</span>
                <div className="content-card" style={sharedUiThemeVars}>
                  <UsageDashboard records={records} budgetUsd={budgetUsd} />
                </div>
              </div>
              <div>
                <span className="section-label">费用详情</span>
                <div className="content-card" style={sharedUiThemeVars}>
                  <CostOverview monthlyCostUsd={monthlyCostUsd} breakdown={breakdown} />
                </div>
              </div>
              <div>
                <span className="section-label">模型单价</span>
                <div
                  className="content-card"
                  style={{
                    ...sharedUiThemeVars,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 12,
                  }}
                >
                  {modelPrices.length === 0 && (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>暂无模型价格数据</span>
                  )}
                  {modelPrices.map((m) => (
                    <div
                      key={`${m.providerId ?? 'unknown'}:${m.modelName}`}
                      style={sharedUiThemeVars}
                    >
                      <ModelCostDisplay
                        modelName={m.modelName}
                        inputPer1m={m.inputPer1m}
                        outputPer1m={m.outputPer1m}
                        contextWindow={m.contextWindow}
                        cacheReadPer1m={m.cacheReadPer1m}
                        cacheWritePer1m={m.cacheWritePer1m}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
