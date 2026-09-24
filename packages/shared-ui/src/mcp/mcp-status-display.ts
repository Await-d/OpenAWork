import { color } from '../tokens.js';
import type { MCPServerStatus } from './MCPServerList.js';

/** MCP 运行状态 → 语义色（E · Nebula token）。 */
export const MCP_STATUS_COLOR: Record<MCPServerStatus['status'], string> = {
  connected: color.success,
  connecting: color.contrast,
  disabled: color.fgSubtle,
  disconnected: color.fgMuted,
  error: color.danger,
};

/** MCP 运行状态 → 中文标签。 */
export const MCP_STATUS_LABEL: Record<MCPServerStatus['status'], string> = {
  connected: '已连接',
  connecting: '连接中…',
  disabled: '已禁用',
  disconnected: '已断开',
  error: '错误',
};

export function mcpStatusColor(status: MCPServerStatus['status']): string {
  return MCP_STATUS_COLOR[status];
}

export function mcpStatusLabel(status: MCPServerStatus['status']): string {
  return MCP_STATUS_LABEL[status];
}
