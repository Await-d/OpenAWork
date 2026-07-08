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
  const leadParts = splitFooterLead(footerLead);

  return (
    <section className="team-fusion-superbar-summary" aria-label="团队运行摘要">
      {footerLead ? (
        <span
          className="team-fusion-superbar-summary__lead"
          aria-label={footerLead}
          title={footerLead}
        >
          {leadParts ? (
            <>
              <span className="team-fusion-superbar-summary__lead-prefix">{leadParts.prefix}</span>
              <span className="team-fusion-superbar-summary__lead-separator" aria-hidden="true">
                {' / '}
              </span>
              <span className="team-fusion-superbar-summary__lead-core">{leadParts.core}</span>
            </>
          ) : (
            footerLead
          )}
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

function splitFooterLead(footerLead: string) {
  const separator = ' / ';
  const separatorIndex = footerLead.indexOf(separator);
  if (separatorIndex < 0) {
    return null;
  }

  const prefix = footerLead.slice(0, separatorIndex).trim();
  const core = footerLead.slice(separatorIndex + separator.length).trim();
  if (!prefix || !core) {
    return null;
  }

  return { core, prefix };
}
