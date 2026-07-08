import type { ReactElement } from 'react';

export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  latestVersion?: string;
  source: string;
  enabled: boolean;
  preinstalled?: boolean;
}

export type MarketInstalledSkill = InstalledSkill;

export interface InstalledSkillsManagerProps {
  skills: InstalledSkill[];
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onCheckUpdates: () => void;
  onToggle?: (id: string, nextEnabled: boolean) => void;
  toggleDisabledReason?: (skill: InstalledSkill) => string | null;
}

export function InstalledSkillsManager(props: InstalledSkillsManagerProps): ReactElement {
  const { skills, onToggle, toggleDisabledReason } = props;
  return (
    <table>
      <tbody>
        {skills.map((skill) => {
          const disabledReason = onToggle ? (toggleDisabledReason?.(skill) ?? null) : null;
          const showSwitch = !!onToggle && !disabledReason;
          return (
            <tr key={skill.id} data-skill-id={skill.id}>
              <td>{skill.name}</td>
              <td>
                {showSwitch ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={skill.enabled}
                    aria-label={`${skill.enabled ? '禁用' : '启用'} ${skill.name}`}
                    onClick={() => onToggle?.(skill.id, !skill.enabled)}
                  >
                    {skill.enabled ? '已启用' : '已禁用'}
                  </button>
                ) : (
                  <span title={disabledReason ?? undefined}>
                    {skill.enabled ? '已启用' : '已禁用'}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
