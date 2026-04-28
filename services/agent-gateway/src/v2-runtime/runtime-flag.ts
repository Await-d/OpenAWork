/**
 * Runtime flag — central entry for the staged opencode-alignment migration.
 *
 * Phases 3 / 4 / 5 introduce new runtime backends (Drizzle ORM storage,
 * Vercel AI SDK upstream, Effect-TS service layer) that need to ship behind
 * a feature flag so we can switch a single deployment between the legacy
 * code paths and the new ones without redeploying.
 *
 * Today the only consumer is internal: reading the flag is a side-effect
 * free way for upcoming `v2-runtime/*` modules to know whether they should
 * activate. Production code keeps running on `'v1'` until each phase is
 * fully wired up and verified.
 *
 *   OPENAWORK_RUNTIME=v1  → legacy stack (default)
 *   OPENAWORK_RUNTIME=v2  → opencode-aligned stack (Drizzle + AI SDK + Effect)
 *
 * Sub-flags can override granularly:
 *   OPENAWORK_RUNTIME_STORAGE   = v1 | v2
 *   OPENAWORK_RUNTIME_UPSTREAM  = v1 | v2
 *   OPENAWORK_RUNTIME_SERVICES  = v1 | v2
 *
 * Sub-flags fall back to the global flag when unset, allowing teams to
 * roll out one layer at a time (e.g. `OPENAWORK_RUNTIME=v1` plus
 * `OPENAWORK_RUNTIME_STORAGE=v2`).
 */

export type RuntimeVariant = 'v1' | 'v2';

const RUNTIME_VARIANTS: ReadonlySet<RuntimeVariant> = new Set(['v1', 'v2']);

export interface RuntimeFlags {
  /** Global default — used when a sub-flag is unset. */
  global: RuntimeVariant;
  /** Storage / persistence layer (Drizzle vs node:sqlite raw). */
  storage: RuntimeVariant;
  /** Upstream LLM call layer (AI SDK vs self-rolled SSE). */
  upstream: RuntimeVariant;
  /** Service-layer orchestration (Effect-TS vs imperative async/await). */
  services: RuntimeVariant;
  /**
   * Optional providerType allowlist for the v2 upstream rollout.
   *
   *   OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS=anthropic,openai
   *
   * When set, the v2 upstream path is only taken for routes whose
   * `providerType` is in this list — every other route still runs
   * v1 even though `OPENAWORK_RUNTIME_UPSTREAM=v2` is on. Empty (the
   * default) means "all providerTypes are eligible" so existing
   * deployments are unaffected.
   */
  upstreamProviderAllowlist: ReadonlySet<string>;
}

/**
 * Parse a single env value into a `RuntimeVariant`. Falls back to the
 * supplied default when the value is missing or unrecognised — never
 * throws so a typo in the env never crashes the gateway boot.
 */
export function parseRuntimeVariant(
  value: string | undefined,
  fallback: RuntimeVariant,
): RuntimeVariant {
  if (!value) return fallback;
  const normalised = value.trim().toLowerCase();
  if ((RUNTIME_VARIANTS as Set<string>).has(normalised)) {
    return normalised as RuntimeVariant;
  }
  return fallback;
}

function parseProviderAllowlist(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  const items = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(items);
}

export function readRuntimeFlags(env: NodeJS.ProcessEnv = process.env): RuntimeFlags {
  const global = parseRuntimeVariant(env['OPENAWORK_RUNTIME'], 'v1');
  return {
    global,
    storage: parseRuntimeVariant(env['OPENAWORK_RUNTIME_STORAGE'], global),
    upstream: parseRuntimeVariant(env['OPENAWORK_RUNTIME_UPSTREAM'], global),
    services: parseRuntimeVariant(env['OPENAWORK_RUNTIME_SERVICES'], global),
    upstreamProviderAllowlist: parseProviderAllowlist(
      env['OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS'],
    ),
  };
}

/**
 * Snapshot evaluated at module load. Keep mutable so tests can reset the
 * cache after stubbing `process.env`. Production code should use the
 * helpers below rather than reading the snapshot directly.
 */
let cachedFlags: RuntimeFlags | null = null;

export function getRuntimeFlags(): RuntimeFlags {
  if (cachedFlags === null) {
    cachedFlags = readRuntimeFlags();
  }
  return cachedFlags;
}

export function refreshRuntimeFlagsForTesting(): RuntimeFlags {
  cachedFlags = readRuntimeFlags();
  return cachedFlags;
}

export function isV2Storage(): boolean {
  return getRuntimeFlags().storage === 'v2';
}

export function isV2Upstream(): boolean {
  return getRuntimeFlags().upstream === 'v2';
}

/**
 * Decide whether the v2 upstream path should be taken for a specific
 * route. Returns `false` when:
 *   - The global / per-layer flag is `v1`.
 *   - An allowlist is configured but the providerType is not in it.
 *
 * The check is intentionally case-insensitive on `providerType` so
 * configuration files (`anthropic`, `Anthropic`, `ANTHROPIC`) all
 * resolve to the same membership decision.
 */
export function isV2UpstreamForProviderType(providerType: string | undefined): boolean {
  const flags = getRuntimeFlags();
  if (flags.upstream !== 'v2') return false;
  if (flags.upstreamProviderAllowlist.size === 0) return true;
  if (!providerType) return false;
  return flags.upstreamProviderAllowlist.has(providerType.toLowerCase());
}

/**
 * Shadow-mode opt-in. When `OPENAWORK_RUNTIME_UPSTREAM_SHADOW=1` is
 * set, the gateway runs the v1 upstream path as usual *and* computes
 * the v2 bridge output offline so it can audit-log structural diffs
 * (no second LLM call). This is independent from the per-layer
 * upstream flag — operators may turn shadow on while keeping the
 * production path on v1.
 */
export function isV2UpstreamShadow(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['OPENAWORK_RUNTIME_UPSTREAM_SHADOW'];
  if (!value) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'on';
}

export function isV2Services(): boolean {
  return getRuntimeFlags().services === 'v2';
}
