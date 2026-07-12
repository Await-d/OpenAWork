import { useCallback, useMemo } from 'react';
import {
  TemplateEditor,
  createEmptyTemplateEditorState,
  editorStateToTemplateData,
  type EditorState,
} from '../../tabs/governance/TemplateEditorPanel.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, type TeamCoreRole } from '@openAwork/shared';
import { useTeamRuntimeRoleBindings } from '../../hooks/use-team-runtime-role-bindings.js';
import type { CoreRole, ManagedAgentRecord } from '@openAwork/shared';

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
  backdropFilter: 'blur(4px)',
  padding: 16,
} as const;

const MODAL_STYLE = {
  position: 'relative',
  width: 'min(760px, calc(100vw - 32px))',
  maxHeight: '90vh',
  overflow: 'hidden',
  borderRadius: 14,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
  display: 'grid',
} as const;

export function NewTeamTemplateModal({ onClose }: { onClose: () => void }) {
  const { createTemplate, busy } = useTeamRuntimeReferenceViewData();
  const roleBindings = useTeamRuntimeRoleBindings();
  const initialState = useMemo(
    () => buildInitialTemplateEditorState(roleBindings.roleCards),
    [roleBindings.roleCards],
  );

  const handleSave = useCallback(
    async (state: EditorState) => {
      const templateData = editorStateToTemplateData(state);
      const defaultBindings: Record<
        string,
        { agentId: string; providerId?: string; modelId?: string; variant?: string }
      > = {};
      for (const [role, binding] of Object.entries(state.roleBindings)) {
        const resolvedRole = role as TeamCoreRole;
        defaultBindings[role] = {
          agentId: FIXED_TEAM_CORE_ROLE_BINDINGS[resolvedRole],
          ...(binding.providerId ? { providerId: binding.providerId } : {}),
          ...(binding.modelId ? { modelId: binding.modelId } : {}),
          ...(binding.variant ? { variant: binding.variant } : {}),
        };
      }

      const ok = await createTemplate({
        name: templateData.name,
        description: templateData.description ?? undefined,
        provider: state.provider,
        optionalAgentIds: Array.from(state.optionalAgentIds),
        defaultBindings,
        templateExtra: {
          templateScale: state.scale,
          templateFocus: state.focus || null,
          recommendedFor: state.recommendedFor || null,
          recommendedDefault: state.isRecommendedDefault || null,
        },
      });

      if (ok) {
        onClose();
      }
      return ok;
    },
    [createTemplate, onClose],
  );

  return (
    <div style={OVERLAY_STYLE}>
      <button
        type="button"
        aria-label="关闭模板弹窗"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, border: 'none', background: 'transparent' }}
      />
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-labelledby="new-template-title">
        <TemplateEditor
          mode="create"
          initialState={initialState}
          busy={busy}
          onSave={handleSave}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

export function buildInitialTemplateEditorState(
  roleCards: Array<{
    role: CoreRole;
    selectedAgent: ManagedAgentRecord | null;
    selectedAgentId: string;
  }>,
): EditorState {
  const base = createEmptyTemplateEditorState();
  const roleBindings = Object.fromEntries(
    roleCards
      .filter((card) =>
        ['leader', 'planner', 'researcher', 'executor', 'reviewer'].includes(card.role),
      )
      .map((card) => {
        const role = card.role as TeamCoreRole;
        return [
          role,
          {
            agentId:
              card.selectedAgent?.id || card.selectedAgentId || FIXED_TEAM_CORE_ROLE_BINDINGS[role],
            providerId: '',
            modelId: '',
            variant: '',
          },
        ];
      }),
  );

  return {
    ...base,
    roleBindings,
  };
}
