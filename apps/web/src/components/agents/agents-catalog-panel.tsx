/**
 * Agent 管理页左列：Agent 目录（紧凑行列表）。
 *
 * 形态取舍：行高约 48px 的紧凑行替代旧版「每条 Agent 一张圆角卡 + 5~8 个标签」，
 * 一屏能看到更多条目；角色、模型与覆盖状态降级为行内小徽章 / 等宽小字。
 */

import { AgentsBadge, AgentsStatusDot } from './agents-primitives.js';
import {
  ORIGIN_LABELS,
  formatCanonicalRoleZh,
  localizeAgentDescription,
} from './agents-editor-state.js';
import type { EditorMode } from './agents-editor-state.js';
import type { ManagedAgentRecord } from '@openAwork/shared';

export function AgentsCatalogPanel({
  loading,
  filteredAgents,
  editorMode,
  selectedAgentId,
  saving,
  onSelect,
}: {
  loading: boolean;
  filteredAgents: ManagedAgentRecord[];
  editorMode: EditorMode;
  selectedAgentId: string | null;
  saving: boolean;
  onSelect: (agentId: string) => void;
}) {
  return (
    <section className="console-col" aria-label="Agent 目录">
      <div className="console-col__head">
        <h2 className="console-col__title">目录</h2>
        <span className="console-badge">{filteredAgents.length}</span>
      </div>

      <div className="console-col__scroll">
        {loading ? (
          <div className="console-empty">正在加载 Agent 列表…</div>
        ) : filteredAgents.length === 0 ? (
          <div className="console-empty">
            没有匹配的 Agent。试试调整筛选条件或新增自定义 Agent。
          </div>
        ) : (
          filteredAgents.map((agent) => {
            const active = editorMode === 'edit' && agent.id === selectedAgentId;
            const role = formatCanonicalRoleZh(agent);
            return (
              <button
                key={agent.id}
                type="button"
                className={`console-row agents-row${active ? ' is-active' : ''}`}
                aria-current={active ? 'true' : undefined}
                disabled={saving}
                title={localizeAgentDescription(agent) || agent.label}
                onClick={() => onSelect(agent.id)}
              >
                <AgentsStatusDot enabled={agent.enabled} />
                <span className="agents-row__main">
                  <span className="agents-row__title">
                    <span className="agents-row__label">{agent.label}</span>
                    {agent.hasOverrides ? <AgentsBadge tone="contrast">已修改</AgentsBadge> : null}
                  </span>
                  <span className="console-subline">
                    {agent.id} · {ORIGIN_LABELS[agent.origin]}
                  </span>
                  <span className="agents-row__tags">
                    {role ? <AgentsBadge tone="accent">{role}</AgentsBadge> : null}
                    {agent.promptMetadata?.hasPromptOverride ? (
                      <AgentsBadge tone="aux" title="系统提示词已被用户覆盖，不再随版本升级更新">
                        提示词覆盖
                      </AgentsBadge>
                    ) : null}
                    {agent.enabled ? null : <AgentsBadge>已禁用</AgentsBadge>}
                    <span className="agents-row__model">{agent.model ?? '默认模型'}</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
