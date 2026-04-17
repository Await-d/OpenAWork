import type { StatusMeta, ToolCardStatus, ToolKind } from './tool-call-card-shared.js';
import { tokens } from './tokens.js';

export function ToolKindIcon({ kind }: { kind: ToolKind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'mcp') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M8 8h8v8H8z" />
        <path d="M4 12h4" />
        <path d="M16 12h4" />
        <path d="M12 4v4" />
        <path d="M12 16v4" />
      </svg>
    );
  }

  if (kind === 'skill') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />
      </svg>
    );
  }

  if (kind === 'agent') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 11h.01" />
        <path d="M14 11h.01" />
        <path d="M9 15h6" />
        <path d="M12 3v4" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden="true">
      <path d="m14 7 3 3" />
      <path d="m5 19 4.5-1 8-8a2.12 2.12 0 0 0-3-3l-8 8Z" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export function resolveStatusMeta(status: ToolCardStatus, toolName: string): StatusMeta {
  if (status === 'paused') {
    return {
      color: tokens.color.warning,
      dot: tokens.color.warning,
      label:
        toolName.trim().toLowerCase() === 'askuserquestion' ||
        toolName.trim().toLowerCase() === 'question'
          ? '等待回答'
          : toolName.trim().toLowerCase() === 'exitplanmode'
            ? '等待确认'
            : '等待权限',
    };
  }

  if (status === 'failed') {
    return {
      color: tokens.color.danger,
      dot: tokens.color.danger,
      label: '失败',
    };
  }

  if (status === 'completed') {
    return {
      color: tokens.color.success,
      dot: tokens.color.success,
      label: '完成',
    };
  }

  return {
    color: tokens.color.info,
    dot: tokens.color.info,
    label: '执行中',
  };
}

export function inferToolKind(toolName: string): ToolKind {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === 'task') {
    return 'agent';
  }
  if (normalized.includes('mcp') || normalized.includes('context7')) {
    return 'mcp';
  }
  if (normalized.includes('skill') || normalized.includes('技能')) {
    return 'skill';
  }
  if (
    normalized.includes('agent') ||
    normalized.includes('代理') ||
    normalized.includes('oracle') ||
    normalized.includes('subagent')
  ) {
    return 'agent';
  }
  return 'tool';
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

  return sections.join('\n');
}
