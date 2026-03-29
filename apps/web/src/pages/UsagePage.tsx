import React, { useEffect, useState } from 'react';
import { UsageDashboard, CostOverview, ModelCostDisplay } from '@openAwork/shared-ui';
import type { MonthlyRecord, CostBreakdownItem } from '@openAwork/shared-ui';
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

interface ModelPriceEntry {
  modelName: string;
  inputPer1m: number;
  outputPer1m: number;
  cachedPer1m?: number;
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
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${gatewayUrl}/usage/records`, { headers }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ records: MonthlyRecord[]; budgetUsd: number }>;
      }),
      fetch(`${gatewayUrl}/usage/breakdown`, { headers }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ monthlyCostUsd: number; breakdown: CostBreakdownItem[] }>;
      }),
      fetch(`${gatewayUrl}/settings/model-prices`, { headers }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ models: ModelPriceEntry[] }>;
      }),
    ])
      .then(([usageData, breakdownData, pricesData]) => {
        setRecords(usageData.records ?? []);
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
        <span className="page-subtitle">{loading ? '加载中…' : '本月用量'}</span>
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
              {modelPrices.map((m) => (
                <div key={m.modelName} style={sharedUiThemeVars}>
                  <ModelCostDisplay
                    modelName={m.modelName}
                    inputPer1m={m.inputPer1m}
                    outputPer1m={m.outputPer1m}
                    cachedPer1m={m.cachedPer1m}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
