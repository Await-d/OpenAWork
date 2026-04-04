# File Change Durability Rollout Checklist

## Scope

This checklist governs rollout readiness for the conversation-level file change durability system in `@openAwork/agent-gateway`.

Covered capabilities:

- durable `session_file_diffs`
- `session_snapshots`
- `session_file_backups`
- restore preview / apply routes
- UI read model and debug surface split

## Pre-Rollout Gates

Run all of the following before gateway rollout:

```bash
pnpm --filter @openAwork/agent-gateway run test:file-changes
pnpm --filter @openAwork/agent-gateway run test:restore
pnpm --filter @openAwork/agent-gateway run test:delete-cleanup
pnpm --filter @openAwork/agent-gateway run test:durable
pnpm --filter @openAwork/agent-gateway build
```

## Runtime Flags

| Variable                               | Default                              | Meaning                                                                                                        |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `OPENAWORK_DATA_DIR`                   | platform data dir + `/agent-gateway` | Gateway durable data root (SQLite, artifacts, file backups)                                                    |
| `OPENAWORK_DATABASE_PATH`              | `<OPENAWORK_DATA_DIR>/openAwork.db`  | Optional explicit SQLite file override                                                                         |
| `OPENAWORK_FILE_BACKUP_FAILURE_POLICY` | `block`                              | Backup write failure blocks write paths when `block`, degrades to `backupBeforeRef = undefined` when `degrade` |

## Rollout Checks

Before enabling gateway rollout:

- [ ] `session_file_backups` rows are being created for `edit/write/file_write/write_file/workspace_write_file/apply_patch`
- [ ] `backup_before_ref_json` is present in `session_file_diffs` for eligible write paths
- [ ] `session_snapshots.summary.backupBeforeRefs` is non-empty for restore/apply and backup-capable writes
- [ ] `restore/preview` returns `hashValidation` and `workspaceReview`
- [ ] `/sessions/:id/file-changes/read-model` returns only UI-safe fields

## Monitoring Signals

Track these during rollout:

- gateway 4xx/5xx rate for:
  - `/sessions/:id/restore/preview`
  - `/sessions/:id/restore/apply`
  - `/sessions/:id/file-changes*`
- count of backup capture degradations (`OPENAWORK_FILE_BACKUP_FAILURE_POLICY=degrade` only)
- growth of `<OPENAWORK_DATA_DIR>/file-backups/` on disk
- count of `session_file_backups` rows without matching `storage_path` file
- count of restore apply responses with `409`

## Rollback Guidance

If restore/apply or backup capture regresses:

1. Set `OPENAWORK_FILE_BACKUP_FAILURE_POLICY=block` in production if not already.
2. Stop rollout progression.
3. Re-run:

```bash
pnpm --filter @openAwork/agent-gateway run test:restore
pnpm --filter @openAwork/agent-gateway run test:delete-cleanup
pnpm --filter @openAwork/agent-gateway run test:durable
```

4. Roll back gateway to previous version if failures reproduce.

## Post-Rollout Validation

- [ ] At least one real write path produced backup rows, durable diffs, and snapshots in production/staging
- [ ] At least one restore preview and one restore apply completed successfully
- [ ] At least one session delete reclaimed orphaned backup files
