/**
 * Permission auto-respond helper.
 * Manages per-session auto-accept state in localStorage.
 * Mirrors opencode's permission-auto-respond.ts pattern.
 */

const STORAGE_KEY = 'openawork:permission-auto-accept';

function readStore(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable */
  }
}

function sessionAcceptKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Check if auto-accept is enabled for the given session.
 */
export function isAutoAcceptEnabled(sessionId: string): boolean {
  const store = readStore();
  return store[sessionAcceptKey(sessionId)] === true;
}

/**
 * Enable auto-accept for a session.
 */
export function enableAutoAccept(sessionId: string): void {
  const store = readStore();
  store[sessionAcceptKey(sessionId)] = true;
  writeStore(store);
}

/**
 * Disable auto-accept for a session.
 */
export function disableAutoAccept(sessionId: string): void {
  const store = readStore();
  delete store[sessionAcceptKey(sessionId)];
  writeStore(store);
}

/**
 * Toggle auto-accept for a session. Returns the new state.
 */
export function toggleAutoAccept(sessionId: string): boolean {
  if (isAutoAcceptEnabled(sessionId)) {
    disableAutoAccept(sessionId);
    return false;
  }
  enableAutoAccept(sessionId);
  return true;
}

/**
 * Clean up auto-accept entries for sessions that no longer exist.
 * Call periodically to prevent localStorage bloat.
 */
export function cleanupAutoAcceptEntries(activeSessionIds: Set<string>): void {
  const store = readStore();
  let changed = false;
  for (const key of Object.keys(store)) {
    const sessionId = key.replace(/^session:/, '');
    if (!activeSessionIds.has(sessionId)) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) {
    writeStore(store);
  }
}
