/**
 * `v2-runtime/` is the staging area for the opencode-aligned runtime.
 *
 * Modules here will eventually replace the legacy implementations under
 * `src/`, but for now they coexist behind the `OPENAWORK_RUNTIME` family
 * of feature flags (see `./runtime-flag.ts`). Importing this barrel is
 * intentionally side-effect free — the legacy stack continues to work
 * untouched until each phase's switch is flipped.
 *
 * Roadmap (matches the alignment plan checked into `progress` notes):
 *   - Phase 3 → `./storage/`     (drizzle-orm schemas + read/write APIs)
 *   - Phase 4 → `./upstream/`    (Vercel AI SDK provider adapters)
 *   - Phase 5 → `./services/`    (Effect-TS Service / Layer / Bus)
 */

export {
  getRuntimeFlags,
  isV2Services,
  isV2Storage,
  isV2Upstream,
  isV2UpstreamForProviderType,
  isV2UpstreamShadow,
  parseRuntimeVariant,
  readRuntimeFlags,
  refreshRuntimeFlagsForTesting,
  type RuntimeFlags,
  type RuntimeVariant,
} from './runtime-flag.js';

export {
  bootV2Runtime,
  getDrizzleHandle,
  getStorageLayer,
  getV2Storage,
  resetV2RuntimeForTesting,
  resolveStorageLayer,
  shutdownV2Runtime,
  withV2Storage,
} from './boot.js';
