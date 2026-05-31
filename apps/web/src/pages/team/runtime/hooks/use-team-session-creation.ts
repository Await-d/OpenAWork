import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import { FIXED_TEAM_CORE_ROLE_BINDINGS } from '@openAwork/shared';
import type { FixedTeamMemberSlot } from '@openAwork/shared';
import {
  createBlankTeamSessionDraft,
  type TeamSessionCreationDraft,
  type TeamSessionCreationFieldErrors,
  type TeamSessionCreationSource,
  type TeamSessionCreationStep,
} from '../data/team-session-creation.types.js';

interface UseTeamSessionCreationOptions {
  defaultMemberSlots?: FixedTeamMemberSlot[];
  teamWorkspaceId: string;
}

const STEP_ORDER: TeamSessionCreationStep[] = [
  'source',
  'required-roles',
  'optional-members',
  'review',
];

function buildFieldErrors(_draft: TeamSessionCreationDraft): TeamSessionCreationFieldErrors {
  // 标题不再强制：空标题在提交前会被 fillDefaultTitle 兜底为「团队会话 + 时间戳」。
  return {};
}

/**
 * 生成默认会话标题：「团队会话 YYYY-MM-DD HH:mm」
 * 用于在用户未填写标题时兜底，避免空标题阻塞创建流程。
 */
export function generateDefaultSessionTitle(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `团队会话 ${date} ${time}`;
}

function hasBlockingErrors(
  _step: TeamSessionCreationStep,
  _errors: TeamSessionCreationFieldErrors,
) {
  // 当前所有步骤无强制错误。预留扩展能力：未来若加新字段，可在此返回 true 阻塞。
  return false;
}

export function useTeamSessionCreation(options: UseTeamSessionCreationOptions) {
  const [draft, setDraft] = useState<TeamSessionCreationDraft>(() =>
    createBlankTeamSessionDraft(options.teamWorkspaceId, options.defaultMemberSlots),
  );
  const [step, setStep] = useState<TeamSessionCreationStep>('source');

  useEffect(() => {
    const slots = options.defaultMemberSlots ?? [];
    setDraft((current) => ({
      ...current,
      memberSlots:
        slots.length > 0
          ? slots.map((slot) => ({
              ...slot,
              toolsets: [...slot.toolsets],
            }))
          : [],
    }));
  }, [options.defaultMemberSlots]);

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

  /**
   * 当用户跳过填写标题时，使用「团队会话 + 时间戳」自动填充。
   * 仅在标题当前为空时填充，避免覆盖用户输入。
   */
  const fillDefaultTitle = useCallback(() => {
    setDraft((current) => {
      if (current.title.trim().length > 0) return current;
      return { ...current, title: generateDefaultSessionTitle() };
    });
  }, []);

  const setSource = useCallback((source: TeamSessionCreationSource) => {
    setDraft((current) => ({
      ...current,
      source,
    }));
  }, []);

  const applyTemplate = useCallback((template: WorkflowTemplateRecord) => {
    const teamTemplate = template.metadata?.teamTemplate;
    const rawBindings = teamTemplate?.defaultBindings ?? {};

    const requiredRoleBindings: Record<string, string> = { ...FIXED_TEAM_CORE_ROLE_BINDINGS };
    for (const [role, binding] of Object.entries(rawBindings) as Array<[string, unknown]>) {
      if (typeof binding === 'string' && binding.trim().length > 0) {
        requiredRoleBindings[role] = binding;
      } else if (
        typeof binding === 'object' &&
        binding !== null &&
        'agentId' in binding &&
        typeof (binding as { agentId: string }).agentId === 'string'
      ) {
        requiredRoleBindings[role] = (binding as { agentId: string }).agentId;
      }
    }

    const nextSource = {
      kind: 'saved-template' as const,
      templateId: template.id,
    };

    setDraft((current) => ({
      ...current,
      defaultProvider: teamTemplate?.defaultProvider ?? current.defaultProvider,
      // 模板自带 memberSlots（见 L1.2A 决策）则采用模板花名册作为默认成员，
      // 否则保留当前 draft 的 memberSlots（不让模板覆盖用户已经手动调整过的成员）。
      memberSlots:
        Array.isArray(teamTemplate?.memberSlots) && teamTemplate.memberSlots.length > 0
          ? teamTemplate.memberSlots.map((slot) => ({
              ...slot,
              toolsets: [...slot.toolsets],
            }))
          : current.memberSlots,
      optionalAgentIds: [...(teamTemplate?.optionalAgentIds ?? [])],
      requiredRoleBindings,
      source: nextSource,
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
    setDraft(createBlankTeamSessionDraft(options.teamWorkspaceId, options.defaultMemberSlots));
    setStep('source');
  }, [options.defaultMemberSlots, options.teamWorkspaceId]);

  return {
    canAdvance,
    canSubmit,
    currentStepIndex,
    draft,
    fieldErrors,
    fillDefaultTitle,
    generateDefaultSessionTitle,
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
