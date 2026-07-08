import type { ReactNode } from 'react';
import {
  FolderIcon,
  OverviewIcon,
  PlayIcon,
  PlusIcon,
  TemplateIcon,
} from '../../shared/TeamIcons.js';

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
  const workspaceText = workspaceLabel?.trim() || '尚未选择工作区';

  return (
    <section className="team-welcome-screen" aria-labelledby="team-welcome-title">
      <div className="team-welcome-screen__hero">
        <span className="team-welcome-screen__mark" aria-hidden="true">
          <OverviewIcon size={24} />
        </span>
        <div className="team-welcome-screen__copy">
          <span className="team-welcome-screen__workspace">{workspaceText}</span>
          <h2 id="team-welcome-title">团队工作空间已就绪</h2>
          <p>选择模板、确认工作目录，然后启动一棵可追踪的协作运行树。</p>
        </div>
      </div>

      <div className="team-welcome-screen__cards" aria-label="团队启动能力">
        {WELCOME_CARDS.map((card) => {
          const Icon = WELCOME_ICON_BY_KEY[card.icon];
          return (
            <article key={card.icon} className="team-welcome-screen__card">
              <span className="team-welcome-screen__card-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="team-welcome-screen__card-title">{card.title}</span>
              <span className="team-welcome-screen__card-description">{card.description}</span>
            </article>
          );
        })}
      </div>

      <div className="team-welcome-screen__actions" aria-label="团队会话操作">
        <button
          type="button"
          className="team-v2-control team-welcome-screen__primary"
          disabled={!sessionActionEnabled}
          onClick={sessionActionEnabled ? onNewSession : undefined}
        >
          <PlusIcon size={15} />
          <span>新建团队会话</span>
        </button>
        <button
          type="button"
          className="team-v2-control team-welcome-screen__secondary"
          disabled={!workspaceActionEnabled}
          onClick={workspaceActionEnabled ? onCreateWorkspace : undefined}
        >
          <FolderIcon size={15} />
          <span>{workspaceActionEnabled ? '新建工作区' : '工作区受限'}</span>
        </button>
      </div>

      <div className="team-welcome-screen__prompts" aria-label="团队启动建议">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="team-v2-control team-welcome-screen__prompt"
            disabled={!onSelectSuggestion}
            onClick={() => void onSelectSuggestion?.(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}
