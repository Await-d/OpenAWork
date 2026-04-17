import { useCallback, useMemo, useState } from 'react';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import { FIXED_TEAM_CORE_ROLE_BINDINGS } from '@openAwork/shared';
import {
  createBlankTeamSessionDraft,
  REQUIRED_CORE_ROLES,
  type RequiredCoreRole,
  type TeamSessionCreationDraft,
  type TeamSessionCreationFieldErrors,
  type TeamSessionCreationSource,
  type TeamSessionCreationStep,
} from './team-session-creation.types.js';

interface UseTeamSessionCreationOptions {
  teamWorkspaceId: string;
}

const STEP_ORDER: TeamSessionCreationStep[] = [
  'source',
  'required-roles',
  'optional-members',
  'review',
];

function buildFieldErrors(draft: TeamSessionCreationDraft): TeamSessionCreationFieldErrors {
  return {
    title: draft.title.trim().length > 0 ? null : '请输入会话标题',
  };
}

function hasBlockingErrors(step: TeamSessionCreationStep, errors: TeamSessionCreationFieldErrors) {
  if (step === 'source') {
    return false;
  }

  if (step === 'required-roles' || step === 'review') {
    return Boolean(errors.title);
  }

  return false;
}

export function useTeamSessionCreation(options: UseTeamSessionCreationOptions) {
  const [draft, setDraft] = useState<TeamSessionCreationDraft>(() =>
    createBlankTeamSessionDraft(options.teamWorkspaceId),
  );
  const [step, setStep] = useState<TeamSessionCreationStep>('source');

  const fieldErrors = useMemo(() => buildFieldErrors(draft), [draft]);
  const currentStepIndex = STEP_ORDER.indexOf(step);
  const canAdvance = !hasBlockingErrors(step, fieldErrors);
  const canSubmit = step === 'review' && !hasBlockingErrors('review', fieldErrors);

  const setTitle = useCallback((title: string) => {
    setDraft((current) => ({
      ...current,
      title,
    }));
  }, []);

  const setSource = useCallback((source: TeamSessionCreationSource) => {
    setDraft((current) => ({
      ...current,
      source,
    }));
  }, []);

  const applyTemplate = useCallback((template: WorkflowTemplateRecord) => {
    const teamTemplate = template.metadata?.teamTemplate;
    const defaultBindings = teamTemplate?.defaultBindings ?? {};

    setDraft((current) => ({
      ...current,
      defaultProvider: teamTemplate?.defaultProvider ?? current.defaultProvider,
      optionalAgentIds: [...(teamTemplate?.optionalAgentIds ?? [])],
      requiredRoleBindings: {
        ...FIXED_TEAM_CORE_ROLE_BINDINGS,
        ...defaultBindings,
      },
      source: {
        kind: 'saved-template',
        templateId: template.id,
      },
    }));
  }, []);

  const toggleOptionalAgent = useCallback((agentId: string) => {
    setDraft((current) => {
      const selected = new Set(current.optionalAgentIds);
      if (selected.has(agentId)) {
        selected.delete(agentId);
      } else {
        selected.add(agentId);
      }
      return {
        ...current,
        optionalAgentIds: Array.from(selected),
      };
    });
  }, []);

  const nextStep = useCallback(() => {
    if (!canAdvance) {
      return false;
    }

    setStep(
      (current) => STEP_ORDER[Math.min(STEP_ORDER.indexOf(current) + 1, STEP_ORDER.length - 1)]!,
    );
    return true;
  }, [canAdvance]);

  const prevStep = useCallback(() => {
    setStep((current) => STEP_ORDER[Math.max(STEP_ORDER.indexOf(current) - 1, 0)]!);
  }, []);

  const reset = useCallback(() => {
    setDraft(createBlankTeamSessionDraft(options.teamWorkspaceId));
    setStep('source');
  }, [options.teamWorkspaceId]);

  return {
    canAdvance,
    canSubmit,
    currentStepIndex,
    draft,
    fieldErrors,
    nextStep,
    prevStep,
    reset,
    applyTemplate,
    setSource,
    setTitle,
    step,
    steps: STEP_ORDER,
    toggleOptionalAgent,
  };
}
