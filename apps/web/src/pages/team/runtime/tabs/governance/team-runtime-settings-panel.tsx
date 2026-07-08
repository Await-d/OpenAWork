import { useMemo } from 'react';
import { createTeamPhaseAClient } from '@openAwork/web-client';
import { AdapterConfigPanel } from '../../shared/WorkflowEditor.js';
import { TeamDefaultRosterSection } from './team-default-roster-section.js';
import { ConstitutionSection } from './team-runtime-constitution-section.js';
import { ForceApplySection } from './team-runtime-force-apply-section.js';
import { InstructionStackPreviewSection } from './team-runtime-instruction-stack-preview-section.js';
import { PersonasSection } from './team-runtime-personas-section.js';
import { TemplateManagementEntry } from './team-runtime-template-management-entry.js';
import { UserMemorySection } from './team-runtime-user-memory-section.js';
import {
  CJK_DESCRIPTION_STYLE,
  INLINE_PHRASE_STYLE,
  PANEL_INSET_STYLE,
  SECTION_HEADER_STYLE,
  TINY_LABEL_STYLE,
} from './team-runtime-settings-panel-shared.js';

export { MemoryWriteBadge } from './team-runtime-memory-write-badge.js';
export type { MemoryWriteBadgeProps } from './team-runtime-memory-write-badge.js';

interface TeamRuntimeSettingsPanelProps {
  gatewayUrl: string;
  accessToken: string | null;
  onWorkspaceChanged?: () => void;
  teamWorkspaceId: string | null;
}

export function TeamRuntimeSettingsPanel({
  gatewayUrl,
  accessToken,
  onWorkspaceChanged,
  teamWorkspaceId,
}: TeamRuntimeSettingsPanelProps) {
  const client = useMemo(() => createTeamPhaseAClient(gatewayUrl), [gatewayUrl]);

  if (!accessToken) {
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <header style={SECTION_HEADER_STYLE}>
          <span style={TINY_LABEL_STYLE}>Team settings</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>团队设置</span>
          <span style={CJK_DESCRIPTION_STYLE}>登录后才可编辑团队宪法 / 用户记忆 / 角色 SOUL。</span>
        </header>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <header style={SECTION_HEADER_STYLE}>
        <span style={TINY_LABEL_STYLE}>Team settings</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>团队设置</span>
        <span style={CJK_DESCRIPTION_STYLE}>
          编辑保存后立即生效；如要让正在进行的会话也使用新内容，可以点
          <strong style={INLINE_PHRASE_STYLE}>「ForceApply 应用更新」</strong>
          触发缓存刷新。默认固定团队会作为新会话的基础 roster。
        </span>
      </header>

      <ForceApplySection token={accessToken} client={client} />

      <TeamDefaultRosterSection
        gatewayUrl={gatewayUrl}
        token={accessToken}
        onSaved={onWorkspaceChanged}
        teamWorkspaceId={teamWorkspaceId}
      />

      {teamWorkspaceId ? (
        <ConstitutionSection
          token={accessToken}
          client={client}
          teamWorkspaceId={teamWorkspaceId}
        />
      ) : (
        <div style={PANEL_INSET_STYLE}>
          <strong style={{ fontSize: 12 }}>团队宪法</strong>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            选择一个具体的 team workspace 后才能编辑它的宪法。
          </span>
        </div>
      )}

      <UserMemorySection token={accessToken} client={client} />

      <PersonasSection token={accessToken} client={client} />

      <AdapterConfigPanel />

      <InstructionStackPreviewSection
        token={accessToken}
        client={client}
        teamWorkspaceId={teamWorkspaceId}
      />

      <TemplateManagementEntry />
    </section>
  );
}
