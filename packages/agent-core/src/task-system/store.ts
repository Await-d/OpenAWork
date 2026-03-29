import { promises as fs } from 'node:fs';
import path from 'node:path';

import { normalizePersistedTaskGraph } from './types.js';
import type { AgentTaskGraph, AgentTaskStore } from './types.js';

const DEFAULT_GRAPH_ID = 'default';
const GRAPH_ID_BY_GRAPH = new WeakMap<AgentTaskGraph, string>();

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
    createdAt: now,
    updatedAt: now,
  };
}

export class AgentTaskStoreImpl implements AgentTaskStore {
  async load(projectRoot: string, graphId = DEFAULT_GRAPH_ID): Promise<AgentTaskGraph> {
    const filePath = resolveGraphPath(projectRoot, graphId);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const graph = normalizePersistedTaskGraph(JSON.parse(content), projectRoot);
      GRAPH_ID_BY_GRAPH.set(graph, graphId);
      return graph;
    } catch (error) {
      if ((error as NodeJS.ErrnoException & { code?: string }).code !== 'ENOENT') {
        if (error instanceof SyntaxError) {
          const graph = createEmptyGraph(projectRoot);
          GRAPH_ID_BY_GRAPH.set(graph, graphId);
          return graph;
        }
        throw error;
      }
      const graph = createEmptyGraph(projectRoot);
      GRAPH_ID_BY_GRAPH.set(graph, graphId);
      return graph;
    }
  }

  async save(graph: AgentTaskGraph): Promise<void> {
    const graphId = GRAPH_ID_BY_GRAPH.get(graph) ?? DEFAULT_GRAPH_ID;
    const filePath = resolveGraphPath(graph.projectRoot, graphId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
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
