import { tokens } from './tokens.js';
import type { StatusMeta, ToolCardStatus, ToolKind } from './tool-call-card-shared.js';

export type ToolVisualStatus = ToolCardStatus | 'cancelled' | 'idle' | 'pending';

export type ToolIconKey =
  | 'apply-patch'
  | 'ast-grep'
  | 'brain'
  | 'bubble-5'
  | 'bullet-list'
  | 'checklist'
  | 'code'
  | 'code-lines'
  | 'console'
  | 'edit'
  | 'gear'
  | 'glasses'
  | 'image'
  | 'kind-agent'
  | 'kind-mcp'
  | 'kind-skill'
  | 'lsp-symbol'
  | 'magnifying-glass-menu'
  | 'mcp'
  | 'plan-enter'
  | 'plan-exit'
  | 'task'
  | 'window-cursor';

const TOOL_SVG_PATHS: Record<ToolIconKey, string> = {
  glasses:
    '<path d="M0.416626 7.91667H1.66663M19.5833 7.91667H18.3333M11.866 7.57987C11.3165 7.26398 10.6793 7.08333 9.99996 7.08333C9.32061 7.08333 8.68344 7.26398 8.13389 7.57987M8.74996 10C8.74996 12.0711 7.07103 13.75 4.99996 13.75C2.92889 13.75 1.24996 12.0711 1.24996 10C1.24996 7.92893 2.92889 6.25 4.99996 6.25C7.07103 6.25 8.74996 7.92893 8.74996 10ZM18.75 10C18.75 12.0711 17.071 13.75 15 13.75C12.9289 13.75 11.25 12.0711 11.25 10C11.25 7.92893 12.9289 6.25 15 6.25C17.071 6.25 18.75 7.92893 18.75 10Z" stroke="currentColor" stroke-linecap="square"/>',
  'bullet-list':
    '<path d="M9.58329 13.7497H17.0833M9.58329 6.24967H17.0833M6.24996 6.24967C6.24996 7.17015 5.50377 7.91634 4.58329 7.91634C3.66282 7.91634 2.91663 7.17015 2.91663 6.24967C2.91663 5.3292 3.66282 4.58301 4.58329 4.58301C5.50377 4.58301 6.24996 5.3292 6.24996 6.24967ZM6.24996 13.7497C6.24996 14.6701 5.50377 15.4163 4.58329 15.4163C3.66282 15.4163 2.91663 14.6701 2.91663 13.7497C2.91663 12.8292 3.66282 12.083 4.58329 12.083C5.50377 12.083 6.24996 12.8292 6.24996 13.7497Z" stroke="currentColor" stroke-linecap="square"/>',
  'magnifying-glass-menu':
    '<path d="M2.08325 10.0002H4.58325M2.08325 5.41683H5.41659M2.08325 14.5835H5.41659M16.4583 13.9585L18.7499 16.2502M17.9166 10.0002C17.9166 12.9917 15.4915 15.4168 12.4999 15.4168C9.50838 15.4168 7.08325 12.9917 7.08325 10.0002C7.08325 7.00862 9.50838 4.5835 12.4999 4.5835C15.4915 4.5835 17.9166 7.00862 17.9166 10.0002Z" stroke="currentColor" stroke-linecap="square"/>',
  code: '<path d="M8.7513 7.5013L6.2513 10.0013L8.7513 12.5013M11.2513 7.5013L13.7513 10.0013L11.2513 12.5013M2.91797 2.91797H17.0846V17.0846H2.91797V2.91797Z" stroke="currentColor"/>',
  'code-lines':
    '<path d="M2.08325 3.75H11.2499M14.5833 3.75H17.9166M2.08325 10L7.08325 10M10.4166 10L17.9166 10M2.08325 16.25L8.74992 16.25M12.0833 16.25L17.9166 16.25" stroke="currentColor" stroke-linecap="square" stroke-linejoin="round"/>',
  console: '<path d="M3.75 5.4165L8.33333 9.99984L3.75 14.5832M10.4167 14.5832H16.25" stroke="currentColor" stroke-linecap="square"/>',
  'window-cursor':
    '<path d="M17.9166 10.4167V3.75H2.08325V17.0833H10.4166M17.9166 13.5897L11.6666 11.6667L13.5897 17.9167L15.032 15.0321L17.9166 13.5897Z" stroke="currentColor" stroke-width="1.07143" stroke-linecap="square"/><path d="M5.00024 6.125C5.29925 6.12518 5.54126 6.36795 5.54126 6.66699C5.54108 6.96589 5.29914 7.20783 5.00024 7.20801C4.7012 7.20801 4.45843 6.966 4.45825 6.66699C4.45825 6.36784 4.70109 6.125 5.00024 6.125ZM7.91626 6.125C8.21541 6.125 8.45825 6.36784 8.45825 6.66699C8.45808 6.966 8.21531 7.20801 7.91626 7.20801C7.61736 7.20783 7.37542 6.96589 7.37524 6.66699C7.37524 6.36795 7.61726 6.12518 7.91626 6.125ZM10.8333 6.125C11.1324 6.125 11.3752 6.36784 11.3752 6.66699C11.3751 6.966 11.1323 7.20801 10.8333 7.20801C10.5342 7.20801 10.2914 6.966 10.2913 6.66699C10.2913 6.36784 10.5341 6.125 10.8333 6.125Z" fill="currentColor" stroke="currentColor" stroke-width="0.25" stroke-linecap="square"/>',
  task: '<path d="M9.99992 2.0835V17.9168M7.08325 3.75016H2.08325V16.2502H7.08325M12.9166 16.2502H17.9166V3.75016H12.9166" stroke="currentColor" stroke-linecap="square"/>',
  checklist:
    '<path d="M9.58342 13.7498H17.0834M9.58342 6.24984H17.0834M2.91675 6.6665L4.58341 7.9165L7.08341 4.1665M2.91675 14.1665L4.58341 15.4165L7.08341 11.6665" stroke="currentColor" stroke-linecap="square"/>',
  'bubble-5':
    '<path d="M18.3327 9.99935C18.3327 5.57227 15.0919 2.91602 9.99935 2.91602C4.90676 2.91602 1.66602 5.57227 1.66602 9.99935C1.66602 11.1487 2.45505 13.1006 2.57637 13.3939C2.58707 13.4197 2.59766 13.4434 2.60729 13.4697C2.69121 13.6987 3.04209 14.9354 1.66602 16.7674C3.51787 17.6528 5.48453 16.1973 5.48453 16.1973C6.84518 16.9193 8.46417 17.0827 9.99935 17.0827C15.0919 17.0827 18.3327 14.4264 18.3327 9.99935Z" stroke="currentColor" stroke-linecap="square"/>',
  brain:
    '<path d="M13.332 8.7487C11.4911 8.7487 9.9987 7.25631 9.9987 5.41536M6.66536 11.2487C8.50631 11.2487 9.9987 12.7411 9.9987 14.582M9.9987 2.78209L9.9987 17.0658M16.004 15.0475C17.1255 14.5876 17.9154 13.4849 17.9154 12.1978C17.9154 11.3363 17.5615 10.5575 16.9913 9.9987C17.5615 9.43991 17.9154 8.66108 17.9154 7.79962C17.9154 6.21199 16.7136 4.90504 15.1702 4.73878C14.7858 3.21216 13.4039 2.08203 11.758 2.08203C11.1171 2.08203 10.5162 2.25337 9.9987 2.55275C9.48117 2.25337 8.88032 2.08203 8.23944 2.08203C6.59353 2.08203 5.21157 3.21216 4.82722 4.73878C3.28377 4.90504 2.08203 6.21199 2.08203 7.79962C2.08203 8.66108 2.43585 9.43991 3.00609 9.9987C2.43585 10.5575 2.08203 11.3363 2.08203 12.1978C2.08203 13.4849 2.87191 14.5876 3.99339 15.0475C4.46688 16.7033 5.9917 17.9154 7.79962 17.9154C8.61335 17.9154 9.36972 17.6698 9.9987 17.2488C10.6277 17.6698 11.384 17.9154 12.1978 17.9154C14.0057 17.9154 15.5305 16.7033 16.004 15.0475Z" stroke="currentColor"/>',
  mcp:
    '<g><path d="M0.972656 9.37176L9.5214 1.60019C10.7018 0.527151 12.6155 0.527151 13.7957 1.60019C14.9761 2.67321 14.9761 4.41295 13.7957 5.48599L7.3397 11.3552" stroke="currentColor" stroke-linecap="round"/><path d="M7.42871 11.2747L13.7957 5.48643C14.9761 4.41338 16.8898 4.41338 18.0702 5.48643L18.1147 5.52688C19.2951 6.59993 19.2951 8.33966 18.1147 9.4127L10.3831 16.4414C9.98966 16.7991 9.98966 17.379 10.3831 17.7366L11.9707 19.1799" stroke="currentColor" stroke-linecap="round"/><path d="M11.6587 3.54346L5.33619 9.29119C4.15584 10.3642 4.15584 12.1039 5.33619 13.177C6.51649 14.25 8.43019 14.25 9.61054 13.177L15.9331 7.42923" stroke="currentColor" stroke-linecap="round"/></g>',
  edit: '<path d="M9.58301 17.9166H17.9163M17.9163 5.83325L14.1663 2.08325L2.08301 14.1666V17.9166H5.83301L17.9163 5.83325Z" stroke="currentColor" stroke-linecap="square"/>',
  'apply-patch':
    '<path d="M2.08325 3.75H11.2499M14.5833 3.75H17.9166M2.08325 10L7.08325 10M10.4166 10L17.9166 10M2.08325 16.25L8.74992 16.25M12.0833 16.25L17.9166 16.25" stroke="currentColor" stroke-linecap="square" stroke-linejoin="round"/>',
  'lsp-symbol':
    '<path d="M7.91602 2.91406H2.91602V17.0807H17.0827V12.0807M12.0827 2.91406H17.0827V7.91406M9.58268 10.4141L16.666 3.33073" stroke="currentColor" stroke-linecap="square"/>',
  'ast-grep': '<path d="M8.7513 7.5013L6.2513 10.0013L8.7513 12.5013M11.2513 7.5013L13.7513 10.0013L11.2513 12.5013M2.91797 2.91797H17.0846V17.0846H2.91797V2.91797Z" stroke="currentColor"/>',
  'plan-enter': '<path d="M12.292 6.04167L16.2503 9.99998L12.292 13.9583M2.91699 9.99998H15.6253M17.0837 3.75V16.25" stroke="currentColor" stroke-linecap="square"/>',
  'plan-exit': '<path d="M8.33464 4.58398L2.91797 10.0007L8.33464 15.4173M3.33464 10.0007H17.0846" stroke="currentColor" stroke-linecap="square"/>',
  'kind-mcp': '<path d="M8 8h8v8H8z" /><path d="M4 12h4" /><path d="M16 12h4" /><path d="M12 4v4" /><path d="M12 16v4" />',
  'kind-skill': '<path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />',
  'kind-agent': '<rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 11h.01" /><path d="M14 11h.01" /><path d="M9 15h6" /><path d="M12 3v4" />',
  image:
    '<path d="M2.5 4.16699H17.5V15.8337H2.5V4.16699Z" stroke="currentColor" stroke-linecap="square"/><circle cx="7.08333" cy="8.33366" r="1.66667" stroke="currentColor"/><path d="M2.5 13.3337L6.25 10.0003L9.16667 12.5003L13.75 8.33366L17.5 11.667" stroke="currentColor" stroke-linecap="square" stroke-linejoin="round"/>',
  gear: '<path d="M7.62516 4.46094L5.05225 3.86719L3.86475 5.05469L4.4585 7.6276L2.0835 9.21094V10.7943L4.4585 12.3776L3.86475 14.9505L5.05225 16.138L7.62516 15.5443L9.2085 17.9193H10.7918L12.3752 15.5443L14.9481 16.138L16.1356 14.9505L15.5418 12.3776L17.9168 10.7943V9.21094L15.5418 7.6276L16.1356 5.05469L14.9481 3.86719L12.3752 4.46094L10.7918 2.08594H9.2085L7.62516 4.46094Z" stroke="currentColor"/><path d="M12.5002 10.0026C12.5002 11.3833 11.3809 12.5026 10.0002 12.5026C8.61945 12.5026 7.50016 11.3833 7.50016 10.0026C7.50016 8.62189 8.61945 7.5026 10.0002 7.5026C11.3809 7.5026 12.5002 8.62189 12.5002 10.0026Z" stroke="currentColor"/>',
};

