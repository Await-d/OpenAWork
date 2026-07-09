interface ResourcesCommandBarProps {
  readonly catalogCount: number;
  readonly featureCount: number;
  readonly channelPersonaCount: number;
  readonly userCount: number;
  readonly loading: boolean;
  readonly onReload: () => void;
}

export function ResourcesCommandBar({
  catalogCount,
  featureCount,
  channelPersonaCount,
  userCount,
  loading,
  onReload,
}: ResourcesCommandBarProps) {
  return (
    <section className="resources-command-bar">
      <div className="resources-title-block">
        <p className="resources-eyebrow">资源中心</p>
        <h1 id="resources-title">按用途管理 Agent、Skill、MCP 与功能资源</h1>
        <p>
          通用目录只展示可浏览、可安装或可接入的资源；通道人设、团队模板、命令模板和运行提示词进入功能专用区。
        </p>
      </div>
      <div className="resources-quick-stats" aria-label="资源统计">
        <div>
          <span>主目录</span>
          <strong>{catalogCount}</strong>
        </div>
        <div>
          <span>功能专用</span>
          <strong>{featureCount}</strong>
        </div>
        <div>
          <span>通道人设</span>
          <strong>{channelPersonaCount}</strong>
        </div>
        <div>
          <span>上传</span>
          <strong>{userCount}</strong>
        </div>
      </div>
      <button
        type="button"
        className="resources-ghost-button"
        onClick={onReload}
        disabled={loading}
      >
        刷新目录
      </button>
    </section>
  );
}
