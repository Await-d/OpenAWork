export type AgentTeamsTabKey =
  | 'conversation'
  | 'tasks'
  | 'messages'
  | 'overview'
  | 'review'
  | 'teams'
  | 'office';

export interface AgentTeamsSidebarTemplate {
  description: string;
  id: string;
  roleTagRows: Array<Array<{ color: string; label: string }>>;
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
  id: string;
  leader?: boolean;
  provider: string;
  role: string;
  status: string;
}

export type AgentOfficeStatus = 'working' | 'resting' | 'discussing';

export interface AgentTeamsOfficeAgent {
  accent: string;
  crown?: boolean;
  extraNote?: string;
  id: string;
  label: string;
  note: string;
  selected?: boolean;
  status: AgentOfficeStatus;
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
  icon: string;
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
  agentId?: string;
  body: string;
  id: string;
  meta: string;
  role: string;
  roleAccent: string;
  timestamp: string;
  title: string;
  type: 'broadcast' | 'direct' | 'question' | 'result';
}

export interface AgentTeamsTaskCard {
  assignee: string;
  assigneeAccent: string;
  description: string;
  id: string;
  mutable?: boolean;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
  title: string;
}

export interface AgentTeamsTaskLane {
  cards: AgentTeamsTaskCard[];
  id: string;
  title: string;
}

export interface AgentTeamsMessageCard {
  from: string;
  fromAccent: string;
  id: string;
  route: 'broadcast' | 'unicast';
  summary: string;
  timestamp: string;
  to: string;
  toAccent: string;
  type: 'update' | 'question' | 'result' | 'error';
}

export interface AgentTeamsOverviewCard {
  icon: string;
  id: string;
  label: string;
  note: string;
  trend?: 'up' | 'down' | 'stable';
  value: string;
}

export interface AgentTeamsReviewCard {
  actionable?: boolean;
  assignee: string;
  assigneeAccent: string;
  id: string;
  priority: 'high' | 'medium' | 'low';
  requestId?: string;
  reviewKind?: 'audit' | 'permission' | 'question';
  sessionId?: string;
  status: 'pending' | 'approved' | 'rejected';
  summary: string;
  title: string;
  type: 'code' | 'design' | 'content' | 'security';
}

export const agentTeamsActivityItems: AgentTeamsActivityItem[] = [
  { id: 'dashboard', label: '统计', icon: 'overview' },
  { id: 'teams', label: '团队', icon: 'teams' },
  { id: 'nodes', label: '节点', icon: 'members' },
  { id: 'chat', label: '消息', icon: 'messages' },
  { id: 'paint', label: '画布', icon: 'design' },
  { id: 'history', label: '历史', icon: 'timer' },
];

export const agentTeamsTabs: AgentTeamsTabDefinition[] = [
  { id: 'office', label: '办公室', icon: 'office' },
  { id: 'overview', label: '状态总览', icon: 'overview' },
  { id: 'conversation', label: '对话', icon: 'conversation' },
  { id: 'tasks', label: '任务', icon: 'tasks', badge: '1' },
  { id: 'messages', label: '消息', icon: 'messages' },
  { id: 'review', label: '评审', icon: 'review' },
  { id: 'teams', label: '团队', icon: 'teams' },
];

