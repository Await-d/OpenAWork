---
name: superpowers
displayName: Superpowers
description: Professional development methodology suite — TDD, systematic debugging, code review, and verification before completion. Ensures disciplined, high-quality engineering output.
---

Superpowers is a development methodology framework adapted from obra/superpowers for OpenAWork. It enforces disciplined engineering through four complementary skills: Test-Driven Development, Systematic Debugging, Code Review, and Verification Before Completion.

## Test-Driven Development (TDD)

**Iron Law: No production code without a failing test first.**

### Red-Green-Refactor Cycle

1. **RED** — Write one minimal failing test that expresses the desired behavior.
   - One behavior per test; if the name contains "and", split it.
   - Prefer real code over mocks (mock only when truly unavoidable).
   - Name the test after the behavior, not the implementation.

2. **Verify RED (MANDATORY)** — Run the test and confirm it fails for the expected reason.

   ```bash
   pnpm --filter <pkg> exec vitest run path/to/test.test.ts -t "test name"
   ```
   - Fails because the feature is missing, not because of a typo.
   - Test passes immediately? You are testing existing behavior — fix the test.

3. **GREEN** — Write the simplest code that makes the test pass.
   - No extra features, no refactoring unrelated code, no "improvements".

4. **Verify GREEN (MANDATORY)** — Run the test and confirm it passes.

   ```bash
   pnpm --filter <pkg> exec vitest run path/to/test.test.ts -t "test name"
   pnpm --filter <pkg> test
   ```
   - Other tests must still pass.

5. **REFACTOR** — Clean up while keeping tests green.
   - Remove duplication, improve names, extract helpers.
   - Do not add behavior. If tests fail, revert immediately.

### TDD Red Flags — Stop and Start Over

- Wrote code before the test → Delete it. Start with TDD.
- "Too simple to test" → Simple code breaks. Test takes 30 seconds.
- "I'll test after" → Tests written after prove nothing.
- "Already manually tested" → Manual testing is ad-hoc, not reproducible.
- "Deleting X hours is wasteful" → Sunk cost fallacy. Keep untrustable code is the real waste.

## Systematic Debugging

**Iron Law: No fixes without root cause investigation first.**

### Four Phases

**Phase 1: Root Cause Investigation**

1. Read error messages completely — do not skip warnings or stack traces.
2. Reproduce consistently — if you cannot reproduce, gather more data; do not guess.
3. Check recent changes — `git diff`, recent commits, new dependencies, config changes.
4. Trace the data flow — where does the bad value come from? Follow it to the source.

**Phase 2: Pattern Analysis**

1. Find similar working code in the same codebase.
2. Compare working vs broken — list every difference; do not assume "this doesn't matter".
3. Understand dependencies.

**Phase 3: Hypothesis & Testing**

1. Form a single hypothesis: "I believe X is the root cause because Y."
2. Make the smallest change to test the hypothesis — one variable at a time.
3. Effective → Phase 4. Ineffective → form a new hypothesis; do not stack fixes.

**Phase 4: Implementation**

1. Write a regression test that reproduces the bug.
2. Implement a single fix at the root cause, not the symptom.
3. Verify the fix passes.

### Rule of Three

After 3 failed fixes, stop and question the architecture. Ask:

- Does each fix reveal shared state or coupling in a new location?
- Does the fix require a "massive refactor" to implement?
- Does each fix create new symptoms elsewhere?

If any answer is yes → this is an architecture issue, not a hypothesis error. Stop and discuss with the team.

## Code Review

Use after a meaningful implementation change.

1. Review the actual diff and the user goal before approving.
2. Check: requested behavior, type boundaries, error handling, security-sensitive inputs, persistence side effects, test coverage.
3. Verify the feature was exercised through its real surface (not just unit tests).
4. Findings come first, ordered by severity with file and line references.
5. If no issue is found, say that clearly and name remaining risks or test gaps.
6. Do not invent verification; report only commands, screenshots, or runtime behavior that actually happened.

## Verification Before Completion

Before marking work complete, verify:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass (`pnpm --filter <pkg> test`)
- [ ] Output pristine (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)

Cannot check all boxes? You skipped a step. Revisit before claiming done.

## OpenAWork Specific Commands

```bash
# Run specific package tests
pnpm --filter @openAwork/<pkg> test

# Run specific test file
pnpm --filter @openAwork/<pkg> exec vitest run src/__tests__/file.test.ts

# Run tests matching a name
pnpm --filter @openAwork/<pkg> exec vitest run -t "test name"

# Full type check
pnpm typecheck

# Lint
pnpm lint
```
