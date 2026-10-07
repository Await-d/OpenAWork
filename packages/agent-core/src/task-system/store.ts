import { promises as fs } from 'node:fs';
import path from 'node:path';

import { normalizePersistedTaskGraph } from './types.js';
import type { AgentTaskGraph, AgentTaskStore } from './types.js';

const DEFAULT_GRAPH_ID = 'default';
const GRAPH_ID_BY_GRAPH = new WeakMap<AgentTaskGraph, string>();

/**
 * 同一图文件的写入串行队列。
 *
 * 并发 `save()`（典型来源：batch 里一次改多个任务，每个 task_update 各写一次）
 * 会在 Windows 上撞出 `EPERM: operation not permitted, rename ... .tmp -> .json`：
 * 目标文件正被另一个句柄 /杀软 /索引器占用，`MoveFileEx` 直接失败。同路径串行化
 * 既消掉这层句柄争抢，也避免两个 temp 文件互相覆盖导致的丢更新。
 */
const WRITE_QUEUES_BY_PATH = new Map<string, Promise<void>>();

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isRenameContention(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && RENAME_RETRY_CODES.has(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把临时文件落到目标路径。
 *
 * Windows 上 `rename` 覆盖已存在文件时，若目标正被占用会抛 EPERM / EBUSY /
 * EACCES（POSIX 不会）。先退避重试；仍失败则删掉目标再 rename——此时会出现一个
 * 目标文件短暂不存在的窗口，读取方靠 `load()` 的 JSON.parse 失败重试兜底。
 */
async function renameWithRetry(tempPath: string, filePath: string): Promise<void> {
  for (const delayMs of [0, ...RENAME_RETRY_DELAYS_MS]) {
    if (delayMs > 0) {
      await delay(delayMs);
    }
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!isRenameContention(error)) {
        throw error;
      }
      const isLastAttempt = delayMs === RENAME_RETRY_DELAYS_MS[RENAME_RETRY_DELAYS_MS.length - 1];
      if (!isLastAttempt) {
        continue;
      }
    }
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  await fs.rename(tempPath, filePath);
}

function enqueueWrite(filePath: string, task: () => Promise<void>): Promise<void> {
  const previous = WRITE_QUEUES_BY_PATH.get(filePath) ?? Promise.resolve();
  const next = previous.then(task, task);
  // 队列本身不吞错误：调用方拿到的仍是本次 task 的结果。tail 只用来维持链式顺序，
  // 必须挂 catch，否则一次失败会让后续 task 永远不执行。
  const tail = next.catch(() => undefined);
  WRITE_QUEUES_BY_PATH.set(filePath, tail);
  void tail.then(() => {
    if (WRITE_QUEUES_BY_PATH.get(filePath) === tail) {
      WRITE_QUEUES_BY_PATH.delete(filePath);
    }
  });
  return next;
}

function resolveTasksDir(projectRoot: string): string {
  return path.join(projectRoot, '.agentdocs', 'tasks');
}

function resolveGraphPath(projectRoot: string, graphId: string): string {
  return path.join(resolveTasksDir(projectRoot), `${graphId}.json`);
}

function createEmptyGraph(projectRoot: string): AgentTaskGraph {
  const now = Date.now();
  return {
    projectRoot,
    tasks: {},
    runs: {},
    interactions: {},
    sessionContexts: {},
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
}

export class AgentTaskStoreImpl implements AgentTaskStore {
  async load(projectRoot: string, graphId = DEFAULT_GRAPH_ID): Promise<AgentTaskGraph> {
    const filePath = resolveGraphPath(projectRoot, graphId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const graph = normalizePersistedTaskGraph(JSON.parse(content), projectRoot);
        GRAPH_ID_BY_GRAPH.set(graph, graphId);
        return graph;
      } catch (error) {
        if ((error as NodeJS.ErrnoException & { code?: string }).code === 'ENOENT') {
          const graph = createEmptyGraph(projectRoot);
          GRAPH_ID_BY_GRAPH.set(graph, graphId);
          return graph;
        }
        if (error instanceof SyntaxError && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        if (error instanceof SyntaxError) {
          const graph = createEmptyGraph(projectRoot);
          GRAPH_ID_BY_GRAPH.set(graph, graphId);
          return graph;
        }
        throw error;
      }
    }
    const graph = createEmptyGraph(projectRoot);
    GRAPH_ID_BY_GRAPH.set(graph, graphId);
    return graph;
  }

  async save(graph: AgentTaskGraph): Promise<void> {
    const graphId = GRAPH_ID_BY_GRAPH.get(graph) ?? DEFAULT_GRAPH_ID;
    const filePath = resolveGraphPath(graph.projectRoot, graphId);
    return enqueueWrite(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2)}`;
      try {
        await fs.writeFile(tempPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
        await renameWithRetry(tempPath, filePath);
      } catch (error) {
        try {
          await fs.unlink(tempPath);
        } catch (cleanupError) {
          void cleanupError;
        }
        throw error;
      }
    });
  }

  async listGraphs(projectRoot: string): Promise<string[]> {
    const tasksDir = resolveTasksDir(projectRoot);
    try {
      const entries = await fs.readdir(tasksDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -'.json'.length));
    } catch (error) {
      if ((error as NodeJS.ErrnoException & { code?: string }).code !== 'ENOENT') {
        throw error;
      }
      return [];
    }
  }

  async deleteGraph(projectRoot: string, graphId: string): Promise<void> {
    const filePath = resolveGraphPath(projectRoot, graphId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException & { code?: string }).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
