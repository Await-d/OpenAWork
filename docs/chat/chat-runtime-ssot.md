# Chat Runtime SSOT

## Purpose

This document freezes the runtime source-of-truth for OpenAWork chat capabilities that were integrated by referencing opencode.

## Permission SSOT

- **Authoritative interaction model**: `packages/agent-core/src/permission/index.ts`
- **Gateway persistence / transport**:
  - `services/agent-gateway/src/routes/permissions.ts`
  - `packages/web-client/src/permissions.ts`
- **Web read/write surfaces**:
  - `apps/web/src/components/Layout.tsx` for floating approval prompt
  - `apps/web/src/pages/ChatPage.tsx` for session-scoped runtime sections in the right panel

Rules:

1. Permission decisions are never made in the Web client.
2. The Web client only renders pending requests and posts replies.
3. Session-scoped permission state must come from gateway APIs, not local caches.

## Task-System ↔ Session Tree Mapping

- **Root session**: one session owns one task graph.
- **Child sessions**: identified by `metadata_json.parentSessionId` and exposed by `GET /sessions/:id/children`.
- **Session tasks**: exposed by `GET /sessions/:id/tasks` and represented by `SessionTask.sessionId`.

Gateway and Web surfaces:

- `services/agent-gateway/src/routes/sessions.ts`
- `services/agent-gateway/src/routes/commands.ts`
- `services/agent-gateway/src/routes/command-loop-runtime.ts`
- `apps/web/src/pages/ChatPage.tsx`

Rules:

1. Child-session visibility comes from gateway-computed session tree data.
2. Task visibility comes from gateway task endpoints backed by `agent-core` task-system.
3. Chat right panel sections must consume those gateway endpoints directly instead of reconstructing task/session relationships in browser state.

## Event Contract

The minimum runtime event set for Chat remains:

- `tool_call`
- `tool_result`
- `permission_asked`
- `permission_replied`
- `task_update`
- `session_child`
- `compaction`
- `audit_ref`

Realtime updates are delivered through stream events.

### Protocol SSOT

- **Primary replay source**: `services/agent-gateway/src/session-run-events.ts`
- **Request scope key**: `session_id + client_request_id + seq`
- **Primary replay path**: `services/agent-gateway/src/routes/stream.ts#replayPersistedAssistantResponse`

Rules:

1. Request-scoped `session_run_events` are the first-class replay source for a single chat request.
2. A request may be replayed directly from durable events only when that request has a terminal event (`done` or `error`).
3. `session_messages` remain a compatibility fallback for older data and partial recovery only; they are not the primary protocol SSOT.
4. Permission or task events from other requests must not be injected into a request-scoped replay path.
5. Durable `tool_result` and stream `tool_result` must share the same payload core (`toolCallId`, `toolName`, `output`, `isError`, optional `pendingPermissionRequestId`).

### Refresh / Recovery Surfaces

- **Primary event replay**: request-scoped durable events
- **Secondary durable reads**: gateway-backed `session/task/permission/children` reads
- **Browser normalization**: `apps/web/src/pages/chat-page/support.ts`

Rules:

1. Browser refresh recovery may use gateway snapshots for side panels, but protocol replay should prefer durable request-scoped events.
2. Golden transcript tests should lock representative tool_call/tool_result/pending-permission sequences to prevent protocol drift.
