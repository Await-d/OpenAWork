# Websearch Multi-Provider Rollout

> **Workflow lineage**: 260509-p2-并行websearch-rollout (core), 260509-opencode借鉴升级总览 (deferred follow-up T-WEB-08).
>
> Living reference for the three rollout modes the gateway exposes
> through `searchMultiProvider` and the user-facing settings panel
> at `/settings/websearch`.

## Why three modes

The single-provider call path (legacy `webSearchTool.execute`) only
talks to **one** backend. That works fine when the backend is healthy,
but every provider OpenAWork ships against has at least one degraded
state observed in production:

- **DuckDuckGo HTML** — silent rate limit, returns 200 with an empty
  results page.
- **Tavily / Exa / Serper** — quota exhaustion (402 / 429) on busy
  shared keys.
- **Google CSE / Bing** — geo-blocked search queries (regional
  variation in result coverage).

Multi-provider rollout fans the same query out to several backends
so a single degraded provider does not silently waste a turn. The
**rollout mode** controls how the responses are reconciled.

## The three modes

| Mode                         | Concurrency                             | Returns when…                                                     | Cost surface                    |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| **`sequential`** _(default)_ | 1 at a time                             | first provider in the list succeeds                               | 1× the first healthy provider   |
| **`first-success`**          | all in parallel                         | the first provider returns a non-empty result; losers are aborted | up to N× until the winner lands |
| **`merge`**                  | all in parallel, bounded by `timeoutMs` | every successful provider has returned (or `timeoutMs` elapsed)   | up to N× full searches per call |

### `sequential`

```text
[user] ──► duckduckgo ──fail──► tavily ──ok──► [llm]
```

- Cheapest. **No** parallel fan-out. Behaviour is identical to the
  legacy single-provider call when only one provider is configured.
- Pick when: cost matters, the providers are clearly tiered (a free
  primary + a paid fallback), and you'd rather wait an extra second
  than hit two paid backends.
- Failure model: each provider error is captured; the helper throws a
  combined `Error` only when **all** providers fail.

### `first-success`

```text
[user] ─┬─► duckduckgo ──fail──┐
        ├─► tavily ────ok─────┼──► [llm]   (exa is aborted)
        └─► exa ──in flight──ⓧ┘
```

- Lowest latency. As soon as **any** provider returns a non-empty
  result, the helper resolves and `AbortController.abort()`s the
  others.
- Pick when: you have multiple equivalently-good providers and you
  care more about latency than the marginal cost of letting them
  race.
- The "non-empty result" rule means a provider that returns "no
  results" is treated as a soft fail; the next provider that returns
  actual hits wins.

### `merge`

```text
[user] ─┬─► tavily   ──ok──┐
        ├─► exa      ──ok──┼──► dedupe by canonical URL ──► [llm]
        └─► serper   ──ok──┘    (highest weight wins title/snippet)
```

- Highest recall. Every provider's hits are merged into a single
  list, deduplicated by **canonical URL** (UTM stripped, fragments
  collapsed) and re-ranked by the per-provider `weight` so the
  authoritative source wins the title and snippet.
- When `timeoutMs` is set, the whole call is bounded by it — at the
  deadline every still-pending provider gets aborted and its hits
  are not folded in. **Without `timeoutMs` the merge waits for every
  provider to settle**; this is fine for healthy backends but
  becomes the worst-case latency once one provider hangs, so the
  schema accepts 1000–120000 ms when you want a hard cap.
- Pick when: you're researching and a wider list of unique URLs is
  worth the extra spend.

## When to pin a provider per call

The LLM can still set `provider` directly on the `websearch` tool
call. That pin **always wins** — the rollout policy is consulted only
when no `provider` is supplied. This lets the LLM say "use Tavily for
this regulatory question" while keeping the rollout in place for
ordinary requests.

## Settings shape

```jsonc
// PUT /settings/websearch
{
  "providers": [
    { "provider": "tavily", "apiKey": "tk-…", "weight": 3 },
    { "provider": "exa", "apiKey": "ex-…", "weight": 2 },
    { "provider": "duckduckgo" },
  ],
  "rolloutMode": "first-success",
  "timeoutMs": 8000, // only enforced by `merge`
}
```

- `providers` is an ordered list. `sequential` walks it head-to-tail.
  `first-success` and `merge` ignore order beyond the `weight`-based
  tie-break.
- `weight` is optional, default 1. Used by `merge` to pick the
  authoritative title/snippet for a URL that several providers
  returned.
- Up to 8 entries are allowed by the schema (`websearch-policy.ts`).
- An empty `providers: []` is a valid no-op — the legacy single-call
  path stays in effect for that user.

## Decision matrix the gateway uses

`createWebsearchTool` wraps the static tool definition. The factory
consults the policy resolver and **only** routes to
`searchMultiProvider` when:

1. The LLM did not supply a `provider` field on the call, AND
2. the user has at least one configured `providers[*]` entry, AND
3. either `rolloutMode !== 'sequential'` OR the configured list has
   2+ entries.

Single-provider sequential is functionally identical to the legacy
call, so the wrapper stays out of the way to avoid surprise.

## Observability

Each rollout call emits a structured log line:

```text
{
  "providers": ["tavily", "exa"],
  "durations": { "tavily": 612, "exa": 871 },
  "winner": "tavily",
  "mode": "first-success",
  "results": 7
}
```

Surfaced through the gateway's standard request-workflow logger.
Useful when triaging "why did the LLM see a stale page?".

## See also

- `services/agent-gateway/src/websearch-policy.ts` — Zod schema +
  default policy.
- `services/agent-gateway/src/tool-aliases.ts:createWebsearchTool` —
  per-call routing decision.
- `packages/agent-core/src/tools/web-search.ts:searchMultiProvider` —
  the dispatcher that owns the three modes.
- `services/agent-gateway/src/__tests__/websearch-policy.test.ts` —
  routing and schema regression coverage (11 cases).
