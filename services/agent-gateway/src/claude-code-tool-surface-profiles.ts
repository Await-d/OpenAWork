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
  Agent: 'call_omo_agent',
  EnterPlanMode: 'EnterPlanMode',
  ExitPlanMode: 'ExitPlanMode',
} as const;

export const CANONICAL_TO_PRESENTED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PRESENTED_TO_CANONICAL)
    .map(([presented, canonical]) => [canonical, presented] as const)
    .filter(
      ([canonical], index, entries) => entries.findIndex(([name]) => name === canonical) === index,
    ),
) as Readonly<Record<string, string>>;
