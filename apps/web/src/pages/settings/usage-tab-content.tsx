import {
  AuditLogExportButton,
  BudgetAlert,
  CostOverview,
  ModelPriceConfig,
  UsageDashboard,
} from '@openAwork/shared-ui';
import type { CostBreakdownItem, ModelPriceEntry, MonthlyRecord } from '@openAwork/shared-ui';
import type { SettingsDevLogRecord } from '../settings-types.js';
import { buildAuditExportContent } from '../settings-derived.js';
import { SS, ST, UV } from './settings-section-styles.js';

interface UsageTabContentProps {
  usageRecords: MonthlyRecord[];
  usageBudget: number;
  monthlyCostUsd: number;
  costBreakdown: CostBreakdownItem[];
  priceModels: ModelPriceEntry[];
  devLogs: SettingsDevLogRecord[];
  usageRecordsError?: string | null;
  costBreakdownError?: string | null;
  priceModelsError?: string | null;
}

function UsageErrorNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '0.9rem 1rem',
        borderRadius: 10,
        border: '1px solid rgba(248, 113, 113, 0.4)',
        background: 'rgba(127, 29, 29, 0.18)',
        color: 'var(--text-1, #f8fafc)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2, #cbd5f5)' }}>{detail}</div>
    </div>
  );
}

export function UsageTabContent({
  usageRecords,
  usageBudget,
  monthlyCostUsd,
  costBreakdown,
  priceModels,
  devLogs,
  usageRecordsError = null,
  costBreakdownError = null,
  priceModelsError = null,
}: UsageTabContentProps) {
  return (
    <>
      <section style={SS}>
        <h3 style={ST}>用量与费用</h3>
        {usageRecordsError ? (
          <div style={UV}>
            <UsageErrorNotice title="用量记录加载失败" detail={usageRecordsError} />
          </div>
        ) : (
          <>
            <div style={UV}>
              <BudgetAlert currentCostUsd={monthlyCostUsd} budgetUsd={usageBudget} />
            </div>
            <div style={UV}>
              <UsageDashboard records={usageRecords} budgetUsd={usageBudget} />
            </div>
          </>
        )}
        {costBreakdownError ? (
          <div style={UV}>
            <UsageErrorNotice title="费用明细加载失败" detail={costBreakdownError} />
          </div>
        ) : (
          <div style={UV}>
            <CostOverview monthlyCostUsd={monthlyCostUsd} breakdown={costBreakdown} />
          </div>
        )}
      </section>
      <section style={SS}>
        <h3 style={ST}>模型费用配置</h3>
        {priceModelsError ? (
          <UsageErrorNotice title="模型费用配置加载失败" detail={priceModelsError} />
        ) : priceModels.length > 0 ? (
          <div style={UV}>
            <ModelPriceConfig models={priceModels} onUpdate={() => undefined} />
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无模型费用数据</p>
        )}
      </section>
      <section style={SS}>
        <h3 style={ST}>审计日志导出</h3>
        <div style={UV}>
          <AuditLogExportButton
            sessionId="settings-logs"
            onExport={async (_id: string, format: 'json' | 'markdown') =>
              buildAuditExportContent(devLogs, format)
            }
          />
        </div>
      </section>
    </>
  );
}
