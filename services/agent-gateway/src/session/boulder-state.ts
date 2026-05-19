/**
 * Boulder State
 *
 * Ported from oh-my-opencode's boulder-state feature.
 * Manages the active work plan state for Sisyphus orchestrator.
 * Named after Sisyphus's boulder — the eternal task that must be rolled.
 *
 * In oh-my-opencode this was a feature module used by atlas/ralph-loop/start-work hooks.
 * In OpenAWork it's a standalone module used by the orchestrator guard hooks.
 */

import { promises as fsp } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export const BOULDER_DIR = '.sisyphus';
export const BOULDER_FILE = 'boulder.json';
export const BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`;
export const PROMETHEUS_PLANS_DIR = '.sisyphus/plans';

export interface BoulderState {
  /** Absolute path to the active plan file */
  active_plan: string;
  /** ISO timestamp when work started */
  started_at: string;
  /** Session IDs that have worked on this plan */
  session_ids: string[];
  /** Plan name derived from filename */
  plan_name: string;
}

export interface PlanProgress {
  /** Total number of checkboxes */
  total: number;
  /** Number of completed checkboxes */
  completed: number;
  /** Whether all tasks are done */
  isComplete: boolean;
}

export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE);
}

export async function readBoulderState(directory: string): Promise<BoulderState | null> {
  const filePath = getBoulderFilePath(directory);

  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(content) as BoulderState;
  } catch {
    return null;
  }
}

export async function writeBoulderState(directory: string, state: BoulderState): Promise<boolean> {
  const filePath = getBoulderFilePath(directory);

  try {
    const dir = dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function appendSessionId(
  directory: string,
  sessionId: string,
): Promise<BoulderState | null> {
  const state = await readBoulderState(directory);
  if (!state) return null;

  if (!state.session_ids.includes(sessionId)) {
    state.session_ids.push(sessionId);
    if (await writeBoulderState(directory, state)) {
      return state;
    }
  }

  return state;
}

export async function clearBoulderState(directory: string): Promise<boolean> {
  const filePath = getBoulderFilePath(directory);

  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find Prometheus plan files for this project.
 * Prometheus stores plans at: {project}/.sisyphus/plans/{name}.md
 */
export async function findPrometheusPlans(directory: string): Promise<string[]> {
  const plansDir = join(directory, PROMETHEUS_PLANS_DIR);

  try {
    const entries = await fsp.readdir(plansDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));

    // Sort by modification time, newest first
    const withStats = await Promise.all(
      mdFiles.map(async (f) => {
        const fullPath = join(plansDir, f);
        const stat = await fsp.stat(fullPath);
        return { path: fullPath, mtimeMs: stat.mtimeMs };
      }),
    );

    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return withStats.map((s) => s.path);
  } catch {
    return [];
  }
}

/**
 * Parse a plan file and count checkbox progress.
 */
export async function getPlanProgress(planPath: string): Promise<PlanProgress> {
  try {
    const content = await fsp.readFile(planPath, 'utf-8');

    const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || [];
    const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || [];

    const total = uncheckedMatches.length + checkedMatches.length;
    const completed = checkedMatches.length;

    return {
      total,
      completed,
      isComplete: total === 0 || completed === total,
    };
  } catch {
    return { total: 0, completed: 0, isComplete: true };
  }
}

/**
 * Extract plan name from file path.
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, '.md');
}

/**
 * Create a new boulder state for a plan.
 */
export function createBoulderState(planPath: string, sessionId: string): BoulderState {
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
  };
}