const TOOL_TO_ICON: Record<string, ToolIconKey> = {
  read: 'glasses',
  list: 'bullet-list',
  grep: 'magnifying-glass-menu',
  glob: 'magnifying-glass-menu',
  codesearch: 'code',
  write: 'code-lines',
  edit: 'edit',
  multi_edit: 'edit',
  apply_patch: 'apply-patch',
  bash: 'console',
  webfetch: 'window-cursor',
  websearch: 'window-cursor',
  google_search: 'window-cursor',
  task: 'task',
  agent: 'task',
  call_omo_agent: 'task',
  skill: 'brain',
  question: 'bubble-5',
  askuserquestion: 'bubble-5',
  todowrite: 'checklist',
  todoread: 'checklist',
  subtodowrite: 'checklist',
  subtodoread: 'checklist',
  enterplanmode: 'plan-enter',
  exitplanmode: 'plan-exit',
  generate_image: 'image',
  generateimage: 'image',
};

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function resolveToolKind(toolName: string, explicitKind?: ToolKind): ToolKind {
  if (explicitKind) {
    return explicitKind;
  }

  const normalized = normalizeToolName(toolName);
  if (normalized === 'task') return 'agent';
  if (normalized.includes('mcp') || normalized.includes('context7')) return 'mcp';
  if (normalized.includes('skill') || normalized.includes('技能')) return 'skill';
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

export function resolveToolIconKey(toolName: string, explicitKind?: ToolKind): ToolIconKey {
  const normalized = normalizeToolName(toolName);
  const mapped = TOOL_TO_ICON[normalized];
  if (mapped) return mapped;
  if (normalized.startsWith('lsp_')) return 'lsp-symbol';
  if (normalized.startsWith('ast_grep')) return 'ast-grep';
  if (normalized.startsWith('mcp_')) return 'mcp';

  const resolvedKind = resolveToolKind(toolName, explicitKind);
  if (resolvedKind === 'mcp') return 'kind-mcp';
  if (resolvedKind === 'skill') return 'kind-skill';
  if (resolvedKind === 'agent') return 'kind-agent';
  return 'gear';
}

export function resolveToolVisualStatus(input: {
  defaultStatus?: 'idle' | 'running';
  isError?: boolean;
  output?: unknown;
  status?: string;
}): ToolVisualStatus {
  if (input.isError === true) {
    return 'failed';
  }

  switch ((input.status ?? '').trim().toLowerCase()) {
    case 'cancelled':
      return 'cancelled';
    case 'completed':
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'paused':
      return 'paused';
    case 'pending':
      return 'pending';
    case 'running':
    case 'in_progress':
      return 'running';
    default:
      if (input.output !== undefined) {
        return 'completed';
      }
      return input.defaultStatus ?? 'running';
  }
}

function resolveStatusColor(status: ToolVisualStatus): string {
  if (status === 'completed') return tokens.color.success;
  if (status === 'failed') return tokens.color.danger;
  if (status === 'paused') return tokens.color.warning;
  if (status === 'running') return tokens.color.info;
  return tokens.color.muted;
}

function resolveStatusLabel(status: ToolVisualStatus, toolName: string): string {
  if (status === 'paused') {
    const normalized = normalizeToolName(toolName);
    if (normalized === 'askuserquestion' || normalized === 'question') return '等待回答';
    if (normalized === 'exitplanmode') return '等待确认';
    return '等待权限';
  }
  if (status === 'pending') return '待执行';
  if (status === 'cancelled') return '已取消';
  if (status === 'failed') return '失败';
  if (status === 'completed') return '完成';
  if (status === 'idle') return '未开始';
  return '执行中';
}

export function resolveToolStatusMeta(status: ToolVisualStatus, toolName: string): StatusMeta {
  const color = resolveStatusColor(status);
  return {
    color,
    dot: color,
    label: resolveStatusLabel(status, toolName),
  };
}

export function ToolGlyph({
  kind,
  size = 12,
  toolName,
}: {
  kind?: ToolKind;
  size?: number;
  toolName: string;
}) {
  const iconKey = resolveToolIconKey(toolName, kind);
  const svgContent = TOOL_SVG_PATHS[iconKey] ?? TOOL_SVG_PATHS['gear'];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
