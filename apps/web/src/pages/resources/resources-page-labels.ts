import type { ResourceArea } from '@openAwork/web-client';
import {
  FEATURE_RESOURCE_AREA_OPTIONS,
  RESOURCE_AREA_OPTIONS,
  type ResourceCenterItem,
} from './resource-center-utils.js';

export function integrationLabel(item: ResourceCenterItem): string {
  if (item.integration === 'user') {
    return '用户上传';
  }
  return item.integration === 'builtin' ? '内置' : '参考';
}

export function areaLabel(area: ResourceArea): string {
  return (
    RESOURCE_AREA_OPTIONS.find((option) => option.value === area)?.label ??
    FEATURE_RESOURCE_AREA_OPTIONS.find((option) => option.value === area)?.label ??
    area
  );
}

export function featureLabel(item: ResourceCenterItem): string {
  switch (item.feature) {
    case 'channels':
      return '通道个人角色';
    case 'team':
      return '团队与工作区模板';
    case 'commands':
      return '命令模板';
    case 'prompts':
      return '运行提示词';
    case 'skills':
      return '可触发 Skill';
    case 'agents':
      return '可用 Agent';
    case 'mcps':
      return 'MCP Server';
    case 'extensions':
      return '扩展示例';
  }
}

export function usageLabel(item: ResourceCenterItem): string {
  switch (item.usageKind) {
    case 'channel-persona':
      return '用于 Channels 的个人角色设定，不混入通用资源目录';
    case 'agent-template':
      return '用于团队/工作区记忆文件模板';
    case 'command-definition':
      return '仅作为命令模板与参考材料；可执行动作仍走内置命令白名单';
    case 'runtime-instruction':
      return '仅作为运行时提示词材料；必须由具体功能显式选择后才会注入';
    case 'skill':
      return '可按 Skill 生命周期识别';
    case 'agent':
      return '可按 Agent 目录识别';
    case 'mcp-server':
      return '可按 MCP Server 配置识别';
    case 'extension-example':
      return '扩展开发示例与文件包';
  }
}
