import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import { TeamSectionHeader } from '../team-page-sections.js';

interface TeamRuntimeRoleBindingPanelProps {
  agents: ManagedAgentRecord[];
  cards: Array<{
    recommendedCapabilities: CapabilityDescriptor[];
    role: CoreRole;
    roleLabel: string;
    selectedAgent: ManagedAgentRecord | null;
    selectedAgentId: string;
  }>;
  error: string | null;
  loading: boolean;
  onChange: (role: CoreRole, agentId: string) => void;
}

export function TeamRuntimeRoleBindingPanel({
  agents,
  cards,
  error,
  loading,
  onChange,
}: TeamRuntimeRoleBindingPanelProps) {
  return (
    <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <TeamSectionHeader
        eyebrow="Execution roles"
        title="执行角色绑定"
        description="先做当前 Team 里的本地试配：给 planner / researcher / executor / reviewer 选 Agent，并预览推荐能力。"
      />
      {error ? (
        <div
          className="content-card"
          style={{ padding: 12, borderColor: 'rgba(244, 63, 94, 0.35)', color: '#fecdd3' }}
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="content-card" style={{ padding: 12, color: 'var(--text-3)' }}>
          正在加载 Agent / Capabilities…
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {cards.map((card) => (
            <div
              key={card.role}
              className="content-card"
              style={{ display: 'grid', gap: 8, padding: 12 }}
            >
              <div style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{card.roleLabel}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{card.role}</span>
              </div>
              <select
                aria-label={`执行角色绑定-${card.role}`}
                value={card.selectedAgentId}
                onChange={(event) => onChange(card.role, event.target.value)}
              >
                <option value="">暂不绑定</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                当前 Agent：{card.selectedAgent?.label ?? '未选择'}
                {card.selectedAgent?.canonicalRole?.coreRole
                  ? ` · ${card.selectedAgent.canonicalRole.coreRole}`
                  : ''}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {card.recommendedCapabilities.length > 0 ? (
                  card.recommendedCapabilities.slice(0, 4).map((capability) => (
                    <span
                      key={`${card.role}-${capability.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid color-mix(in srgb, var(--border) 80%, transparent)',
                        fontSize: 11,
                        color: 'var(--text-2)',
                      }}
                    >
                      {capability.label}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>暂无推荐能力</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
