# OpenAWork On-Call Runbook

## Severity Levels

| Level | Definition                               | Response Time     |
| ----- | ---------------------------------------- | ----------------- |
| P0    | Complete outage, all users affected      | 15 min            |
| P1    | Degraded service, >25% users affected    | 30 min            |
| P2    | Partial degradation, <25% users affected | 2 hours           |
| P3    | Minor issue, workaround exists           | Next business day |

---

## Incident Response SOP

### Step 1: Assess

1. Check `/health` endpoint: `curl https://gateway.openwork.app/health`
2. Check Sentry for error spike: [Sentry Dashboard]
3. Check infra metrics (CPU, memory, DB connections)
4. Determine severity level

### Step 2: Communicate

- P0/P1: Post to `#incidents` Slack channel immediately
- Template:
  ```
  🚨 [P{level}] {title}
  Status: Investigating
  Impact: {description}
  Started: {time}
  IC: @{your-name}
  ```

### Step 3: Mitigate

Choose the appropriate playbook below.

---

## Playbook A: Gateway Down

**Symptoms:** `/health` returns non-200, WebSocket connections failing, mobile/web apps show connection error.

```bash
# 1. Check gateway logs
docker logs agent-gateway --tail 100

# 2. Restart gateway (if OOM or crash loop)
docker restart agent-gateway

# 3. If durable storage looks unavailable — inspect gateway data root
export OPENAWORK_DATA_ROOT="${OPENAWORK_DATA_DIR:-$HOME/.local/share/OpenAWork/agent-gateway}"
export OPENAWORK_DB_PATH="${OPENAWORK_DATABASE_PATH:-$OPENAWORK_DATA_ROOT/openAwork.db}"
ls -lah "$OPENAWORK_DATA_ROOT"
sqlite3 "$OPENAWORK_DB_PATH" "SELECT 1;"

# 4. If Redis unreachable
redis-cli -u $REDIS_URL ping

# 5. Rollback to previous image
docker pull ghcr.io/openwork/agent-gateway:$PREVIOUS_TAG
docker stop agent-gateway
docker run -d --name agent-gateway ... ghcr.io/openwork/agent-gateway:$PREVIOUS_TAG
```

**Rollback time target:** ≤ 15 minutes

---

## Playbook B: Model API Degraded

**Symptoms:** Streaming responses fail with `MODEL_ERROR`, high latency, 429/500 from model provider.

```bash
# 1. Check which provider is failing
# Look for error codes in gateway logs
grep 'MODEL_ERROR\|rate_limit\|overloaded' /var/log/gateway.log | tail -50

# 2. Switch to fallback model via env var (no restart needed if hot-reload enabled)
export DEFAULT_MODEL=claude-3-haiku-20240307  # cheaper/faster fallback
export FALLBACK_PROVIDER=anthropic

# 3. If rate-limited by primary provider:
# Update PROVIDER_API_KEY to backup key, or switch provider route
# Edit: services/agent-gateway/src/model-router.ts -> resolveModelRoute()

# 4. Communicate to users via in-app banner (set env var)
export MAINTENANCE_BANNER="AI responses may be slower than usual. We are working on it."
```

**Recovery:** Monitor error rate drops below 1% before reverting fallback.

---

## Playbook C: Mobile App Crash Spike

**Symptoms:** Sentry crash rate > 2%, users reporting app crashes.

```bash
# 1. Check Sentry release health
# Navigate to: Sentry > Releases > mobile-v{version}

# 2. If crash rate > 5% within 1 hour of release: ROLLBACK
# Trigger EAS rollback update:
eas update --branch production --message "rollback: revert to stable" \
  --environment production

# 3. Or pin users to previous OTA update channel:
eas channel:rollout --channel production --percent 0

# 4. Push hotfix OTA (does not require App Store review for JS-only fixes):
# Fix the issue, then:
eas update --branch production --message "hotfix: {description}"

# 5. If the hotfix requires a new native/app version, do NOT edit version files manually.
# Use GitHub Actions > Prepare Release
#   - mobile-production   (store/native release)
#   - mobile-preview      (preview validation)
#   - fill release_notes in Chinese so the workflow can generate a temporary release draft
```

**Rollback time target:** ≤ 15 minutes (OTA), ≤ 7 days (native/store)

