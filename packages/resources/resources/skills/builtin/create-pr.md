---
name: create-pr
displayName: Create PR
description: Automated GitHub Pull Request creation with conventional commit formatting, CI verification, and structured PR descriptions. Integrates with OpenAWork commit conventions.
---

Create PR automates the GitHub Pull Request workflow — from branch analysis to PR creation — following OpenAWork's conventions and best practices.

## When to Use

- After completing a feature branch and needing to open a PR
- When the user says "create PR", "open PR", "submit PR", or "提交 PR"
- After a code review cycle when changes need to be merged

## Prerequisites

Before creating a PR:

1. **All changes must be committed** — verify with `git status` that the working tree is clean.
2. **All tests must pass** — run `pnpm test` for affected packages.
3. **Type check must pass** — run `pnpm typecheck`.
4. **Lint must pass** — run `pnpm lint`.

If any of these fail, fix them before proceeding.

## PR Creation Workflow

### Step 1: Analyze the Branch

```bash
# Check current branch and status
git status
git log main..HEAD --oneline

# Understand what changed
git diff main...HEAD --stat
```

- Identify the scope of changes across all commits.
- Determine the primary type (feat, fix, refactor, etc.) from the commits.

### Step 2: Generate PR Title

PR title must follow OpenAWork's Conventional Commit format:

```
type(scope): 中文描述
```

**Rules:**

- `type` must be one of: `feat | fix | docs | style | refactor | perf | test | build | chore | ci | revert | release`
- `scope` is required and lowercase — use module/package/app name (e.g., `gateway`, `web`, `shared-ui`, `agent-core`)
- Description must start with a Chinese character
- Max length: 100 characters
- Summarize all commits into one concise title

**Examples:**

```
feat(gateway): 新增GitHub路由支持
fix(agent-core): 修复状态机在重试时的死锁问题
refactor(shared-ui): 拆分SettingsPage为独立子组件
```

### Step 3: Generate PR Description

Use this template:

```markdown
## 变更概述

[1-2 句话描述这个 PR 做了什么]

## 变更内容

- [变更1]
- [变更2]
- [变更3]

## 影响范围

- 影响的包/模块：[列出]
- 是否有 breaking change：是/否
- 是否需要数据库迁移：是/否

## 测试

- [ ] 单元测试通过
- [ ] 类型检查通过
- [ ] Lint 通过
- [ ] 手动测试场景：[描述]

## 关联 Issue

Closes #[issue_number]
```

### Step 4: Create the PR

```bash
# Push the branch (if not already pushed)
git push -u origin HEAD

# Create PR via GitHub CLI
gh pr create --title "type(scope): 中文描述" --body "PR description here"

# Or with specific base branch
gh pr create --base main --title "type(scope): 中文描述" --body "PR description here"
```

### Step 5: Verify PR

After creation:

1. Confirm the PR URL is returned.
2. Check that CI checks are triggered.
3. Verify the diff looks correct.

## Scope Resolution Guide

| Change location            | scope            |
| -------------------------- | ---------------- |
| `packages/agent-core/`     | `agent-core`     |
| `packages/shared-ui/`      | `shared-ui`      |
| `packages/shared/`         | `shared`         |
| `packages/skill-registry/` | `skill-registry` |
| `packages/multi-agent/`    | `multi-agent`    |
| `packages/web-client/`     | `web-client`     |
| `services/agent-gateway/`  | `gateway`        |
| `apps/web/`                | `web`            |
| `apps/desktop/`            | `desktop`        |
| `apps/mobile/`             | `mobile`         |
| Multiple packages          | `all`            |
| CI / GitHub Actions        | `ci`             |
| Documentation only         | `docs`           |

## Multi-Package Changes

When changes span multiple packages:

1. Use `all` as scope if changes are broadly related.
2. Otherwise, split into multiple PRs by scope — each PR should be independently reviewable.
3. If splitting is impractical, use the scope of the primary package changed.

## Common Pitfalls

- **Do not** use English-only PR titles — commitlint will reject them.
- **Do not** forget the scope — it is required.
- **Do not** create PRs with failing CI — fix tests first.
- **Do not** mix unrelated changes in one PR — keep it focused.
- **Do not** include Sisyphus collaboration traces in commit messages.
