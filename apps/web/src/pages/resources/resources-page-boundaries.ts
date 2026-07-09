import type { ResourceCenterItem } from './resource-center-utils.js';

interface ResourceBoundaryLink {
  readonly href: string;
  readonly label: string;
}

export interface ResourceBoundaryNotice {
  readonly title: string;
  readonly description: string;
  readonly links: readonly ResourceBoundaryLink[];
}

export function resourceBoundaryNotice(item: ResourceCenterItem): ResourceBoundaryNotice | null {
  if (item.usageKind === 'skill') {
    return {
      title: '生命周期在技能管理页',
      description:
        '资源中心只展示 Skill 定义和来源。安装、启停、更新与系统目录扫描继续使用现有技能管理面，避免出现第二套状态。',
      links: [
        { href: '/settings/plugins?plugin=skills', label: '管理已安装技能' },
        { href: '/skills', label: '打开技能市场' },
      ],
    };
  }

  if (item.usageKind === 'mcp-server') {
    return {
      title: '运行状态在 MCP 设置页',
      description:
        '资源中心只展示 MCP Server 描述。服务器配置、连接状态、重试和工具禁用继续走现有 MCP 设置面，不在这里复制运行时控制。',
      links: [{ href: '/settings/plugins?plugin=mcp', label: '管理 MCP 服务器' }],
    };
  }

  return null;
}
