import {
  HERO_BADGE_STYLE,
  HERO_DECOR_2_STYLE,
  HERO_DECOR_STYLE,
  HERO_DESC_STYLE,
  HERO_LIST_ICON_STYLE,
  HERO_LIST_ITEM_STYLE,
  HERO_LIST_STYLE,
  HERO_PANE_STYLE,
  HERO_TITLE_STYLE,
} from './new-team-workspace-modal-config.js';

const CHECK_ICON = (
  <svg
    aria-hidden="true"
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CHECKLIST = [
  { icon: CHECK_ICON, text: '隔离的 constitution 与角色绑定' },
  { icon: CHECK_ICON, text: '独立的会话与产物追踪' },
  { icon: CHECK_ICON, text: '默认工作目录加速派生流程' },
] as const;

export function NewTeamWorkspaceHero() {
  return (
    <div style={HERO_PANE_STYLE} aria-hidden="true">
      <div style={HERO_DECOR_STYLE} />
      <div style={HERO_DECOR_2_STYLE} />

      <div style={HERO_BADGE_STYLE}>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
        <span>Workspace</span>
      </div>

      <div style={HERO_TITLE_STYLE}>新建工作区</div>

      <div style={HERO_DESC_STYLE}>
        工作区是团队会话与产物的隔离单元，为不同项目或主题保留独立上下文，方便切换与回溯。
      </div>

      <div style={HERO_LIST_STYLE}>
        {CHECKLIST.map((item) => (
          <div key={item.text} style={HERO_LIST_ITEM_STYLE}>
            <span style={HERO_LIST_ICON_STYLE}>{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
