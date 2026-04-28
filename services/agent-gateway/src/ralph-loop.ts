/**
 * Ralph Loop
 *
 * Ported from oh-my-opencode's ralph-loop hook.
 * Quality loop that continues iterating until a completion promise is detected
 * or max iterations are reached. Used for ultrawork mode.
 *
 * In oh-my-opencode this was an event-driven hook that injected continuation prompts
 * on session.idle events. In OpenAWork it's integrated into the stream loop
 * as a synthetic continuation prompt injection.
 *
 * State is stored in .sisyphus/ralph-loop.local.md (frontmatter format).
 */

import { promises as fsp } from 'node:fs';
import { join, dirname } from 'node:path';

export const DEFAULT_STATE_FILE = '.sisyphus/ralph-loop.local.md';
export const DEFAULT_MAX_ITERATIONS = 100;
export const DEFAULT_COMPLETION_PROMISE = 'DONE';
const COMPLETION_TAG_PATTERN = /<promise>(.*?)<\/promise>/is;

export interface RalphLoopState {
  active: boolean;
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  started_at: string;
  prompt: string;
  session_id?: string;
  ultrawork?: boolean;
}

function getStateFilePath(directory: string): string {
  return join(directory, DEFAULT_STATE_FILE);
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, unknown> = {};
  const frontmatter = match[1] ?? '';
  const bodyContent = match[2] ?? '';
  for (const line of frontmatter.split('\n')) {
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kvMatch && kvMatch[1] && kvMatch[2] !== undefined) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();
      // Remove surrounding quotes
      if (typeof value === 'string' && /^["']/.test(value) && /["']$/.test(value)) {
        value = value.slice(1, -1);
      }
      // Parse booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      // Parse numbers
      else if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
      data[key as string] = value;
    }
  }

  return { data, body: bodyContent };
}

const stripQuotes = (val: unknown): string => {
  const str = String(val ?? '');
  return str.replace(/^["']|["']$/g, '');
};

export async function readRalphState(directory: string): Promise<RalphLoopState | null> {
  const filePath = getStateFilePath(directory);

  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    const active = data.active;
    const iteration = data.iteration;

    if (active === undefined || iteration === undefined) return null;

    const isActive = active === true || active === 'true';
    const iterationNum = typeof iteration === 'number' ? iteration : Number(iteration);

    if (isNaN(iterationNum)) return null;

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork: data.ultrawork === true || data.ultrawork === 'true' ? true : undefined,
    };
  } catch {
    return null;
  }
}

export async function writeRalphState(directory: string, state: RalphLoopState): Promise<boolean> {
  const filePath = getStateFilePath(directory);

  try {
    const dir = dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });

    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : '';
    const ultraworkLine = state.ultrawork !== undefined ? `ultrawork: ${state.ultrawork}\n` : '';
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
started_at: "${state.started_at}"
${sessionIdLine}${ultraworkLine}---
${state.prompt}
`;

    await fsp.writeFile(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function clearRalphState(directory: string): Promise<boolean> {
  const filePath = getStateFilePath(directory);

  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function incrementRalphIteration(directory: string): Promise<RalphLoopState | null> {
  const state = await readRalphState(directory);
  if (!state) return null;

  state.iteration += 1;
  if (await writeRalphState(directory, state)) {
    return state;
  }
  return null;
}

/**
 * Start a new Ralph loop.
 */
export async function startRalphLoop(
  directory: string,
  sessionId: string,
  prompt: string,
  options?: { maxIterations?: number; completionPromise?: string; ultrawork?: boolean },
): Promise<boolean> {
  const state: RalphLoopState = {
    active: true,
    iteration: 1,
    max_iterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    completion_promise: options?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
    ultrawork: options?.ultrawork,
    started_at: new Date().toISOString(),
    prompt,
    session_id: sessionId,
  };

  return writeRalphState(directory, state);
}

/**
 * Cancel a Ralph loop.
 */
export async function cancelRalphLoop(directory: string, sessionId: string): Promise<boolean> {
  const state = await readRalphState(directory);
  if (!state || state.session_id !== sessionId) return false;
  return clearRalphState(directory);
}

/**
 * Check if the completion promise appears in the assistant's response text.
 */
export function detectCompletionPromise(responseText: string, promise: string): boolean {
  const pattern = new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, 'is');
  return pattern.test(responseText);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the continuation prompt for the next iteration.
 */
export function buildRalphContinuationPrompt(state: RalphLoopState): string {
  const prompt = `[System Directive: Ralph 循环 ${state.iteration}/${state.max_iterations}]

你之前的尝试没有输出完成承诺。继续处理任务。

重要：
- 回顾你目前的进展
- 从你停下的地方继续
- 完全完成时，输出: <promise>${state.completion_promise}</promise>
- 在任务真正完成之前不要停止

原始任务：
${state.prompt}`;

  return state.ultrawork ? `ultrawork ${prompt}` : prompt;
}

/**
 * Check if a Ralph loop should continue and build the continuation prompt.
 * Returns null if no loop is active, loop is complete, or max iterations reached.
 */
export async function checkRalphLoopContinuation(
  directory: string,
  lastAssistantText: string,
): Promise<string | null> {
  const state = await readRalphState(directory);
  if (!state || !state.active) return null;

  // Check for completion promise
  if (detectCompletionPromise(lastAssistantText, state.completion_promise)) {
    await clearRalphState(directory);
    return null;
  }

  // Check max iterations
  if (state.iteration >= state.max_iterations) {
    await clearRalphState(directory);
    return null;
  }

  // Increment and continue
  const newState = await incrementRalphIteration(directory);
  if (!newState) return null;

  return buildRalphContinuationPrompt(newState);
}
