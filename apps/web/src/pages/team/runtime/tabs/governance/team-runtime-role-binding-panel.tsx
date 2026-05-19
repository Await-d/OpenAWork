import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import { TeamSectionHeader } from '../../../views/team-page-sections.js';

interface TeamRuntimeRoleBindingPanelProps {
  cards: Array<{
    recommendedCapabilities: CapabilityDescriptor[];
    role: CoreRole;
    roleLabel: string;
    selectedAgent: ManagedAgentRecord | null;
    selectedAgentId: string;
  }>;
  error: string | null;
  loading: boolean;
}

export function TeamRuntimeRoleBindingPanel({
  cards,
  error,
  loading,
}: TeamRuntimeRoleBindingPanelProps) {
  return (
    <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <TeamSectionHeader
        eyebrow="Execution roles"
        title="执行角色绑定"
        description="核心角色的 agent 绑定由系统预置并统一维护；这里仅展示当前绑定与推荐能力。"
      />
      {error ? (
        <div
          className="content-card"
          style={{ padding: 12, borderColor: 'rgba(244, 63, 94, 0.35)', color: 'var(--danger-muted)' }}
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="content-card" style={{ padding: 12, color: 'var(--fg-muted)' }}>
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
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{card.role}</span>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in srgb, var(--border-default) 80%, transparent)',
                  background: 'var(--bg-surface)',
                  color: 'var(--fg-strong)',
                  fontSize: 12,
                }}
              >
                {(card.selectedAgent?.label ?? card.selectedAgentId) || '系统预置绑定'}
              </div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
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
                        border: '1px solid color-mix(in srgb, var(--border-default) 80%, transparent)',
                        fontSize: 11,
                        color: 'var(--fg-default)',
                      }}
                    >
                      {capability.label}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>暂无推荐能力</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
