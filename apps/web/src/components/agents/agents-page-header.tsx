/**
 * Agent 管理页标题行：标题 + 说明 + 内联统计 + 全局动作。
 *
 * 取代旧版 Hero 卡（渐变背景 + 4 张统计卡 + 两个按钮，纵向占用约 180px）；
 * 信息等价，统计改为内联数字，纵向占用降到一行。
 */

import { AgentsStatLine } from './agents-primitives.js';
import type { AgentsSummary } from './agents-page-data.js';

export function AgentsPageHeader({
  summary,
  saving,
  onCreate,
  onResetAll,
}: {
  summary: AgentsSummary;
  saving: boolean;
  onCreate: () => void;
  onResetAll: () => void;
}) {
  return (
    <header className="console-head">
      <div className="console-title-group">
        <h1 className="console-title">Agent 管理</h1>
        <p className="console-subtitle">
          统一查看全部 Agent 的定义、状态与能力来源，并执行新增、编辑、禁用、移除与恢复默认。
        </p>
      </div>

      <span className="console-spacer" />

      <AgentsStatLine
        stats={[
          { label: '全部', value: String(summary.total) },
          { label: '已启用', value: String(summary.enabled) },
          { label: '已禁用', value: String(summary.disabled) },
          { label: '自定义', value: String(summary.custom) },
        ]}
      />

      <button
        type="button"
        className="console-btn console-btn--ghost"
        onClick={onResetAll}
        disabled={saving}
      >
        全部恢复默认
      </button>
      <button
        type="button"
        className="console-btn console-btn--primary"
        onClick={onCreate}
        disabled={saving}
      >
        + 新增 Agent
      </button>
    </header>
  );
}
