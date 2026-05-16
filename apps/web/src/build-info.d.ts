/**
 * Compile-time constants injected by `scripts/vite-plugin-version.mjs`.
 * See that plugin for canonical values; this file mirrors the contract for
 * TypeScript type-checking.
 */

interface BuildCommitInfo {
  /** Short git hash, e.g. `a1b2c3d`. */
  shortHash: string;
  /** Full git hash. */
  fullHash: string;
  /** ISO 8601 commit date, e.g. `2026-05-16T10:00:00Z`. */
  date: string;
  /** Author name. */
  author: string;
  /** First line of the commit message. */
  subject: string;
}

declare const __APP_VERSION__: string;
declare const __APP_BUILD_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_GIT_HASH__: string;
declare const __APP_GIT_BRANCH__: string;
declare const __APP_GIT_TAG__: string;
declare const __APP_REPOSITORY_URL__: string;
declare const __APP_RECENT_COMMITS__: BuildCommitInfo[];
