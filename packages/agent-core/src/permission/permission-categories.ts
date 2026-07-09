import type { WorkspacePermissionAction } from './workspace-permission-config.js';

export interface PermissionCategoryMeta {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultAction: WorkspacePermissionAction;
  readonly supportsPatterns: boolean;
}

export const PERMISSION_CATEGORIES: PermissionCategoryMeta[] = [
  {
    id: 'read',
    label: '读取文件',
    description: '读取工作区文件内容',
    defaultAction: 'allow',
    supportsPatterns: true,
  },
  {
    id: 'edit',
    label: '编辑文件',
    description: '修改现有文件（edit、apply_patch）',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'write',
    label: '写入文件',
    description: '创建或覆盖写入文件',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'bash',
    label: '执行命令',
    description: '运行 Shell 命令',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'glob',
    label: '文件列表',
    description: '列举工作区文件结构',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'grep',
    label: '内容搜索',
    description: '搜索文件内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'task',
    label: '子任务管理',
    description: '直接创建和更新任务记录',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'task_run',
    label: '子任务委派',
    description: '启动子代理执行委派任务',
    defaultAction: 'allow',
    supportsPatterns: true,
  },
  {
    id: 'skill',
    label: '技能调用',
    description: '执行已安装的技能',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'mcp_call',
    label: 'MCP 工具',
    description: '调用外部 MCP 服务工具',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'channel',
    label: '消息渠道发送',
    description: '向 Telegram、飞书、微信等消息渠道发送或回复内容',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'lsp',
    label: 'LSP 操作',
    description: '语言服务协议操作（重命名等）',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'websearch',
    label: '网页搜索',
    description: '搜索互联网内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'webfetch',
    label: '网页抓取',
    description: '抓取网页内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'codesearch',
    label: '代码搜索',
    description: '语义化代码搜索',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'custom',
    label: '自定义工具',
    description: '用户自定义或动态注册的工具',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'desktop_automation',
    label: '桌面自动化',
    description: '控制桌面浏览器操作',
    defaultAction: 'ask',
    supportsPatterns: false,
  },
  {
    id: 'desktop_control',
    label: '系统桌面控制',
    description: '控制本机系统桌面截图、鼠标和键盘',
    defaultAction: 'ask',
    supportsPatterns: false,
  },
];
