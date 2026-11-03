/**
 * Agent 管理页筛选工具条：搜索 + 类型分段 + 角色 / 状态下拉 + 命中数。
 *
 * 旧版是独立的「智能体目录」卡片（卡片里再放一行筛选），与 Hero 卡形成两层
 * 大圆角外壳；现在压成一条工具条，筛选与结果数同屏可见。
 */

import { CORE_ROLE_LABELS } from './agents-editor-state.js';
import type { AgentsFilterState } from './agents-page-data.js';
import type { CoreRole } from '@openAwork/shared';

const ORIGIN_OPTIONS: Array<{ value: AgentsFilterState['originFilter']; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'builtin', label: '内置' },
  { value: 'custom', label: '自定义' },
];

const STATUS_OPTIONS: Array<{ value: AgentsFilterState['statusFilter']; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '仅启用' },
  { value: 'disabled', label: '仅禁用' },
];

export function AgentsToolbar({
  filter,
  roleOptions,
  matchCount,
  totalCount,
  onChange,
}: {
  filter: AgentsFilterState;
  roleOptions: CoreRole[];
  matchCount: number;
  totalCount: number;
  onChange: (patch: Partial<AgentsFilterState>) => void;
}) {
  return (
    <div className="console-toolbar">
      <label className="console-search">
        <input
          className="console-field"
          value={filter.query}
          placeholder="搜索名称、别名、角色、说明或 system prompt…"
          aria-label="搜索 Agent"
          onChange={(event) => onChange({ query: event.target.value })}
        />
      </label>

      <div className="console-seg" role="group" aria-label="按类型筛选">
        {ORIGIN_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`console-seg__btn${filter.originFilter === option.value ? ' is-active' : ''}`}
            aria-pressed={filter.originFilter === option.value}
            onClick={() => onChange({ originFilter: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="console-label agents-toolbar__role">
        <select
          className="console-select"
          value={filter.roleFilter}
          aria-label="按角色筛选"
          onChange={(event) =>
            onChange({ roleFilter: event.target.value as AgentsFilterState['roleFilter'] })
          }
        >
          <option value="all">全部角色</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {CORE_ROLE_LABELS[role] ?? role}
            </option>
          ))}
        </select>
      </label>

      <label className="console-label agents-toolbar__status">
        <select
          className="console-select"
          value={filter.statusFilter}
          aria-label="按状态筛选"
          onChange={(event) =>
            onChange({ statusFilter: event.target.value as AgentsFilterState['statusFilter'] })
          }
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <span className="console-spacer" />

      <span className="console-statline">
        匹配 <b>{matchCount}</b> / {totalCount}
      </span>
    </div>
  );
}
