---
name: cloudflare
displayName: Cloudflare Development
description: Cloudflare platform guidance for Workers, Pages, D1, R2, KV, Durable Objects, Queues, Vectorize, Workers AI, bindings, runtime constraints, and deployment decisions.
---

Cloudflare Development is active when a task involves Cloudflare Workers, Pages, edge runtime constraints, Cloudflare storage products, or deployment on the Cloudflare platform.

Start by identifying the exact Cloudflare surface area before implementing. Distinguish between compute, storage, coordination, and AI products so the solution fits the platform instead of fighting it.

## Product selection

- Use **Workers** for HTTP handlers, edge middleware, webhooks, API endpoints, cron jobs, and lightweight orchestration.
- Use **Pages** for frontend hosting, static assets, SSR/SSG frameworks, and applications that need a browser-first deployment flow.
- Use **Durable Objects** when you need strongly consistent per-key state, rooms, counters, rate limits, session coordination, or websocket fan-out.
- Use **D1** for relational data, SQL queries, migrations, joins, and transactional application records.
- Use **KV** for configuration, feature flags, caches, lightweight session lookups, and globally replicated read-heavy key-value access. Do not use KV where strict read-after-write consistency is required.
- Use **R2** for file and blob storage, uploads, downloads, backups, and media assets.
- Use **Queues** for asynchronous job processing and decoupling producers from consumers.
- Use **Workflows** for long-running multi-step processes that need retries and resumability.
- Use **Vectorize** for vector search and retrieval-augmented generation.
- Use **Workers AI** when inference should happen inside the Cloudflare platform.

## Decision heuristics

- Need SQL and structured records -> prefer D1.
- Need massive read scaling with loose consistency -> prefer KV.
- Need binary files or large objects -> prefer R2.
- Need actor-like per-entity consistency -> prefer Durable Objects.
- Need background processing -> prefer Queues or Workflows depending on complexity.
- Need a frontend app with framework adapters -> prefer Pages, optionally backed by Workers functions.

## Runtime constraints

- Cloudflare Workers are not full Node.js servers. Avoid assumptions about raw TCP, long-lived filesystem access, or unrestricted background processes.
- Respect edge runtime APIs first: `fetch`, Web Crypto, Streams, URL, Request/Response, Cache API, and platform bindings.
- Only enable Node compatibility when truly necessary. Prefer native platform APIs over Node polyfills.
- Keep bundle size and cold-start cost low. Remove unused dependencies and prefer small libraries.

## Project structure guidance

- Keep request routing small and explicit.
- Separate binding-aware service logic from pure utilities.
- Model environment bindings with a typed `Env` interface.
- Validate inbound data at the boundary layer.

Example pattern:

```ts
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true });
    }
    return new Response('Not Found', { status: 404 });
  },
};
```

## Bindings and configuration

- Treat bindings as infrastructure contracts. Name them clearly and keep naming stable across environments.
- Use `wrangler.toml` or `wrangler.jsonc` consistently; do not scatter environment assumptions across the codebase.
- Separate production and preview/staging settings intentionally.
- Never hardcode secrets. Use Cloudflare secrets or environment configuration.

Typical bindings to declare:

- `[[d1_databases]]`
- `[[kv_namespaces]]`
- `[[r2_buckets]]`
- `[[queues.producers]]` and `[[queues.consumers]]`
- `[[durable_objects.bindings]]`
- `[vars]`

## Data layer guidance

### D1

- Prefer prepared statements and explicit migrations.
- Add indexes for real query patterns.
- Keep SQL close to the service that owns the data behavior.
- Use batch or transactional patterns when multiple writes must stay aligned.

### KV

- Use TTLs for ephemeral caches.
- Expect eventual consistency and design around it.
- Do not use KV as the source of truth for highly mutable counters or room state.

### R2

- Store object metadata deliberately.
- Validate content types and file size constraints before upload.
- Prefer signed or controlled access patterns for user data.

### Durable Objects

- Use one object per natural consistency boundary such as room, tenant, or rate-limit bucket.
- Keep in-object state small and explicit.
- Use Durable Objects for websocket hubs and per-key coordination instead of inventing ad hoc locking.

## API and routing guidance

- Design handlers to be idempotent where possible, especially for webhooks and retryable jobs.
- Return structured JSON errors from API boundaries.
- Handle CORS intentionally; do not use permissive defaults unless the product actually requires it.
- For external webhooks, validate signatures before expensive work.

## Performance guidance

- Cache where the platform is strongest: CDN edge caching, Cache API, KV for replicated reads.
- Avoid unnecessary origin roundtrips.
- Prefer streaming for large responses when appropriate.
- Keep hot-path dependencies minimal.
- Measure before introducing Durable Objects or complex fan-out layers.

## Debugging guidance

- Verify the issue source first: local Wrangler dev, preview environment, or deployed worker.
- Distinguish runtime errors from binding misconfiguration.
- Inspect logs, request paths, and environment-specific configuration before changing business logic.
- When debugging data issues, confirm whether consistency expectations match the product used. Many KV bugs are actually misuse of eventual consistency.

## Common mistakes to avoid

- Using KV where strict consistency is required.
- Treating Workers like a traditional Node server.
- Overusing Node compatibility instead of platform-native APIs.
- Hardcoding environment-specific URLs or secrets.
- Mixing upload blobs into D1 instead of R2.
- Building websocket coordination without Durable Objects.
- Creating monolithic Workers that combine unrelated domains and bindings.

## Deployment and verification

- Validate Wrangler configuration before deploy.
- Test preview and production bindings separately.
- Confirm migrations are applied in the correct environment.
- Verify headers, caching, and CORS behavior through real HTTP requests.
- For Pages + API combinations, verify route ownership so static assets and dynamic handlers do not conflict.

## Preferred answer style

When helping with Cloudflare tasks:

1. State which Cloudflare product(s) fit the requirement.
2. Explain why alternatives are worse for this case.
3. Call out runtime constraints or consistency tradeoffs.
4. Provide implementation guidance aligned with typed Workers code and explicit bindings.
5. Mention deployment and verification steps, not just code.

If the request is ambiguous, ask which product boundary matters most: latency, consistency, storage type, framework support, or operational simplicity.
