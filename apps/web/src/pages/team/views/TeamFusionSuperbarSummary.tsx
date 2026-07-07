import type { AgentTeamsFooterStat } from '../runtime/data/team-runtime-types.js';

export interface TeamFusionSuperbarSummaryProps {
  readonly description: string;
  readonly footerLead: string;
  readonly footerStats: readonly AgentTeamsFooterStat[];
}

export function TeamFusionSuperbarSummary({
  description,
  footerLead,
  footerStats,
}: TeamFusionSuperbarSummaryProps) {
  const visibleStats = footerStats.slice(0, 3);

  return (
    <section className="team-fusion-superbar-summary" aria-label="团队运行摘要">
      {footerLead ? (
        <span className="team-fusion-superbar-summary__lead" title={footerLead}>
          {footerLead}
        </span>
      ) : null}
      {visibleStats.map((stat) => (
        <span
          key={stat.label}
          className="team-fusion-superbar-summary__stat"
          title={`${stat.label} ${stat.value}`}
        >
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </span>
      ))}
      {description ? (
        <span className="team-fusion-superbar-summary__description" title={description}>
          {description}
        </span>
      ) : null}
    </section>
  );
}
