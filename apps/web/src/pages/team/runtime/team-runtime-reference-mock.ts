export type AgentTeamsTabKey =
  | 'conversation'
  | 'tasks'
  | 'messages'
  | 'overview'
  | 'review'
  | 'office';

export interface AgentTeamsSidebarTemplate {
  description: string;
  id: string;
  roleTags: Array<{ color: string; label: string }>;
  title: string;
}

export interface AgentTeamsSidebarSection {
  id: string;
  items: AgentTeamsSidebarTemplate[];
  title: string;
}

export interface AgentTeamsRoleChip {
  accent: string;
  badge: string;
  provider: string;
  role: string;
  status: string;
}

export interface AgentTeamsOfficeAgent {
  accent: string;
  crown?: boolean;
  extraNote?: string;
  id: string;
  label: string;
  note: string;
  selected?: boolean;
  x: number;
  y: number;
}

export interface AgentTeamsActivityItem {
  icon: string;
  id: string;
  label: string;
}

export interface AgentTeamsTabDefinition {
  badge?: string;
  id: AgentTeamsTabKey;
  icon: string;
  label: string;
}

export interface AgentTeamsMetricCard {
  label: string;
  value: string;
}

export interface AgentTeamsFooterStat {
  label: string;
  value: string;
}

export interface AgentTeamsPlaceholderCard {
  description: string;
  id: string;
  title: string;
}

export interface AgentTeamsConversationCard {
  body: string;
  id: string;
  meta: string;
  title: string;
}

export interface AgentTeamsTaskLane {
  cards: Array<{ id: string; owner: string; title: string }>;
  id: string;
  title: string;
}

export interface AgentTeamsMessageCard {
  from: string;
  id: string;
  summary: string;
  to: string;
}

export interface AgentTeamsOverviewCard {
  id: string;
  label: string;
  note: string;
  value: string;
}

export interface AgentTeamsReviewCard {
  id: string;
  priority: string;
  summary: string;
  title: string;
}

export const agentTeamsActivityItems: AgentTeamsActivityItem[] = [
  { id: 'dashboard', label: '统计', icon: '▥' },
  { id: 'teams', label: '团队', icon: '◫' },
  { id: 'nodes', label: '节点', icon: '⟟' },
  { id: 'chat', label: '消息', icon: '◌' },
  { id: 'paint', label: '画布', icon: '✦' },
  { id: 'history', label: '历史', icon: '◷' },
];

export const agentTeamsTabs: AgentTeamsTabDefinition[] = [
  { id: 'conversation', label: '对话', icon: '▣' },
  { id: 'tasks', label: '任务', icon: '◫', badge: '1' },
  { id: 'messages', label: '消息', icon: '◌' },
  { id: 'overview', label: '状态总览', icon: '⋈' },
  { id: 'review', label: '评审', icon: '◔' },
  { id: 'office', label: '办公室', icon: '▥' },
];

export const agentTeamsRoleChips: AgentTeamsRoleChip[] = [
  { accent: '#d59b11', badge: '团', role: '团队负责人', provider: 'Claude Code', status: 'Leader' },
  { accent: '#5b5bd8', badge: '研', role: '研究员A', provider: 'Codex CLI', status: '空闲' },
  { accent: '#c03d7a', badge: '研', role: '研究员B', provider: 'Codex CLI', status: '空闲' },
  { accent: '#d04e4e', badge: '批', role: '批评者', provider: 'Claude Code', status: '空闲' },
];

