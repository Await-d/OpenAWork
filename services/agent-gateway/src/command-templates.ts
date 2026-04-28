/**
 * Command Templates
 *
 * Ported from oh-my-opencode's builtin-commands/templates.
 * These templates provide detailed workflow instructions that get injected
 * into the LLM conversation when a slash command is executed.
 *
 * In oh-my-opencode, these were injected via the command template system.
 * In OpenAWork, they're injected as synthetic context in the user message
 * when the corresponding command metadata is detected.
 */

// ---------------------------------------------------------------------------
// /ralph-loop
// ---------------------------------------------------------------------------

export const RALPH_LOOP_INSTRUCTION = `You are starting a Ralph Loop - a self-referential development loop that runs until task completion.

## How Ralph Loop Works

1. You will work on the task continuously
2. When you believe the task is FULLY complete, output: \`<promise>DONE</promise>\`
3. If you don't output the promise, the loop will automatically inject another prompt to continue
4. Maximum iterations: 100 (default)

## Rules

- Focus on completing the task fully, not partially
- Don't output the completion promise until the task is truly done
- Each iteration should make meaningful progress toward the goal
- If stuck, try different approaches
- Use todos to track your progress

## Exit Conditions

1. **Completion**: Output your completion promise tag when fully complete
2. **Max Iterations**: Loop stops automatically at limit
3. **Cancel**: User runs \`/cancel-ralph\` command`;

export const CANCEL_RALPH_INSTRUCTION = `Cancel the currently active Ralph Loop.

This will:
1. Stop the loop from continuing
2. Clear the loop state file
3. Allow the session to end normally

Check if a loop is active and cancel it. Inform the user of the result.`;

// ---------------------------------------------------------------------------
// /ulw-loop (ultrawork loop variant)
// ---------------------------------------------------------------------------

export const ULW_LOOP_INSTRUCTION = `You are starting an UltraWork Loop - a high-intensity development loop with verification.

## How UltraWork Loop Works

1. **Phase 1 - Execution**: Work on the task continuously with ultrawork intensity
2. When Phase 1 is complete, output: \`<promise>DONE</promise>\`
3. **Phase 2 - Verification**: A verification step will check your work
4. If verification passes, output: \`<promise>VERIFIED</promise>\`
5. If verification fails, you must fix the issues and re-verify

## Rules

- Ultrawork mode: maximum focus, no unnecessary explanations
- Complete the task fully before signaling completion
- Every claim must be verified with evidence (test runs, diagnostics, etc.)
- Use todos to track your progress
- After completion, prepare for verification by listing what was changed and how to verify

## Exit Conditions

1. **Verified**: Output \`<promise>VERIFIED</promise>\` after successful verification
2. **Max Iterations**: Loop stops automatically at limit
3. **Cancel**: User runs \`/cancel-ralph\` command`;

// ---------------------------------------------------------------------------
// /start-work
// ---------------------------------------------------------------------------

export const START_WORK_INSTRUCTION = `You are starting a Sisyphus work session.

## WHAT TO DO

1. **Find available plans**: Search for Prometheus-generated plan files at \`.sisyphus/plans/\`

2. **Check for active boulder state**: Read \`.sisyphus/boulder.json\` if it exists

3. **Decision logic**:
   - If \`.sisyphus/boulder.json\` exists AND plan is NOT complete (has unchecked boxes):
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan files
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Create/Update boulder.json** with the active plan info

5. **Read the plan file** and start executing tasks according to Orchestrator Sisyphus workflow

## CRITICAL

- Always update boulder.json BEFORE starting work
- Read the FULL plan file before delegating any tasks
- Follow Orchestrator Sisyphus delegation protocols`;

// ---------------------------------------------------------------------------
// /init-deep
// ---------------------------------------------------------------------------

export const INIT_DEEP_INSTRUCTION = `Generate hierarchical AGENTS.md files. Root + complexity-scored subdirectories.

## Usage

\`\`\`
/init-deep                      # Update mode: modify existing + create new where warranted
/init-deep --create-new         # Read existing → remove all → regenerate from scratch
/init-deep --max-depth=2        # Limit directory depth (default: 3)
\`\`\`

## Workflow

1. **Discovery + Analysis** (concurrent)
   - Fire background explore agents immediately
   - Main session: bash structure + LSP codemap + read existing AGENTS.md
2. **Score & Decide** - Determine AGENTS.md locations from merged findings
3. **Generate** - Root first, then subdirs in parallel
4. **Review** - Deduplicate, trim, validate

## Scoring Matrix

| Factor | Weight | High Threshold | Source |
|--------|--------|----------------|--------|
| File count | 3x | >20 | bash |
| Subdir count | 2x | >5 | bash |
| Code ratio | 2x | >70% | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has index.ts/__init__.py | bash |
| Symbol density | 2x | >30 symbols | LSP |

## Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

## Quality Gates

- Root AGENTS.md: 50-150 lines, no generic advice, no obvious info
- Subdirectory AGENTS.md: 30-80 lines max, NEVER repeat parent content
- Sections: OVERVIEW (1 line), STRUCTURE, WHERE TO LOOK, CONVENTIONS, ANTI-PATTERNS

## Anti-Patterns

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST parallel (explore + LSP concurrent)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects`;

