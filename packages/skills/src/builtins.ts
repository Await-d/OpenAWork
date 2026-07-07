import type { SkillManifest, SkillExecutor, ToolResult } from '@openAwork/skill-types';

export interface BuiltinSkillDef {
  manifest: SkillManifest;
  executor: SkillExecutor;
}

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

function promptSkill(input: {
  name: string;
  displayName: string;
  description: string;
  descriptionForModel: string;
  capabilities: string[];
  permissions?: SkillManifest['permissions'];
}): SkillManifest {
  return {
    apiVersion: 'agent-skill/v1',
    id: `com.openAwork.builtin.${input.name}`,
    name: input.name,
    displayName: input.displayName,
    version: '1.0.0',
    description: input.description,
    descriptionForModel: input.descriptionForModel,
    capabilities: input.capabilities,
    permissions: input.permissions ?? [{ type: 'filesystem', scope: '**', required: false }],
    lifecycle: { activation: 'on-demand' },
  };
}

const reviewWorkManifest = promptSkill({
  name: 'review-work',
  displayName: 'review-work',
  description:
    'Post-implementation review: verify goal fit, code quality, security, tests, and observable behavior before claiming done.',
  capabilities: ['review.goal', 'review.code-quality', 'review.security', 'review.qa'],
  descriptionForModel: `Review Work is used after a meaningful implementation change.

Review the actual diff and the user goal before approving. Check: requested behavior, type boundaries, error handling, security-sensitive inputs, persistence side effects, test coverage, and whether the feature was exercised through its real surface. Findings come first, ordered by severity with file and line references. If no issue is found, say that clearly and name remaining risk or test gaps. Do not invent verification; report only commands, screenshots, or runtime behavior that actually happened in OpenAWork.`,
});

const programmingManifest = promptSkill({
  name: 'programming',
  displayName: 'programming',
  description:
    'Strict TypeScript/Python/Rust/Go engineering guidance for surgical, tested, type-safe changes.',
  capabilities: ['code.implementation', 'code.type-safety', 'code.testing'],
  descriptionForModel: `Programming is active for production code changes.

Prefer the smallest correct change that follows the existing module boundary. Read the relevant code first, reuse local helpers, and make illegal states unrepresentable with strict types. Do not use any, TypeScript suppressions, empty catch blocks, or broad rewrites. Add tests when behavior changes or a regression is subtle. After editing, run the narrowest meaningful test/typecheck commands and report exact failures instead of hiding them.`,
});

const frontendManifest = promptSkill({
  name: 'frontend',
  displayName: 'frontend',
  description:
    'OpenAWork frontend design and implementation guidance for responsive, token-driven UI work.',
  capabilities: ['frontend.react', 'frontend.design-system', 'frontend.accessibility'],
  descriptionForModel: `Frontend is active for Web UI work.

Use the existing OpenAWork design tokens and components before adding new styling. Build the real workflow surface, not a marketing placeholder. Include loading, empty, error, hover, active, and focus states. Keep layouts responsive down to 375px, avoid hardcoded colors, and avoid nested card-heavy compositions. All gateway access from apps/packages must go through @openAwork/web-client unless the target is an external third-party API.`,
});

const visualQaManifest = promptSkill({
  name: 'visual-qa',
  displayName: 'visual-qa',
  description:
    'Visual QA checklist for web UI changes: screenshots, responsive checks, overlap, contrast, and state fidelity.',
  capabilities: ['qa.visual', 'qa.responsive', 'qa.accessibility'],
  descriptionForModel: `Visual QA is active after UI changes.

Exercise the changed page or component in a browser-like surface and capture evidence. Check desktop and narrow mobile widths, text clipping, overlapping controls, focus rings, contrast, disabled/loading/empty/error states, and whether dynamic data changes resize fixed controls. If automated screenshot tooling is unavailable, state that plainly and run the closest component or browser test available.`,
});

const lspManifest = promptSkill({
  name: 'lsp',
  displayName: 'lsp',
  description: 'Language-server diagnostics, definitions, references, and rename-safety guidance.',
  capabilities: ['lsp.diagnostics', 'lsp.references', 'lsp.rename'],
  descriptionForModel: `LSP is active when diagnostics or symbol safety matter.

Use language-server diagnostics to validate changed files when available. Prefer definitions and references over text search for rename-sensitive work. Treat stale diagnostics as a signal to rerun typecheck or reopen the changed file, not as proof of success. Never suppress diagnostics with comments; fix the underlying type, import, or contract.`,
});

const astGrepManifest = promptSkill({
  name: 'ast-grep',
  displayName: 'ast-grep',
  description:
    'AST-aware search/rewrite guidance for structural code queries and deterministic codemods.',
  capabilities: ['code.ast-search', 'code.codemod'],
  descriptionForModel: `ast-grep is active for structural code search or codemods.

Use AST-shaped queries when the target is syntax rather than plain text: function calls, imports, JSX attributes, class members, empty catch blocks, missing awaits, or unsafe casts. Keep rewrites deterministic and scoped, then run formatter, typecheck, and targeted tests. Use plain text search for comments, filenames, string contents, and quick literal lookup.`,
});

const rulesManifest = promptSkill({
  name: 'rules',
  displayName: 'rules',
  description:
    'Project and workspace rules guidance: discover applicable instructions and obey the deepest matching scope.',
  capabilities: ['rules.discovery', 'rules.compliance'],
  descriptionForModel: `Rules is active when project instructions, AGENTS files, or scoped conventions affect work.

Before editing, identify the rules that apply to the target path and follow the most specific scope. User instructions override repository defaults, but safety and type-safety constraints remain binding. Do not edit generated or read-only evidence directories unless the task explicitly targets them. If rules conflict, state the conflict and choose the narrower or newer instruction.`,
});

const noopExecutor: SkillExecutor = async (): Promise<ToolResult> => {
  return {
    content: 'This is a prompt-based skill. Content is injected via descriptionForModel.',
    isError: false,
  };
};

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  { manifest: gitMasterManifest, executor: noopExecutor },
  { manifest: reviewWorkManifest, executor: noopExecutor },
  { manifest: programmingManifest, executor: noopExecutor },
  { manifest: frontendManifest, executor: noopExecutor },
  { manifest: visualQaManifest, executor: noopExecutor },
  { manifest: lspManifest, executor: noopExecutor },
  { manifest: astGrepManifest, executor: noopExecutor },
  { manifest: rulesManifest, executor: noopExecutor },
];