export const agentTeamsSidebarSections: AgentTeamsSidebarSection[] = [
  {
    id: 'dev-team',
    title: '开发团队',
    items: [
      {
        id: 'dev-team-template',
        title: '开发团队',
        description: '适合处理前后端联动、联调与缺陷收口。',
        roleTags: [
          { color: '#d59b11', label: '团队负责人' },
          { color: '#7c52ff', label: '架构师' },
          { color: '#378dff', label: '后端工程师' },
          { color: '#21c58d', label: '前端工程师' },
          { color: '#00b3ff', label: '测试工程师' },
        ],
      },
    ],
  },
  {
    id: 'research-team',
    title: '研究团队',
    items: [
      {
        id: 'research-team-template',
        title: '研究团队',
        description: '适合做多轮调研、资料汇总与批评性验证。',
        roleTags: [
          { color: '#d59b11', label: '团队负责人' },
          { color: '#5b5bd8', label: '研究员A' },
          { color: '#c03d7a', label: '研究员B' },
          { color: '#d04e4e', label: '批评者' },
        ],
      },
    ],
  },
  {
    id: 'learning-team-a',
    title: '短视频学习助手开...',
    items: [
      {
        id: 'learning-team-a-template',
        title: '短视频学习助手开...',
        description: '围绕短视频脚本、镜头、旁白与配音策划的轻量模板。',
        roleTags: [
          { color: '#378dff', label: '体验架构与合规策划' },
          { color: '#21c58d', label: '小程序前端研发' },
          { color: '#d59b11', label: '解析后端工程师' },
          { color: '#c03d7a', label: '项目与合规审查' },
        ],
      },
    ],
  },
  {
    id: 'learning-team-b',
    title: '短视频学习助手-新...',
    items: [
      {
        id: 'learning-team-b-template',
        title: '短视频学习助手-新...',
        description: '更偏新素材整合、学习任务拆分与测试链条。',
        roleTags: [
          { color: '#378dff', label: '体验策略负责人' },
          { color: '#21c58d', label: '小程序 UI/交互实现' },
          { color: '#d59b11', label: '解析与内容编排' },
          { color: '#c03d7a', label: '项目与合规测试' },
          { color: '#7c52ff', label: '交付协调与汇总' },
        ],
      },
    ],
  },
  {
    id: 'commerce-team',
    title: '轻量讲解有官网搭...',
    items: [
      {
        id: 'commerce-team-template',
        title: '轻量讲解有官网搭...',
        description: '为 10 人内小团队做官网与业务流展示的轻量模板。',
        roleTags: [
          { color: '#d59b11', label: '团队负责人' },
          { color: '#378dff', label: '产品策划' },
          { color: '#21c58d', label: '文案策划' },
          { color: '#c03d7a', label: '视觉设计' },
          { color: '#f59e0b', label: '前端开发' },
          { color: '#ef4444', label: '质审审查' },
        ],
      },
    ],
  },
];

export const agentTeamsMetricCards: AgentTeamsMetricCard[] = [
  { label: '成员', value: '4' },
  { label: '任务', value: '0/0' },
  { label: '汇报', value: '0' },
];

export const agentTeamsOfficeAgents: AgentTeamsOfficeAgent[] = [
  {
    id: 'leader',
    label: '[L] 团队负责人',
    note: '等待他的批准',
    x: 73,
    y: 59,
    accent: '#f4a52f',
    crown: true,
    selected: true,
  },
  {
    id: 'researcher-a',
    label: '研究员A',
    note: '等待他的批准',
    x: 80,
    y: 63,
    accent: '#6a6af7',
  },
  {
    id: 'critic',
    label: '批评者',
    note: '等待你的批准',
    extraNote: '等待你的决定',
    x: 85,
    y: 66,
    accent: '#ef5a5a',
  },
];

export const agentTeamsFooterStats: AgentTeamsFooterStat[] = [
  { label: '总', value: '135' },
  { label: '运行', value: '0' },
  { label: '等待', value: '3' },
  { label: '异常', value: '0' },
];

export const agentTeamsTabPanels: Record<
  Exclude<AgentTeamsTabKey, 'office'>,
  AgentTeamsPlaceholderCard[]
> = {
  conversation: [
    {
      id: 'conv-1',
      title: '团队对话流',
      description: '展示角色之间最近的结构化消息、工具使用和上下文引用。',
    },
    {
      id: 'conv-2',
      title: '最近提问',
      description: '将等待人工输入的问题和建议动作集中展示在一个静态 mock 面板中。',
    },
  ],
  tasks: [
    { id: 'task-1', title: '任务队列', description: '当前办公室视图对应的任务列表与负责人映射。' },
    { id: 'task-2', title: '子任务树', description: '显示每个角色拆出的下一层任务与阻塞关系。' },
  ],
  messages: [
    { id: 'msg-1', title: '团队消息总线', description: '模拟 TeamBus 的广播/单播信息流。' },
    { id: 'msg-2', title: '跨角色提醒', description: '展示批评者与研究员之间的审阅往返。' },
  ],
  overview: [
    {
      id: 'overview-1',
      title: '状态总览',
      description: '成员、任务、汇报、运行时间与模板状态的聚合摘要。',
    },
    {
      id: 'overview-2',
      title: '最近活跃',
      description: '模拟过去 30 分钟内的活跃事件与切换记录。',
    },
  ],
  review: [
    {
      id: 'review-1',
      title: '评审队列',
      description: '待审材料、待批注事项与当前高风险项的 mock 列表。',
    },
    {
      id: 'review-2',
      title: '结论草稿',
      description: '在页面优先阶段先展示 mock 评审卡，而不接入真实业务流。',
    },
  ],
};

