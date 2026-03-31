export const CLAUDE_CODE_PROFILE_NAMES = [
  'openawork',
  'claude_code_simple',
  'claude_code_default',
] as const;

export type ClaudeCodeProfileName = (typeof CLAUDE_CODE_PROFILE_NAMES)[number];

export const PRESENTED_TO_CANONICAL: Readonly<Record<string, string>> = {
  Bash: 'bash',
  Read: 'read',
  Edit: 'edit',
  Write: 'write',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  TodoWrite: 'todowrite',
  TaskCreate: 'task_create',
  TaskGet: 'task_get',
  TaskList: 'task_list',
  TaskUpdate: 'task_update',
  Skill: 'skill',
  AskUserQuestion: 'question',
  Agent: 'task',
} as const;

export const CANONICAL_TO_PRESENTED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PRESENTED_TO_CANONICAL)
    .map(([presented, canonical]) => [canonical, presented] as const)
    .filter(
      ([canonical], index, entries) => entries.findIndex(([name]) => name === canonical) === index,
    ),
) as Readonly<Record<string, string>>;

export type ProfileToolSet = ReadonlySet<string> | null;

const SIMPLE_CANONICAL_TOOLS: ReadonlySet<string> = new Set(['bash', 'read', 'edit']);

const DEFAULT_CANONICAL_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'read',
  'edit',
  'write',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'todowrite',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'skill',
  'question',
  'task',
]);

export const PROFILE_TOOL_SETS: Readonly<Record<ClaudeCodeProfileName, ProfileToolSet>> = {
  openawork: null,
  claude_code_simple: SIMPLE_CANONICAL_TOOLS,
  claude_code_default: DEFAULT_CANONICAL_TOOLS,
} as const;
