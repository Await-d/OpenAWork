export interface TitlebarNewSessionButtonProps {
  readonly onClick: () => void;
}

export interface TitlebarNewTeamButtonProps {
  readonly compact: boolean;
  readonly stacked: boolean;
  readonly onClick: () => void;
}

export function TitlebarNewSessionButton({ onClick }: TitlebarNewSessionButtonProps) {
  return (
    <button
      type="button"
      title="新建会话 (Ctrl+T)"
      aria-label="新建会话"
      className="titlebar-tab-strip__new-session-button"
      onClick={onClick}
    >
      +
    </button>
  );
}

export function TitlebarNewTeamButton({ compact, onClick, stacked }: TitlebarNewTeamButtonProps) {
  return (
    <button
      type="button"
      title="新建团队工作区"
      className="titlebar-tab-strip__new-team-button"
      data-stacked={stacked || undefined}
      onClick={onClick}
    >
      {compact ? '新建' : '新建团队'}
    </button>
  );
}
