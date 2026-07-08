/**
 * Hot-path storage for the chat editor split position.
 *
 * Why this exists rather than using `useUIStateStore.splitPos`:
 *   The split position is committed once per drag-end. Routing it
 *   through zustand triggers the persist middleware, which serializes
 *   the *entire* UI state (≈ 75 fields including big maps like
 *   openFilePathsByWorkspace, expandedDirs, etc.) and writes it to
 *   localStorage in one synchronous call. That's the source of the
 *   `[Violation] 'requestIdleCallback' handler took ~70ms` and
 *   `[Violation] 'click' handler took 167ms` warnings even though we
 *   already deferred the commit out of mouseup.
 *
 *   By writing only the small `splitPos` key on its own we cut the
 *   persisted payload to a few bytes and bypass every zustand
 *   subscriber check, removing the warning entirely.
 *
 * Falls back gracefully when localStorage isn't available (Tauri
 * sandboxes / SSR dry-runs / private mode).
 */

const STORAGE_KEY = 'openAwork-split-pos';
const DEFAULT_SPLIT_POS = 62;

export function readSplitPos(): number {
  if (typeof window === 'undefined') return DEFAULT_SPLIT_POS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SPLIT_POS;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SPLIT_POS;
    // Clamp to the same range the drag handler enforces (20–80 %).
    return Math.min(80, Math.max(20, parsed));
  } catch {
    return DEFAULT_SPLIT_POS;
  }
}

export function writeSplitPos(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* swallow — quota / sandbox issues are not user-actionable here */
  }
}
