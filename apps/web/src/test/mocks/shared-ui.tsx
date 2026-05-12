import type { ReactElement, ReactNode } from 'react';

export interface GenerativeUIMessage {
  payload?: Record<string, unknown>;
  type?: string;
}

export function GenerativeUIRenderer(_props: { message: GenerativeUIMessage }): ReactNode {
  return null;
}

/**
 * Lightweight mock of the real `@openAwork/shared-ui` InstalledSkillsManager
 * used by tests that need to drive user interactions (toggle switches,
 * click "移除", etc.) without pulling the full compiled dist bundle.
 *
 * Contract mirrored:
 *   - Renders the skill name (so `findByText(name)` works).
 *   - For each row, emits a `role=switch` button with aria-label
 *     `"禁用 <name>"` or `"启用 <name>"` and aria-checked matching
 *     `enabled` — UNLESS `onToggle` is omitted OR `toggleDisabledReason`
 *     returns a non-null string, in which case a plain badge is shown
 *     instead (matching the real component's fallback).
 *   - Calls `onToggle(id, !enabled)` with the INVERTED state.
 */
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