---

## Playbook D: Desktop Auto-Update Failure

**Symptoms:** Users stuck on old version, updater shows error.

```bash
# 1. Check the updater JSON endpoint is reachable:
curl https://github.com/openwork/openAwork/releases/latest/download/latest.json

# 2. If JSON is malformed or missing, re-run the release workflow:
# GitHub Actions > Release Desktop > Re-run

# If a brand new desktop version must be cut, do NOT manually edit version files.
# Use GitHub Actions > Prepare Release > desktop-preview / desktop-stable
# Prepare Release will also require Chinese release_notes and generate a temporary release draft for the workflow

# 3. If signing cert expired:
# Renew TAURI_SIGNING_PRIVATE_KEY in GitHub Secrets
# Re-run release to produce newly signed artifacts

# 4. Force users to re-download if auto-update is broken:
# Update docs/web-deployment.md with download links
# Post in-app banner via MAINTENANCE_BANNER env var
```

---

## Playbook E: SQLite Lock / Data Root Saturation

**Symptoms:** `database is locked`, SQLite open failures, disk full errors, or gateway returning 500 during durable writes.

```bash
# 1. Resolve effective gateway data locations
export OPENAWORK_DATA_ROOT="${OPENAWORK_DATA_DIR:-$HOME/.local/share/OpenAWork/agent-gateway}"
export OPENAWORK_DB_PATH="${OPENAWORK_DATABASE_PATH:-$OPENAWORK_DATA_ROOT/openAwork.db}"

# 2. Check DB accessibility and WAL side files
ls -lah "$OPENAWORK_DATA_ROOT"
sqlite3 "$OPENAWORK_DB_PATH" "PRAGMA journal_mode; SELECT count(*) FROM sessions;"

# 3. Check backup growth / disk pressure
du -sh "$OPENAWORK_DATA_ROOT" "$OPENAWORK_DATA_ROOT/file-backups" 2>/dev/null
df -h "$OPENAWORK_DATA_ROOT"

# 4. If the volume is unhealthy or full, free space / remount / move OPENAWORK_DATA_DIR
docker restart agent-gateway
```

---

## Escalation Path

```
On-call Engineer
    → Team Lead (P0/P1 unresolved after 30 min)
        → Engineering Manager (P0 unresolved after 1 hour)
            → CTO (business impact, public communication needed)
```

## Playbook F: File Change Durability / Restore Chain Regression

**Symptoms:** `restore/preview` or `restore/apply` returns unexpected 409/500, backups stop being written, or session delete leaves the gateway `file-backups/` directory growing unexpectedly.

```bash
# Resolve effective gateway data locations
export OPENAWORK_DATA_ROOT="${OPENAWORK_DATA_DIR:-$HOME/.local/share/OpenAWork/agent-gateway}"
export OPENAWORK_DB_PATH="${OPENAWORK_DATABASE_PATH:-$OPENAWORK_DATA_ROOT/openAwork.db}"

# 1. Re-run gateway durability verification
pnpm --filter @openAwork/agent-gateway run test:restore
pnpm --filter @openAwork/agent-gateway run test:delete-cleanup
pnpm --filter @openAwork/agent-gateway run test:durable

# 2. Inspect backup rows for recent failures
sqlite3 "$OPENAWORK_DB_PATH" "SELECT backup_id, session_id, file_path, content_tier, created_at FROM session_file_backups ORDER BY created_at DESC LIMIT 20;"

# 3. Inspect durable diff rows missing backup refs
sqlite3 "$OPENAWORK_DB_PATH" "SELECT session_id, client_request_id, file_path FROM session_file_diffs WHERE backup_before_ref_json IS NULL ORDER BY created_at DESC LIMIT 20;"

# 4. Force safest behavior for backup writes
export OPENAWORK_FILE_BACKUP_FAILURE_POLICY=block

# 5. If restore/apply remains broken, stop gateway rollout and roll back
```

**Recovery target:** restore preview/apply and backup GC checks return to green before resuming rollout.

## Post-Incident

1. Resolve the incident in Sentry/PagerDuty
2. Update `#incidents` with resolution summary
3. File post-mortem using `docs/postmortem-template.md` within 48 hours
4. Add runbook updates if new failure mode discovered