export const agentTeamsRoleChips: AgentTeamsRoleChip[] = [
  {
    accent: '#d59b11',
    badge: '团',
    id: 'leader',
    role: '团队负责人',
    provider: 'Claude Code',
    status: '空闲',
    leader: true,
  },
  {
    accent: '#5b5bd8',
    badge: '研',
    id: 'researcher-a',
    role: '研究员A',
    provider: 'Codex CLI',
    status: '空闲',
  },
  {
    accent: '#c03d7a',
    badge: '研',
    id: 'researcher-b',
    role: '研究员B',
    provider: 'Codex CLI',
    status: '空闲',
  },
  {
    accent: '#d04e4e',
    badge: '批',
    id: 'critic',
    role: '批评者',
    provider: 'Claude Code',
    status: '空闲',
  },
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
        roleTagRows: [
          [
            { color: '#d59b11', label: '团队负责人' },
            { color: '#7c52ff', label: '架构师' },
            { color: '#378dff', label: '后端工程师' },
          ],
          [
            { color: '#21c58d', label: '前端工程师' },
            { color: '#00b3ff', label: '测试工程师' },
          ],
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
        roleTagRows: [
          [
            { color: '#d59b11', label: '团队负责人' },
            { color: '#5b5bd8', label: '研究员A' },
            { color: '#c03d7a', label: '研究员B' },
            { color: '#d04e4e', label: '批评者' },
          ],
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
        roleTagRows: [
          [
            { color: '#378dff', label: '体验架构与合规策划' },
            { color: '#21c58d', label: '小程序前端研发' },
          ],
          [
            { color: '#d59b11', label: '解析后端工程师' },
            { color: '#c03d7a', label: '项目与合规审查' },
          ],
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
        roleTagRows: [
          [
            { color: '#378dff', label: '体验策略负责人' },
            { color: '#21c58d', label: '小程序 UI/交互实现' },
          ],
          [
            { color: '#d59b11', label: '解析与内容编排' },
            { color: '#c03d7a', label: '项目与合规测试' },
          ],
          [{ color: '#7c52ff', label: '交付协调与汇总' }],
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
        roleTagRows: [
          [
            { color: '#d59b11', label: '团队负责人' },
            { color: '#378dff', label: '产品策划' },
            { color: '#21c58d', label: '文案策划' },
          ],
          [
            { color: '#c03d7a', label: '视觉设计' },
            { color: '#f59e0b', label: '前端开发' },
            { color: '#ef4444', label: '质审审查' },
          ],
        ],
      },
    ],
  },
];

export const agentTeamsMetricCards: AgentTeamsMetricCard[] = [
  { icon: 'members', label: '成员', value: '4' },
  { icon: 'tasks', label: '任务', value: '0/0' },
  { icon: 'conversation', label: '汇报', value: '0' },
];

export const agentTeamsOfficeAgents: AgentTeamsOfficeAgent[] = [
  {
    id: 'leader',
    label: '[L] 团队负责人',
    note: '等待他的批准',
    status: 'resting',
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
    status: 'resting',
    x: 80,
    y: 63,
    accent: '#6a6af7',
  },
  {
    id: 'critic',
    label: '批评者',
    note: '等待你的批准',
    extraNote: '等待你的决定',
    status: 'resting',
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
  teams: [
    { id: 'teams-1', title: '运行中团队', description: '当前正在运行的团队实例列表。' },
    { id: 'teams-2', title: '历史团队', description: '已完成或暂停的历史团队记录。' },
    { id: 'teams-3', title: '团队模板', description: '可复用的团队角色组合模板。' },
  ],
};

export const agentTeamsConversationCards: AgentTeamsConversationCard[] = [
  {
    agentId: 'leader',
    id: 'conversation-1',
    title: '复查办公室页基线对齐',
    meta: 'Claude Code · 研究团队-2026-03-31',
    role: '团队负责人',
    roleAccent: '#d59b11',
    timestamp: '14:32',
    type: 'broadcast',
    body: '团队负责人刚刚要求批评者复查"办公室页 mock 是否已达官方截图的结构基线"，并同步研究员A继续推进模板密度。',
  },
  {
    agentId: 'researcher-a',
    id: 'conversation-2',
    title: '模板节奏是否继续压近？',
    meta: 'Codex CLI · 等待输入',
    role: '研究员A',
    roleAccent: '#5b5bd8',
    timestamp: '14:28',
    type: 'question',
    body: '是否继续把左侧模板块的图标、说明密度和模板节奏继续向官方页面压近？当前标签行已经从 1 行增加到 2 行。',
  },
  {
    agentId: 'researcher-b',
    id: 'conversation-3',
    title: '画布层级收敛报告',
    meta: 'Codex CLI · 已完成',
    role: '研究员B',
    roleAccent: '#c03d7a',
    timestamp: '14:15',
    type: 'result',
    body: '已完成画布内会议桌、主屏、门窗、植物和饮水机的位置收敛，当前偏移 < 3px。建议下一步处理顶部角色 chips 的间距。',
  },
  {
    agentId: 'critic',
    id: 'conversation-4',
    title: '角色 chips 间距微调建议',
    meta: 'Claude Code · 审阅中',
    role: '批评者',
    roleAccent: '#d04e4e',
    timestamp: '14:08',
    type: 'direct',
    body: '当前建议继续对齐画布内人物标签层级和右侧窗/门比例。角色 chips 的内部间距建议从 14px 收敛到 10px，provider 辅助信息字号从 11px 降到 10px。',
  },
  {
    agentId: 'researcher-b',
    id: 'conversation-5',
    title: '底部状态栏还原度确认',
    meta: 'Codex CLI · 已回复',
    role: '研究员B',
    roleAccent: '#c03d7a',
    timestamp: '13:55',
    type: 'question',
    body: '请确认"办公室"页底部状态栏是否仍与官方 screenshot 一致。我对比发现 footer stat 的字号和间距有 2px 偏移。',
  },
];

export const agentTeamsTaskLanes: AgentTeamsTaskLane[] = [
  {
    id: 'todo',
    title: '待办',
    cards: [
      {
        id: 'todo-1',
        title: '补会议桌旁的墙面挂件',
        assignee: '研究员A',
        assigneeAccent: '#5b5bd8',
        description: '在办公室画布中补充会议桌右侧的装饰性挂件元素',
        priority: 'low',
        tags: ['画布', 'UI'],
      },
      {
        id: 'todo-2',
        title: '对齐模板卡的行间距',
        assignee: '研究员B',
        assigneeAccent: '#c03d7a',
        description: '将侧边栏模板卡片的行间距从 16px 统一为 12px',
        priority: 'medium',
        tags: ['侧边栏', '间距'],
      },
      {
        id: 'todo-3',
        title: '添加新建团队模板弹窗',
        assignee: '团队负责人',
        assigneeAccent: '#d59b11',
        description: '实现"＋ 新建团队模板"按钮的弹窗交互，含角色选择和 Provider 配置',
        priority: 'high',
        tags: ['模板', '交互'],
      },
      {
        id: 'todo-4',
        title: '继续补足左侧模板栏的标签密度与换行节奏',
        assignee: '研究员A',
        assigneeAccent: '#5b5bd8',
        description: '继续推进模板密度，当前第二行标签已接近目标',
        priority: 'high',
        tags: ['模板', '密度'],
      },
      {
        id: 'todo-5',
        title: '检查角色 chips 的 provider 辅助信息字号',
        assignee: '批评者',
        assigneeAccent: '#d04e4e',
        description: '检查角色 chips 的 provider 辅助信息字号是否偏大，建议从 11px 降到 10px',
        priority: 'medium',
        tags: ['角色', '字号'],
      },
    ],
  },
  {
    id: 'doing',
    title: '进行中',
    cards: [
      {
        id: 'doing-1',
        title: '压办公室页画布层级',
        assignee: '团队负责人',
        assigneeAccent: '#d59b11',
        description: '收敛画布内各层级元素的 z-index 和定位偏移',
        priority: 'high',
        tags: ['画布', '层级'],
      },
      {
        id: 'doing-2',
        title: '收敛顶部角色 chips',
        assignee: '批评者',
        assigneeAccent: '#d04e4e',
        description: '调整角色芯片的内部间距、状态文案和 provider 辅助信息层级',
        priority: 'medium',
        tags: ['角色', '间距'],
      },
      {
        id: 'doing-3',
        title: '继续对齐画布内人物标签层级和右侧窗/门比例',
        assignee: '研究员B',
        assigneeAccent: '#c03d7a',
        description: '继续对齐画布内人物标签层级和右侧窗/门比例，当前偏移 < 3px',
        priority: 'high',
        tags: ['画布', '层级'],
      },
    ],
  },
  {
    id: 'review',
    title: '待评审',
    cards: [
      {
        id: 'review-1',
        title: '评估截图还原度',
        assignee: '批评者',
        assigneeAccent: '#d04e4e',
        description: '对比当前页面与官方截图的像素级差异，输出还原度评分',
        priority: 'high',
        tags: ['评审', '还原度'],
      },
      {
        id: 'review-2',
        title: '底部状态栏偏移修复',
        assignee: '研究员B',
        assigneeAccent: '#c03d7a',
        description: '修复 footer stat 字号和间距的 2px 偏移',
        priority: 'low',
        tags: ['底部栏', '间距'],
      },
      {
        id: 'review-3',
        title: '检查角色 chips 的内部间距',
        assignee: '批评者',
        assigneeAccent: '#d04e4e',
        description: '检查角色 chips 的内部间距是否偏大，建议从 14px 收敛到 10px',
        priority: 'medium',
        tags: ['角色', '间距'],
      },
    ],
  },
];

export const agentTeamsMessageCards: AgentTeamsMessageCard[] = [
  {
    id: 'message-1',
    from: '团队负责人',
    fromAccent: '#d59b11',
    to: '研究员A',
    toAccent: '#5b5bd8',
    route: 'unicast',
    type: 'update',
    timestamp: '14:32',
    summary: '请继续补足左侧模板栏的标签密度与换行节奏，当前第二行标签已接近目标。',
  },
  {
    id: 'message-2',
    from: '团队负责人',
    fromAccent: '#d59b11',
    to: '全体成员',
    toAccent: '#7c52ff',
    route: 'broadcast',
    type: 'update',
    timestamp: '14:30',
    summary: '所有成员请注意：画布层级收敛已完成，请各自检查负责区域的偏移情况。',
  },
  {
    id: 'message-3',
    from: '研究员B',
    fromAccent: '#c03d7a',
    to: '批评者',
    toAccent: '#d04e4e',
    route: 'unicast',
    type: 'question',
    timestamp: '14:25',
    summary: '请确认"办公室"页底部状态栏是否仍与官方 screenshot 一致，我发现 2px 偏移。',
  },
  {
    id: 'message-4',
    from: '批评者',
    fromAccent: '#d04e4e',
    to: '团队负责人',
    toAccent: '#d59b11',
    route: 'unicast',
    type: 'result',
    timestamp: '14:18',
    summary: '当前建议继续对齐画布内人物标签层级和右侧窗/门比例，还原度约 92%。',
  },
  {
    id: 'message-5',
    from: '研究员A',
    fromAccent: '#5b5bd8',
    to: '团队负责人',
    toAccent: '#d59b11',
    route: 'unicast',
    type: 'question',
    timestamp: '14:10',
    summary: '模板标签密度是否需要从 2 行扩展到 3 行？当前 2 行已覆盖主要角色。',
  },
  {
    id: 'message-6',
    from: '批评者',
    fromAccent: '#d04e4e',
    to: '全体成员',
    toAccent: '#7c52ff',
    route: 'broadcast',
    type: 'error',
    timestamp: '13:55',
    summary: '警告：角色 chips 的 provider 辅助信息字号偏大，建议从 11px 降到 10px。',
  },
];

export const agentTeamsOverviewCards: AgentTeamsOverviewCard[] = [
  {
    id: 'overview-card-1',
    icon: 'members',
    label: '活跃角色',
    value: '4',
    trend: 'stable',
    note: '团队负责人 / 研究员A / 研究员B / 批评者',
  },
  {
    id: 'overview-card-2',
    icon: 'tasks',
    label: '办公室任务',
    value: '7',
    trend: 'up',
    note: '待办 3 · 进行中 2 · 评审 2',
  },
  {
    id: 'overview-card-3',
    icon: 'overview',
    label: '页面还原度',
    value: '92%',
    trend: 'up',
    note: '当前以 1111111.png 为唯一视觉基线',
  },
  {
    id: 'overview-card-4',
    icon: 'sync',
    label: 'TeamBus 消息',
    value: '6',
    trend: 'up',
    note: '广播 2 · 单播 4 · 待回复 2',
  },
  {
    id: 'overview-card-5',
    icon: 'review',
    label: '评审队列',
    value: '2',
    trend: 'stable',
    note: '高优先级 1 · 中优先级 0 · 低优先级 1',
  },
  {
    id: 'overview-card-6',
    icon: 'timer',
    label: '运行时长',
    value: '16m 41s',
    trend: 'stable',
    note: '自 14:00 启动以来，无异常中断',
  },
];

export const agentTeamsReviewCards: AgentTeamsReviewCard[] = [
  {
    id: 'review-card-1',
    title: '顶部团队条对齐度',
    priority: 'high',
    status: 'pending',
    type: 'design',
    assignee: '批评者',
    assigneeAccent: '#d04e4e',
    summary: '继续检查角色 chip 内部的间距、状态文案和 provider 辅助信息层级。当前偏移约 2px。',
  },
  {
    id: 'review-card-2',
    title: '办公室场景微对齐',
    priority: 'medium',
    status: 'pending',
    type: 'design',
    assignee: '研究员B',
    assigneeAccent: '#c03d7a',
    summary: '会议桌、主屏、门窗、植物和饮水机的位置还可继续像素级收敛，当前还原度约 92%。',
  },
  {
    id: 'review-card-3',
    title: '底部状态栏偏移修复',
    priority: 'low',
    status: 'approved',
    type: 'code',
    assignee: '研究员B',
    assigneeAccent: '#c03d7a',
    summary: 'footer stat 字号和间距的 2px 偏移已修复，已通过视觉对比确认。',
  },
  {
    id: 'review-card-4',
    title: '模板标签密度扩展',
    priority: 'high',
    status: 'pending',
    type: 'content',
    assignee: '研究员A',
    assigneeAccent: '#5b5bd8',
    summary: '评估是否将模板标签从 2 行扩展到 3 行，需确认是否影响侧边栏高度和滚动体验。',
  },
  {
    id: 'review-card-5',
    title: '角色 chips 安全性检查',
    priority: 'medium',
    status: 'rejected',
    type: 'security',
    assignee: '批评者',
    assigneeAccent: '#d04e4e',
    summary: '角色 chips 的 provider 辅助信息字号偏大（11px），建议降到 10px 以避免信息溢出。',
  },
];

export interface AgentTeamsSidebarTeam {
  id: string;
  title: string;
  subtitle: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
}

export interface AgentTeamsWorkspaceGroup {
  workspaceLabel: string;
  workspacePath: string | null;
  sessions: AgentTeamsSidebarTeam[];
}

export const agentTeamsWorkspaceGroups: AgentTeamsWorkspaceGroup[] = [
  {
    workspaceLabel: 'OpenAWork',
    workspacePath: '/home/await/project/OpenAWork',
    sessions: [
      {
        id: 'team-research',
        title: '研究团队-2026-03-31',
        subtitle: '4人 · 运行中',
        status: 'running',
      },
      { id: 'team-dev', title: '开发团队-2026-04-01', subtitle: '5人 · 运行中', status: 'running' },
    ],
  },
  {
    workspaceLabel: 'windsurf_openai_api',
    workspacePath: '/home/await/project/windsurf_openai_api',
    sessions: [
      { id: 'team-api-ops', title: 'API运维巡检团队', subtitle: '3人 · 运行中', status: 'running' },
    ],
  },
  {
    workspaceLabel: '未绑定工作区',
    workspacePath: null,
    sessions: [
      {
        id: 'team-learning-a',
        title: '短视频学习助手开...',
        subtitle: '4人 · 3天前',
        status: 'completed',
      },
      {
        id: 'team-commerce',
        title: '轻量讲解有官网搭...',
        subtitle: '6人 · 5天前',
        status: 'completed',
      },
      {
        id: 'team-learning-b',
        title: '短视频学习助手-新...',
        subtitle: '5人 · 1周前',
        status: 'completed',
      },
    ],
  },
];

export const agentTeamsRunningTeams: AgentTeamsSidebarTeam[] = [
  {
    id: 'team-research',
    title: '研究团队-2026-03-31',
    subtitle: '4人 · 运行中',
    status: 'running',
  },
  { id: 'team-dev', title: '开发团队-2026-04-01', subtitle: '5人 · 运行中', status: 'running' },
];

export const agentTeamsHistoryTeams: AgentTeamsSidebarTeam[] = [
  {
    id: 'team-learning-a',
    title: '短视频学习助手开...',
    subtitle: '4人 · 3天前',
    status: 'completed',
  },
  {
    id: 'team-commerce',
    title: '轻量讲解有官网搭...',
    subtitle: '6人 · 5天前',
    status: 'completed',
  },
  {
    id: 'team-learning-b',
    title: '短视频学习助手-新...',
    subtitle: '5人 · 1周前',
    status: 'completed',
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

export const agentTeamsNewTemplateRoles = [
  { value: 'leader', label: '团队负责人', color: '#d59b11' },
  { value: 'researcher', label: '研究员', color: '#5b5bd8' },
  { value: 'critic', label: '批评者', color: '#d04e4e' },
  { value: 'architect', label: '架构师', color: '#7c52ff' },
  { value: 'backend', label: '后端工程师', color: '#378dff' },
  { value: 'frontend', label: '前端工程师', color: '#21c58d' },
  { value: 'tester', label: '测试工程师', color: '#00b3ff' },
];

export const agentTeamsNewTemplateProviders = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
  { value: 'iflow', label: 'iFlow' },
];

export type AgentTeamsTimelineEventType =
  | 'session_start'
  | 'thinking'
  | 'file_read'
  | 'file_write'
  | 'file_create'
  | 'command_execute'
  | 'tool_use'
  | 'error'
  | 'waiting_confirmation'
  | 'user_input'
  | 'turn_complete'
  | 'task_complete'
  | 'assistant_message';

export interface AgentTeamsTimelineEvent {
  id: string;
  type: AgentTeamsTimelineEventType;
  detail: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  agentAccent: string;
}

export const AGENT_TEAMS_EVENT_CONFIG: Record<
  AgentTeamsTimelineEventType,
  { color: string; label: string; icon: string }
> = {
  session_start: { color: '#3FB950', label: '启动', icon: 'play' },
  thinking: { color: '#BC8CFF', label: '思考', icon: 'thinking' },
  file_read: { color: '#58A6FF', label: '读取', icon: 'file-read' },
  file_write: { color: '#D2A8FF', label: '写入', icon: 'file-write' },
  file_create: { color: '#D2A8FF', label: '创建', icon: 'file-create' },
  command_execute: { color: '#D29922', label: '命令', icon: 'command' },
  tool_use: { color: '#58A6FF', label: '工具', icon: 'tool' },
  error: { color: '#F85149', label: '错误', icon: 'error' },
  waiting_confirmation: { color: '#D29922', label: '确认', icon: 'confirm' },
  user_input: { color: '#3FB950', label: '输入', icon: 'input' },
  turn_complete: { color: '#58A6FF', label: '回合完成', icon: 'turn-complete' },
  task_complete: { color: '#3FB950', label: '完成', icon: 'task-complete' },
  assistant_message: { color: '#79C0FF', label: '回复', icon: 'reply' },
};

export const agentTeamsTimelineEvents: AgentTeamsTimelineEvent[] = [
  {
    id: 'evt-1',
    type: 'session_start',
    detail: '研究团队-2026-03-31 启动',
    timestamp: '2026-03-31T14:00:00',
    agentId: 'leader',
    agentName: '团队负责人',
    agentAccent: '#d59b11',
  },
  {
    id: 'evt-2',
    type: 'thinking',
    detail: '分析用户需求文档，提取关键约束条件',
    timestamp: '2026-03-31T14:01:12',
    agentId: 'researcher-a',
    agentName: '研究员A',
    agentAccent: '#5b5bd8',
  },
  {
    id: 'evt-3',
    type: 'file_read',
    detail: '读取 src/config/default.ts',
    timestamp: '2026-03-31T14:02:30',
    agentId: 'researcher-a',
    agentName: '研究员A',
    agentAccent: '#5b5bd8',
  },
  {
    id: 'evt-4',
    type: 'file_write',
    detail: '修改 src/api/handlers.ts - 新增错误处理中间件',
    timestamp: '2026-03-31T14:05:45',
    agentId: 'backend',
    agentName: '后端工程师',
    agentAccent: '#378dff',
  },
  {
    id: 'evt-5',
    type: 'command_execute',
    detail: 'npm run test -- --watchAll=false',
    timestamp: '2026-03-31T14:08:00',
    agentId: 'tester',
    agentName: '测试工程师',
    agentAccent: '#00b3ff',
  },
  {
    id: 'evt-6',
    type: 'tool_use',
    detail: '调用 WebSearch 搜索 "Express.js error handling best practices"',
    timestamp: '2026-03-31T14:10:15',
    agentId: 'researcher-a',
    agentName: '研究员A',
    agentAccent: '#5b5bd8',
  },
  {
    id: 'evt-7',
    type: 'assistant_message',
    detail: '已完成需求分析，建议采用分层错误处理架构',
    timestamp: '2026-03-31T14:12:00',
    agentId: 'researcher-a',
    agentName: '研究员A',
    agentAccent: '#5b5bd8',
  },
  {
    id: 'evt-8',
    type: 'waiting_confirmation',
    detail: '是否允许删除 src/legacy/old-handler.ts？',
    timestamp: '2026-03-31T14:13:20',
    agentId: 'backend',
    agentName: '后端工程师',
    agentAccent: '#378dff',
  },
  {
    id: 'evt-9',
    type: 'file_create',
    detail: '创建 src/middleware/errorHandler.ts',
    timestamp: '2026-03-31T14:15:00',
    agentId: 'architect',
    agentName: '架构师',
    agentAccent: '#7c52ff',
  },
  {
    id: 'evt-10',
    type: 'error',
    detail: 'ESLint 报错: unexpected any in errorHandler.ts:23',
    timestamp: '2026-03-31T14:16:30',
    agentId: 'tester',
    agentName: '测试工程师',
    agentAccent: '#00b3ff',
  },
  {
    id: 'evt-11',
    type: 'user_input',
    detail: '用户确认：允许删除 old-handler.ts',
    timestamp: '2026-03-31T14:17:00',
    agentId: 'leader',
    agentName: '团队负责人',
    agentAccent: '#d59b11',
  },
  {
    id: 'evt-12',
    type: 'turn_complete',
    detail: '后端工程师完成错误处理中间件集成',
    timestamp: '2026-03-31T14:20:00',
    agentId: 'backend',
    agentName: '后端工程师',
    agentAccent: '#378dff',
  },
  {
    id: 'evt-13',
    type: 'thinking',
    detail: '评估代码质量，检查是否满足安全标准',
    timestamp: '2026-03-31T14:21:00',
    agentId: 'critic',
    agentName: '批评者',
    agentAccent: '#d04e4e',
  },
  {
    id: 'evt-14',
    type: 'file_read',
    detail: '读取 src/middleware/errorHandler.ts',
    timestamp: '2026-03-31T14:22:00',
    agentId: 'critic',
    agentName: '批评者',
    agentAccent: '#d04e4e',
  },
  {
    id: 'evt-15',
    type: 'assistant_message',
    detail: '代码评审：建议增加输入验证和日志记录',
    timestamp: '2026-03-31T14:24:00',
    agentId: 'critic',
    agentName: '批评者',
    agentAccent: '#d04e4e',
  },
  {
    id: 'evt-16',
    type: 'task_complete',
    detail: '错误处理中间件任务完成，测试通过',
    timestamp: '2026-03-31T14:28:00',
    agentId: 'leader',
    agentName: '团队负责人',
    agentAccent: '#d59b11',
  },
];

export const agentTeamsActivityStats: Record<string, number> = {
  thinking: 12,
  file_read: 28,
  file_write: 15,
  file_create: 8,
  command_execute: 22,
  tool_use: 18,
  error: 3,
  waiting_confirmation: 5,
  user_input: 7,
  turn_complete: 9,
  task_complete: 4,
  assistant_message: 14,
};
