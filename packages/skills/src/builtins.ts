import type { SkillManifest, SkillExecutor, ToolResult } from '@openAwork/skill-types';

export interface BuiltinSkillDef {
  manifest: SkillManifest;
  executor: SkillExecutor;
}

// ---------------------------------------------------------------------------
// oh-my-opencode 移植的 prompt-based skill（descriptionForModel 自身就是
// SKILL.md 全文）。OpenAWork 仅保留 `git-master` 一项 —— agent-browser /
// dev-browser / frontend-ui-ux 与原生工具表不匹配或重复，已移除。
// ---------------------------------------------------------------------------

const gitMasterManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.git-master',
  name: 'git-master',
  displayName: 'git-master',
  version: '1.0.0',
  description:
    'MUST USE for ANY git operations. Atomic commits, rebase/squash, history search (blame, bisect, log -S).',
  descriptionForModel: `Git Master Agent — Combines three specializations:
1. Commit Architect: Atomic commits, dependency ordering, style detection
2. Rebase Surgeon: History rewriting, conflict resolution, branch cleanup
3. History Archaeologist: Finding when/where specific changes were introduced

## MODE DETECTION (FIRST STEP)
| User Request Pattern | Mode |
| "commit", changes to commit | COMMIT |
| "rebase", "squash", "cleanup history" | REBASE |
| "find when", "who changed", "blame", "bisect" | HISTORY_SEARCH |

## CORE PRINCIPLE: MULTIPLE COMMITS BY DEFAULT
3+ files changed -> MUST be 2+ commits
5+ files changed -> MUST be 3+ commits
10+ files changed -> MUST be 5+ commits

Split by: Different directories/modules, Different component types, Can be reverted independently, Different concerns (UI/logic/config/test)

ONLY COMBINE when: EXACT same atomic unit (function + its test), Splitting would break compilation

## COMMIT MODE Phases
### Phase 0: Parallel Context Gathering (MANDATORY)
\`\`\`bash
git status; git diff --staged --stat; git diff --stat
git log -30 --oneline; git branch --show-current
git merge-base HEAD main 2>/dev/null; git rev-parse --abbrev-ref @{upstream}
\`\`\`

### Phase 1: Style Detection (BLOCKING)
Detect language (Korean/English) and commit style (SEMANTIC/PLAIN/SENTENCE/SHORT) from recent git log.
MUST output STYLE DETECTION RESULT before proceeding.

### Phase 2: Branch Context Analysis
Determine branch state and rewrite safety.

### Phase 3: Atomic Unit Planning (BLOCKING)
min_commits = ceil(file_count / 3)
Split by directory first, then by concern.
Test files MUST be in same commit as implementation.
MUST justify each commit with 3+ files before executing.
MUST output COMMIT PLAN before proceeding.

### Phase 4: Commit Strategy Decision
Decide FIXUP vs NEW COMMIT for each group.

### Phase 5: Commit Execution
Stage and commit in dependency order (Level 0 -> Level 4).

### Phase 6: Verification & Cleanup
Verify clean state, decide push strategy.

## REBASE MODE Phases
- R1: Context analysis + safety assessment
- R2: Execution (autosquash, rebase onto, conflict resolution)
- R3: Post-rebase verification
- R4: Report

NEVER rebase main/master. Always use --force-with-lease instead of --force.

## HISTORY SEARCH MODE Phases
- H1: Determine search type (pickaxe/regex/blame/bisect/file_log)
- H2: Execute search (git log -S, git log -G, git blame, git bisect)
- H3: Present results with actionable context

Quick reference:
| When was "X" added? | git log -S "X" --oneline |
| Who wrote line N? | git blame -L N,N file.py |
| When did bug start? | git bisect start |
| File history | git log --follow -- path/file.py |`,
  capabilities: ['git.commit', 'git.rebase', 'git.history', 'git.bisect', 'git.blame'],
  permissions: [{ type: 'filesystem', scope: '**', required: true }],
  lifecycle: { activation: 'on-demand' },
};

const noopExecutor: SkillExecutor = async (): Promise<ToolResult> => {
  return {
    content: 'This is a prompt-based skill. Content is injected via descriptionForModel.',
    isError: false,
  };
};

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  // OpenAWork 仅保留 git-master 这一个 prompt-based 内置 skill。
  // file-read / clipboard-read / web-search 等已被原生 tool（read /
  // workspace_read_file / web_search）取代，这里不再重复声明。
  { manifest: gitMasterManifest, executor: noopExecutor },
];
