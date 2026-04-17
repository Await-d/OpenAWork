import { useEffect, useMemo, useState } from 'react';
import { CompanionTerminalSprite } from '../../../components/chat/companion/companion-terminal-sprite.js';
import {
  createCompanionProfile,
  createHubbyProfile,
  type CompanionUtteranceSeed,
} from '../../../components/chat/companion/companion-display-model.js';

interface TeamRuntimeBuddyProps {
  activeAgentCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
  pendingQuestionCount: number;
  runningCount: number;
  sessionTitle: string | null;
  workspaceLabel: string;
  onApproveAll?: () => void;
  onReviewBlocked?: () => void;
  onAnswerQuestions?: () => void;
  onSpriteClick?: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setPrefersReducedMotion(false);
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);
    sync();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync);
      return () => mediaQuery.removeEventListener('change', sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  return prefersReducedMotion;
}

function buildBuddyOutput(
  input: Omit<TeamRuntimeBuddyProps, 'workspaceLabel'>,
): CompanionUtteranceSeed {
  if (input.pendingApprovalCount > 0) {
    return {
      badge: '待审批',
      text: `当前会话还有 ${input.pendingApprovalCount} 项待审批动作，需要人工介入。`,
      tone: 'notice',
    };
  }

  if (input.pendingQuestionCount > 0) {
    return {
      badge: '待回答',
      text: `有 ${input.pendingQuestionCount} 个问题卡在运行链上，适合优先处理。`,
      tone: 'notice',
    };
  }

  if (input.blockedCount > 0) {
    return {
      badge: '阻塞中',
      text: `团队侧当前有 ${input.blockedCount} 个受阻任务，建议先清障再继续推进。`,
      tone: 'notice',
    };
  }

  if (input.runningCount > 0) {
    return {
      badge: '运行中',
      text:
        input.sessionTitle != null
          ? `“${input.sessionTitle}”仍在继续运行，我会贴着状态变化轻声提醒。`
          : `当前共有 ${input.runningCount} 个共享运行在推进中。`,
      tone: 'active',
    };
  }

  if (input.activeAgentCount > 0) {
    return {
      badge: '协作就绪',
      text: `当前工作区可见 ${input.activeAgentCount} 个活跃协作主体，节奏已经建立。`,
      tone: 'ambient',
    };
  }

  return {
    badge: '安静陪跑',
    text: '当前没有高优先级动作，我会在右侧保持低打扰待命。',
    tone: 'ambient',
  };
}

export function TeamRuntimeBuddy({
  activeAgentCount,
  blockedCount,
  pendingApprovalCount,
  pendingQuestionCount,
  runningCount,
  sessionTitle,
  workspaceLabel,
  onApproveAll,
  onReviewBlocked,
  onAnswerQuestions,
  onSpriteClick,
}: TeamRuntimeBuddyProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const profile = useMemo(
    () => createHubbyProfile(`team-runtime:${workspaceLabel}`),
    [workspaceLabel],
  );
  const liveOutput = useMemo(
    () =>
      buildBuddyOutput({
        activeAgentCount,
        blockedCount,
        pendingApprovalCount,
        pendingQuestionCount,
        runningCount,
        sessionTitle,
      }),
    [
      activeAgentCount,
      blockedCount,
      pendingApprovalCount,
      pendingQuestionCount,
      runningCount,
      sessionTitle,
    ],
  );

  return (
    <section
      className="content-card"
      style={{
        display: 'grid',
        gap: 8,
        padding: 10,
        borderRadius: 16,
        background:
          'radial-gradient(circle at top right, rgba(91, 140, 255, 0.16), transparent 32%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 95%, rgba(15, 23, 42, 0.26)) 0%, var(--surface) 100%)',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            color: 'var(--accent)',
          }}
        >
          Buddy / Hubby
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.03em' }}>
          工作区动画代理
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
          消费聚合状态摘要，不复述明细。
        </span>
      </div>
      <div
        onClick={onSpriteClick}
        style={{
          cursor: onSpriteClick ? 'pointer' : 'default',
          borderRadius: 8,
          transition: 'box-shadow 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (onSpriteClick) e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <CompanionTerminalSprite
          fading={false}
          liveOutput={liveOutput}
          petNonce={pendingApprovalCount + pendingQuestionCount + blockedCount}
          prefersReducedMotion={prefersReducedMotion}
          profile={profile}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {[
          workspaceLabel,
          `${activeAgentCount} 个活跃主体`,
          `${runningCount} 个运行中`,
          `${pendingApprovalCount + pendingQuestionCount} 个待处理`,
        ].map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 7px',
              borderRadius: 999,
              border: '1px solid color-mix(in srgb, var(--border) 78%, transparent)',
              background: 'color-mix(in srgb, var(--surface) 88%, rgba(91, 140, 255, 0.08))',
              fontSize: 9.5,
              color: 'var(--text-2)',
            }}
          >
            {tag}
          </span>
        ))}
      </div>
      {(pendingApprovalCount > 0 || pendingQuestionCount > 0 || blockedCount > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {pendingApprovalCount > 0 && onApproveAll && (
            <button
              type="button"
              onClick={onApproveAll}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--success) 30%, transparent)',
                background: 'color-mix(in oklch, var(--success) 10%, var(--surface))',
                color: 'color-mix(in oklch, var(--success) 80%, white 20%)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
            >
              一键审批 ({pendingApprovalCount})
            </button>
          )}
          {pendingQuestionCount > 0 && onAnswerQuestions && (
            <button
              type="button"
              onClick={onAnswerQuestions}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--warning) 30%, transparent)',
                background: 'color-mix(in oklch, var(--warning) 10%, var(--surface))',
                color: 'color-mix(in oklch, var(--warning) 80%, white 20%)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
            >
              回答问题 ({pendingQuestionCount})
            </button>
          )}
          {blockedCount > 0 && onReviewBlocked && (
            <button
              type="button"
              onClick={onReviewBlocked}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
                background: 'color-mix(in oklch, var(--danger) 10%, var(--surface))',
                color: 'color-mix(in oklch, var(--danger) 80%, white 20%)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
            >
              查看阻塞 ({blockedCount})
            </button>
          )}
        </div>
      )}
    </section>
  );
}
