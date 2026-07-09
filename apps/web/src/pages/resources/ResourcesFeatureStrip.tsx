export function ResourcesFeatureStrip() {
  return (
    <section className="resources-feature-strip" aria-label="功能专用资源说明">
      <div>
        <span>Channels</span>
        <strong>通道个人角色设定</strong>
        <p>对应资源包中的 souls 角色设定，后续用于每个消息通道或个人会话的 persona 选择。</p>
      </div>
      <div>
        <span>Team</span>
        <strong>AGENTS / MEMORY / SOUL / USER</strong>
        <p>作为工作区记忆与团队模板，不作为普通 Skill 或 Agent 执行。</p>
      </div>
      <div>
        <span>Commands</span>
        <strong>参考命令模板</strong>
        <p>系统已有能力优先使用内置入口，参考命令只放在对应功能区，不自动执行。</p>
      </div>
      <div>
        <span>Prompts</span>
        <strong>上下文材料</strong>
        <p>运行提示词只作为材料保存，必须由具体功能显式选择后才会注入。</p>
      </div>
    </section>
  );
}
