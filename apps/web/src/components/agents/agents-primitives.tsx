/** Agent 管理页共用的小型展示原语（头像 / 内联统计 / 徽章）。 */

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { ManagedAgentRecord } from '@openAwork/shared';

export function AgentAvatar({
  label,
  origin,
}: {
  label: string;
  origin: ManagedAgentRecord['origin'];
}) {
  return (
    <span
      aria-hidden="true"
      className={`console-avatar${origin === 'custom' ? ' console-avatar--accent' : ''}`}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AgentsBadge({
  children,
  tone = 'default',
  mono = false,
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'aux' | 'contrast' | 'success' | 'danger';
  mono?: boolean;
  title?: string;
}) {
  const toneClass = tone === 'default' ? '' : ` console-badge--${tone}`;
  const monoClass = mono ? ' console-badge--mono' : '';
  return (
    <span className={`console-badge${toneClass}${monoClass}`} title={title}>
      {children}
    </span>
  );
}

interface AgentsStat {
  label: string;
  value: string;
}

/** 标题行 / 工具条里的内联统计，替代原先的 4 张大统计卡。 */
export function AgentsStatLine({
  stats,
  tone = 'default',
}: {
  stats: AgentsStat[];
  tone?: 'default' | 'warn';
}) {
  return (
    <div className={`console-statline${tone === 'warn' ? ' console-statline--warn' : ''}`}>
      {stats.map((stat, index) => (
        <Fragment key={stat.label}>
          {index > 0 ? <span className="console-statline__sep" aria-hidden="true" /> : null}
          <span>
            {stat.label} <b>{stat.value}</b>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export function AgentsStatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`console-dot${enabled ? '' : ' is-off'}`}
      data-enabled={enabled ? 'true' : 'false'}
    />
  );
}

export function AgentsSwitch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="console-switch"
      disabled={disabled}
      onClick={onChange}
    />
  );
}