export const agentTeamsConversationCards: AgentTeamsConversationCard[] = [
  {
    id: 'conversation-1',
    title: '团队对话流',
    meta: 'Claude Code · 研究团队-2026-03-31',
    body: '团队负责人刚刚要求批评者复查“办公室页 mock 是否已达官方截图的结构基线”。',
  },
  {
    id: 'conversation-2',
    title: '最近提问',
    meta: '研究员A · 等待输入',
    body: '是否继续把左侧模板块的图标、说明密度和模板节奏继续向官方页面压近？',
  },
];

export const agentTeamsTaskLanes: AgentTeamsTaskLane[] = [
  {
    id: 'todo',
    title: '待办',
    cards: [
      { id: 'todo-1', title: '补会议桌旁的墙面挂件', owner: '研究员A' },
      { id: 'todo-2', title: '对齐模板卡的行间距', owner: '研究员B' },
    ],
  },
  {
    id: 'doing',
    title: '进行中',
    cards: [
      { id: 'doing-1', title: '压办公室页画布层级', owner: '团队负责人' },
      { id: 'doing-2', title: '收敛顶部角色 chips', owner: '批评者' },
    ],
  },
  {
    id: 'review',
    title: '待评审',
    cards: [{ id: 'review-1', title: '评估截图还原度', owner: '批评者' }],
  },
];

export const agentTeamsMessageCards: AgentTeamsMessageCard[] = [
  {
    id: 'message-1',
    from: '团队负责人',
    to: '研究员A',
    summary: '请继续补足左侧模板栏的标签密度与换行节奏。',
  },
  {
    id: 'message-2',
    from: '研究员B',
    to: '批评者',
    summary: '请确认“办公室”页底部状态栏是否仍与官方 screenshot 一致。',
  },
  {
    id: 'message-3',
    from: '批评者',
    to: '团队负责人',
    summary: '当前建议继续对齐画布内人物标签层级和右侧窗/门比例。',
  },
];

export const agentTeamsOverviewCards: AgentTeamsOverviewCard[] = [
  {
    id: 'overview-card-1',
    label: '活跃角色',
    value: '4',
    note: '团队负责人 / 研究员A / 研究员B / 批评者',
  },
  { id: 'overview-card-2', label: '办公室任务', value: '3', note: '待办 2 · 评审 1' },
  {
    id: 'overview-card-3',
    label: '页面还原度',
    value: '持续收敛',
    note: '当前以 1111111.png 为唯一视觉基线',
  },
];

export const agentTeamsReviewCards: AgentTeamsReviewCard[] = [
  {
    id: 'review-card-1',
    title: '顶部团队条对齐度',
    priority: '高优先级',
    summary: '继续检查角色 chip 内部的间距、状态文案和 provider 辅助信息层级。',
  },
  {
    id: 'review-card-2',
    title: '办公室场景微对齐',
    priority: '中优先级',
    summary: '会议桌、主屏、门窗、植物和饮水机的位置还可继续像素级收敛。',
  },
];

export const agentTeamsTeamCard = {
  title: '研究团队-2026-03-31',
  status: '已暂停',
  subtitle: '4人 · 6天前',
};

export const agentTeamsTopSummary = {
  title: '研究团队-2026-03-31',
  status: '已暂停',
  memberCount: '4 成员',
  onlineCount: '4 在线',
  description:
    '抽象化展示当前激活团队/实例的协作状态。滚轮缩放，左键拖拽平移，节点会随状态自动切换到不同区域。',
};

export const agentTeamsCanvasSummary = '滚轮缩放 · 拖拽平移 60%';

export const agentTeamsFooterLead = '活跃 3 / 共 135';
