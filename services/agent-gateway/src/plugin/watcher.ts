/**
 * Minimal fs.watch wrapper for plugin hot reload.
 *
 * Design (aligned with opencode's plugin source watching):
 *   - One watcher per target path (file or directory).
 *   - Events are debounced (`DEBOUNCE_MS`) because editors emit bursts
 *     of change events for a single save.
 *   - A SHA-256 digest of the target (file content / sorted directory
 *     listing) dedupes events that did not actually change anything —
 *     unchanged content must not re-run plugin setup.
 *   - `persistent: false` so the watcher never keeps the process alive.
 *
 * Watching is best-effort: a missing path or a platform without
 * `fs.watch` support degrades to "no hot reload" without breaking boot.
 */

import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';

const DEBOUNCE_MS = 200;

export type PluginWatchTargetKind = 'file' | 'directory';

export interface PluginWatchTarget {
  readonly path: string;
  readonly kind: PluginWatchTargetKind;
}

async function computeDigest(path: string, kind: PluginWatchTargetKind): Promise<string> {
  try {
    if (kind === 'directory') {
      const entries = (await readdir(path)).sort();
      return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    }
    const content = await readFile(path);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return 'missing';
  }
}

export class PluginWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly digests = new Map<string, string>();
  private readonly targets = new Map<string, PluginWatchTarget>();
  private readonly listeners = new Map<string, () => void | Promise<void>>();
  private closed = false;

  /** Start watching a target; repeated calls for the same path are no-ops. */
  async watch(target: PluginWatchTarget, onChange: () => void | Promise<void>): Promise<void> {
    if (this.closed || this.watchers.has(target.path)) return;
    const info = await stat(target.path).catch(() => null);
    if (!info) return;

    this.targets.set(target.path, target);
    this.listeners.set(target.path, onChange);
    this.digests.set(target.path, await computeDigest(target.path, target.kind));

    try {
      const watcher = watch(target.path, { persistent: false }, () => {
        this.schedule(target.path);
      });
      watcher.on('error', () => {
        // A watcher error (e.g. the directory disappeared) must not
        // crash the gateway; drop the watcher silently.
        watcher.close();
        this.watchers.delete(target.path);
      });
      this.watchers.set(target.path, watcher);
    } catch {
      // Platform without fs.watch support: degrade to no hot reload.
    }
  }

  private schedule(path: string): void {
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);
    this.timers.set(
      path,
      setTimeout(() => {
        void this.fire(path);
      }, DEBOUNCE_MS),
    );
  }

  private async fire(path: string): Promise<void> {
    this.timers.delete(path);
    const target = this.targets.get(path);
    if (!target || this.closed) return;

    const next = await computeDigest(path, target.kind);
    if (next === this.digests.get(path)) return;
    this.digests.set(path, next);

    try {
      await this.listeners.get(path)?.();
    } catch (err) {
      console.warn(
        `[plugin] hot reload listener for "${path}" threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Test-only: force the debounce window to fire immediately. */
  async flushForTest(path: string): Promise<void> {
    const timer = this.timers.get(path);
    if (timer) clearTimeout(timer);
    this.timers.delete(path);
    await this.fire(path);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.targets.clear();
    this.listeners.clear();
    this.digests.clear();
  }
}
