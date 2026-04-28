import type { StatusMeta, ToolCardStatus, ToolKind } from './tool-call-card-shared.js';
import { tokens } from './tokens.js';
import { resolveToolKind, resolveToolStatusMeta, ToolGlyph } from './tool-visual-meta.js';

export function ToolKindIcon({ kind }: { kind: ToolKind }) {
  const toolName = kind === 'mcp' ? 'mcp' : kind === 'skill' ? 'skill' : kind === 'agent' ? 'task' : 'tool';
  return <ToolGlyph kind={kind} size={12} toolName={toolName} />;
}

export function resolveStatusMeta(status: ToolCardStatus, toolName: string): StatusMeta {
  return resolveToolStatusMeta(status, toolName);
}

export function inferToolKind(toolName: string): ToolKind {
  return resolveToolKind(toolName);
}

export function iconForToolKind(kind: ToolKind): string {
  if (kind === 'mcp') return 'MCP';
  if (kind === 'skill') return 'SKILL';
  if (kind === 'agent') return 'AGENT';
  return 'TOOL';
}

export function buildToolCopyText(input: {
  diffSummary?: string;
  displayToolName: string;
  input: Record<string, unknown>;
  isError?: boolean;
  output?: unknown;
  outputReadHints?: string[];
  resumedAfterApproval?: boolean;
  statusLabel: string;
  stringifyValue: (value: unknown) => string;
  summary: string;
  toolKindLabel: string;
}) {
  const sections = [
    `工具：${input.displayToolName}`,
    `类型：${input.toolKindLabel}`,
    `状态：${input.statusLabel}`,
    `摘要：${input.summary || '查看详情'}`,
  ];

  if (input.resumedAfterApproval) {
    sections.push('恢复：审批已通过后继续执行');
  }

  if (input.diffSummary) {
    sections.push(`变更：${input.diffSummary}`);
  }

  sections.push('', '输入', input.stringifyValue(input.input));

  if (input.output !== undefined) {
    sections.push('', input.isError ? '错误输出' : '输出', input.stringifyValue(input.output));
  }

  if (input.outputReadHints && input.outputReadHints.length > 0) {
    sections.push('', '继续读取建议', input.outputReadHints.join('\n'));
  }

  return sections.join('\n');
}