// ---------------------------------------------------------------------------
// /refactor
// ---------------------------------------------------------------------------

export const REFACTOR_INSTRUCTION = `Intelligent Refactoring Command — deterministic refactoring with full codebase awareness.

## Phases

### PHASE 0: INTENT GATE (MANDATORY FIRST STEP)
- Parse request type: explicit file/symbol, clear transformation, or open-ended
- If open-ended ("improve", "clean up"), **MUST ask** for specific improvement
- Create initial todos for all phases

### PHASE 1: CODEBASE ANALYSIS (PARALLEL)
- Launch parallel explore agents for: target, dependencies, similar patterns, tests, architecture
- Use LSP tools: LspGotoDefinition, LspFindReferences, LspDocumentSymbols
- Use AST-grep: ast_grep_search for structural patterns
- Collect all background results

### PHASE 2: BUILD CODEMAP
- Construct definitive codemap: core files, dependency graph, impact zones
- Identify refactoring constraints: must follow, must not break, safe to change

### PHASE 3: TEST ASSESSMENT
- Detect test infrastructure and analyze coverage
- Determine verification strategy based on coverage level:
  - HIGH (>80%): Run existing tests after each step
  - MEDIUM (50-80%): Run tests + add safety assertions
  - LOW (<50%): **PAUSE** — propose adding tests first
  - NONE: **BLOCK** — refuse aggressive refactoring

### PHASE 4: PLAN GENERATION
- Invoke Plan agent for detailed refactoring plan
- Review and validate plan completeness
- Register detailed todos for each step

### PHASE 5: EXECUTE REFACTORING
- For EACH step: read → edit → verify (lsp_diagnostics + tests + type check)
- If verification fails: STOP, REVERT, DIAGNOSE
- Commit at logical checkpoints

### PHASE 6: FINAL VERIFICATION
- Full test suite, type check, lint check, build verification
- Generate summary of changes and verification results

## CRITICAL RULES

- NEVER skip lsp_diagnostics check after changes
- NEVER proceed with failing tests
- ALWAYS preview before applying (ast_grep dryRun=true)
- ALWAYS follow existing codebase patterns
- 3 consecutive verification failures → STOP and consult user`;

// ---------------------------------------------------------------------------
// Template resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the command instruction template based on command action kind.
 * Returns the instruction text to inject, or null if no template exists.
 */
export function resolveCommandInstruction(
  actionKind: string,
  metadata: Record<string, unknown>,
): string | null {
  switch (actionKind) {
    case 'start_ralph_loop':
      return RALPH_LOOP_INSTRUCTION;
    case 'start_ulw_loop':
      return ULW_LOOP_INSTRUCTION;
    case 'cancel_ralph_loop':
      return CANCEL_RALPH_INSTRUCTION;
    case 'start_work':
      return START_WORK_INSTRUCTION;
    case 'init_deep':
      return INIT_DEEP_INSTRUCTION;
    case 'refactor_session':
      return REFACTOR_INSTRUCTION;
    default:
      return null;
  }
}

/**
 * Check if session metadata indicates an active command that needs
 * its instruction template injected into the next model round.
 */
export function detectActiveCommandContext(
  metadataJson: string,
): { actionKind: string; instruction: string } | null {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(metadataJson);
  } catch {
    return null;
  }

  // Check for active loop
  if (meta.ralphLoopActive || meta.activeLoopKind === 'ralph') {
    return { actionKind: 'start_ralph_loop', instruction: RALPH_LOOP_INSTRUCTION };
  }
  if (meta.ulwLoopActive || meta.activeLoopKind === 'ulw') {
    return { actionKind: 'start_ulw_loop', instruction: ULW_LOOP_INSTRUCTION };
  }

  // Check for active refactor
  if (meta.refactorStartedAt && !meta.refactorCompletedAt) {
    return { actionKind: 'refactor_session', instruction: REFACTOR_INSTRUCTION };
  }

  // Check for active start-work
  if (meta.startWorkAt && !meta.startWorkCompletedAt) {
    return { actionKind: 'start_work', instruction: START_WORK_INSTRUCTION };
  }

  return null;
}
