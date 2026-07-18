import type { ReactNode } from 'react';
import { BrandLogo } from '@openAwork/shared-ui';
import { FolderIcon, PlayIcon, PlusIcon, TemplateIcon } from '../../shared/TeamIcons.js';

export interface TeamWelcomeScreenProps {
  readonly canCreateSession?: boolean;
  readonly canCreateWorkspace?: boolean;
  readonly workspaceLabel?: string | null;
  readonly onCreateWorkspace?: () => void;
  readonly onNewSession?: () => void;
  readonly onSelectSuggestion?: (text: string) => void | Promise<void>;
}

type TeamWelcomeIcon = (props: { readonly color?: string; readonly size?: number }) => ReactNode;

const WELCOME_CARDS = [
  {
    description: '从内置模板或保存模板生成角色编排，不必从空白团队开始。',
    icon: 'template',
    title: '模板启动',
  },
  {
    description: '把任务限定在当前 workspace root，让文件、会话和产物保持同一上下文。',
    icon: 'workspace',
    title: '工作目录',
  },
  {
    description: '从对话进入任务、拓扑和评审视图，持续跟踪协作运行树。',
    icon: 'runtime',
    title: '运行追踪',
  },
] as const;

const WELCOME_ICON_BY_KEY: Record<(typeof WELCOME_CARDS)[number]['icon'], TeamWelcomeIcon> = {
  runtime: PlayIcon,
  template: TemplateIcon,
  workspace: FolderIcon,
};

const STARTER_PROMPTS = [
  '基于当前仓库制定一个交付计划',
  '用模板启动代码审查团队',
  '为这个工作目录补齐测试策略',
] as const;

const WELCOME_KEYFRAMES = `
@keyframes tws-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes tws-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes tws-glow-pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.08); }
}
@keyframes tws-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

export function TeamWelcomeScreen({
  canCreateSession,
  canCreateWorkspace,
  workspaceLabel,
  onCreateWorkspace,
  onNewSession,
  onSelectSuggestion,
}: TeamWelcomeScreenProps) {
  const sessionActionEnabled = (canCreateSession ?? Boolean(onNewSession)) && Boolean(onNewSession);
  const workspaceActionEnabled =
    (canCreateWorkspace ?? Boolean(onCreateWorkspace)) && Boolean(onCreateWorkspace);

  return (
    <section
      className="team-welcome-screen"
      aria-labelledby="team-welcome-title"
      style={{
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 24px 16px',
        gap: 20,
        maxWidth: 860,
        width: '100%',
      }}
    >
      <style>{WELCOME_KEYFRAMES}</style>

      {/* Hero */}
      <div
        style={{
          textAlign: 'center',
          animation: 'tws-fade-up .5s ease both',
        }}
      >
        {/* Glow background */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)',
            animation: 'tws-glow-pulse 4s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        {/* Logo mark */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            marginBottom: 12,
            boxShadow: '0 4px 24px color-mix(in srgb, var(--accent) 28%, transparent)',
            animation: 'tws-float 3s ease-in-out infinite',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <BrandLogo size={44} />
        </div>
        <h2
          id="team-welcome-title"
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--fg-strong)',
            letterSpacing: '-0.03em',
          }}
        >
          团队工作空间已就绪
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 13,
            color: 'var(--fg-muted)',
            lineHeight: 1.6,
            maxWidth: 440,
          }}
        >
          选择模板、确认工作目录，然后启动一棵可追踪的协作运行树。
        </p>
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center',
          animation: 'tws-fade-up .5s ease .1s both',
        }}
      >
        <button
          type="button"
          disabled={!sessionActionEnabled}
          onClick={sessionActionEnabled ? onNewSession : undefined}
          onMouseEnter={(e) => {
            if (sessionActionEnabled)
              e.currentTarget.style.background =
                'color-mix(in srgb, var(--accent) 88%, var(--fg-strong))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 38,
            padding: '0 18px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--fg-strong) 12%, transparent)',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 13,
            fontWeight: 700,
            cursor: sessionActionEnabled ? 'pointer' : 'not-allowed',
            opacity: sessionActionEnabled ? 1 : 0.45,
            boxShadow: '0 0 16px -4px color-mix(in srgb, var(--accent) 25%, transparent)',
            transition: 'background 120ms ease',
          }}
        >
          <PlusIcon size={14} color="var(--fg-on-accent)" />
          <span>新建团队会话</span>
        </button>
        {workspaceActionEnabled ? (
          <button
            type="button"
            onClick={onCreateWorkspace}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent-subtle)';
              e.currentTarget.style.borderColor = 'var(--accent-border)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-surface)';
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.color = 'var(--fg-default)';
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              padding: '0 18px',
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
            }}
          >
            <FolderIcon size={14} color="currentColor" />
            <span>{workspaceLabel ? '新建并切换工作区' : '新建工作区'}</span>
          </button>
        ) : null}
      </div>

      {/* Feature cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
          width: '100%',
          animation: 'tws-fade-up .5s ease .2s both',
        }}
      >
        {WELCOME_CARDS.map((card) => {
          const Icon = WELCOME_ICON_BY_KEY[card.icon];
          return (
            <div
              key={card.icon}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '14px 13px',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
                background:
                  'linear-gradient(135deg, var(--bg-surface), color-mix(in srgb, var(--bg-overlay) 50%, var(--bg-base)))',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid var(--accent-border)',
                  background: 'var(--accent-subtle)',
                  color: 'var(--accent)',
                }}
              >
                <Icon size={15} color="var(--accent)" />
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--fg-strong)',
                }}
              >
                {card.title}
              </span>
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.55,
                  color: 'var(--fg-muted)',
                }}
              >
                {card.description}
              </span>
            </div>
          );
        })}
      </div>

      {/* Starter prompts */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 8,
          animation: 'tws-fade-up .5s ease .3s both',
        }}
      >
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={!onSelectSuggestion}
            onClick={() => void onSelectSuggestion?.(prompt)}
            onMouseEnter={(e) => {
              if (onSelectSuggestion) e.currentTarget.style.background = 'var(--accent-subtle)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 30,
              padding: '0 12px',
              borderRadius: 999,
              border: '1px solid var(--accent-border)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 500,
              cursor: onSelectSuggestion ? 'pointer' : 'not-allowed',
              opacity: onSelectSuggestion ? 1 : 0.45,
              transition: 'background 120ms ease',
            }}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}
