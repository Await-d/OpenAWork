/**
 * 260515-team-phase-c · T-08
 *
 * c 层三步向导 UI：Spec 草稿 → Clarifications → Plan 生成 → Tasks 拆解。
 * 状态机驱动，每步展示对应产物。
 */

import { type CSSProperties } from 'react';
import { ArtifactPreview } from './ArtifactPreview.js';

type WizardStep = 'spec_draft' | 'clarifying' | 'plan_ready' | 'tasks_ready';

const STEP_LABELS: Record<WizardStep, string> = {
  spec_draft: '① Spec 草稿',
  clarifying: '② 澄清中',
  plan_ready: '③ Plan 就绪',
  tasks_ready: '④ Tasks 就绪',
};

const STEP_ORDER: WizardStep[] = ['spec_draft', 'clarifying', 'plan_ready', 'tasks_ready'];

const WIZARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
};

const STEP_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const STEP_BUTTON_STYLE: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'center',
};

export interface ArtifactChainWizardProps {
  specContent: string | null;
  planContent: string | null;
  tasksContent: string | null;
  clarifications: Array<{ id: string; question: string }>;
  constitutionWarnings: Array<{ clause: string; status: string; note: string }>;
  /** 当前步骤（由外部状态驱动） */
  currentStep: WizardStep;
  onStepChange?: (step: WizardStep) => void;
}

export function ArtifactChainWizard({
  specContent,
  planContent,
  tasksContent,
  clarifications,
  constitutionWarnings,
  currentStep,
  onStepChange,
}: ArtifactChainWizardProps) {
  const activeIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <div style={WIZARD_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          c 层产物链
        </span>
        <strong style={{ fontSize: 14 }}>PM1 规划向导</strong>
      </header>

      <div style={STEP_BAR_STYLE}>
        {STEP_ORDER.map((step, i) => {
          const isActive = step === currentStep;
          const isPast = i < activeIndex;
          return (
            <button
              key={step}
              type="button"
              style={{
                ...STEP_BUTTON_STYLE,
                background: isActive
                  ? 'color-mix(in srgb, var(--accent) 16%, var(--surface))'
                  : isPast
                    ? 'color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 8%, var(--surface))'
                    : 'transparent',
                borderColor: isActive
                  ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                  : 'transparent',
                color: isActive
                  ? 'var(--text)'
                  : isPast
                    ? 'var(--success, var(--success, var(--success, #3dd49a)))'
                    : 'var(--text-3)',
              }}
              onClick={() => onStepChange?.(step)}
            >
              {STEP_LABELS[step]}
            </button>
          );
        })}
      </div>

      {currentStep === 'spec_draft' && specContent ? (
        <ArtifactPreview title="Spec 草稿" content={specContent} phase="spec" />
      ) : null}

      {currentStep === 'clarifying' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>待澄清项（{clarifications.length}）</strong>
          {clarifications.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              无待澄清项，可直接进入 Plan 生成。
            </span>
          ) : (
            clarifications.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--danger, #d4574e) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--danger, #d4574e) 6%, var(--surface))',
                  fontSize: 12,
                }}
              >
                ❓ {c.question}
              </div>
            ))
          )}
        </div>
      ) : null}

      {currentStep === 'plan_ready' && planContent ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <ArtifactPreview title="实施计划" content={planContent} phase="plan" />
          {constitutionWarnings.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 12 }}>宪法对齐检查</strong>
              {constitutionWarnings.map((w, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    border: `1px solid ${w.status === 'conflict' ? 'color-mix(in srgb, var(--danger, #d4574e) 40%, transparent)' : 'color-mix(in srgb, var(--warning, var(--warning, #f0b429)) 40%, transparent)'}`,
                    background:
                      w.status === 'conflict'
                        ? 'color-mix(in srgb, var(--danger, #d4574e) 6%, var(--surface))'
                        : 'color-mix(in srgb, var(--warning, var(--warning, #f0b429)) 6%, var(--surface))',
                  }}
                >
                  {w.status === 'conflict' ? '❌' : '⚠️'} {w.clause}：{w.note}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {currentStep === 'tasks_ready' && tasksContent ? (
        <ArtifactPreview title="任务清单" content={tasksContent} phase="tasks" />
      ) : null}

      {!specContent && !planContent && !tasksContent ? (
        <span style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>
          等待 PM1 生成产物链…创建 b→c handoff 后这里会逐步展示 spec / plan / tasks。
        </span>
      ) : null}
    </div>
  );
}
