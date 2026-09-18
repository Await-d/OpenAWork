/**
 * session-turn-rollback-task-graph — 回退时清理文件任务图中被作废回合的任务节点（计划 §3 第 6 步）。
 *
 * 任务图按会话落盘：`<projectRoot>/.agentdocs/tasks/<sessionId>.json`（graphId = sessionId，
 * 见 `task-crud-tools.loadGraph`），节点通过 `AgentTask.clientRequestId` 归属到创建它的回合。
 * 本模块按 receipt 的 invalidatedClientRequestIds 精确摘除对应节点，并清理其它节点对这些
 * 节点的 `blockedBy` / `blocks` / `parentTaskId` 引用（与 `AgentTaskManagerImpl.removeTask`
 * 的引用清理语义一致）。
 *
 * 后代语义选择「置空悬挂父指针」，不采用 `removeTask` 的整棵子树级联删除：回退只允许
 * 删除归属被作废回合的节点（计划 §3.6），而悬挂父指针的另一端可能是**后续回合**创建的
 * 任务——级联会把后续回合的产物一并删掉，超出回合回退的删除边界。置空父指针后，后续
 * 回合的任务成为根节点继续存在，图上不再有指向已删除节点的引用。
 *
 * 图内再无任务时直接删文件，与 `routes/sessions.ts` 的 `deleteGraph` 行为一致。
 *
 * 为何在 COMMIT 之后执行：`AgentTaskStoreImpl` 是 `fs.promises` 异步 API，而
 * `sqliteTransaction` 是 better-sqlite3 同步事务（回调内禁止 await）。因此清理无法与
 * DB 删除共享原子性；逐会话 try/catch，失败只告警（DB 删除已提交，不能回退），
 * 按回合键精确匹配保证重复执行安全（幂等）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentTaskManagerImpl, AgentTaskStoreImpl } from '@openAwork/agent-core';
import type { AgentTask, AgentTaskGraph } from '@openAwork/agent-core';
import { resolveTaskGraphProjectRoot } from '../task/task-graph-root.js';

export async function purgeRolledBackTurnTaskGraphNodes(input: {
  affectedSessionIds: readonly string[];
  invalidatedClientRequestIds: readonly string[];
}): Promise<void> {
  const invalidatedRequestIds = new Set(input.invalidatedClientRequestIds);
  if (invalidatedRequestIds.size === 0) {
    return;
  }

  const taskManager = new AgentTaskManagerImpl();
  const taskStore = new AgentTaskStoreImpl();
  for (const sessionId of input.affectedSessionIds) {
    try {
      const projectRoot = resolveTaskGraphProjectRoot(sessionId);
      await warnIfGraphFileUnparsable(projectRoot, sessionId);
      const graph = await taskManager.loadOrCreate(projectRoot, sessionId);
      const removedTaskIds = collectTurnTaskIds(graph, invalidatedRequestIds);
      if (removedTaskIds.size === 0) {
        continue;
      }

      for (const taskId of removedTaskIds) {
        delete graph.tasks[taskId];
      }
      for (const task of Object.values(graph.tasks)) {
        cleanDanglingReferences(task, removedTaskIds);
      }

      if (Object.keys(graph.tasks).length === 0) {
        await taskStore.deleteGraph(projectRoot, sessionId);
      } else {
        await taskManager.save(graph);
      }
      console.info('[turn-rollback] 已清理作废回合的任务图节点', {
        sessionId,
        removedTaskIds: [...removedTaskIds],
      });
    } catch (error) {
      console.warn(
        `[turn-rollback] 清理文件任务图失败（session=${sessionId}，不影响已提交的 DB 删除）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * 与 `AgentTaskManagerImpl.removeTask` 的引用清理语义一致：摘除已删除节点的引用并计入修订。
 * `parentTaskId` 指向被删节点时置空而非级联删除该节点——见模块头「后代语义选择」。
 */
function cleanDanglingReferences(task: AgentTask, removedTaskIds: ReadonlySet<string>): void {
  const nextBlockedBy = task.blockedBy.filter((taskId) => !removedTaskIds.has(taskId));
  const currentBlocks = task.blocks ?? [];
  const nextBlocks = currentBlocks.filter((taskId) => !removedTaskIds.has(taskId));
  const clearsParent = task.parentTaskId !== undefined && removedTaskIds.has(task.parentTaskId);
  if (
    nextBlockedBy.length === task.blockedBy.length &&
    nextBlocks.length === currentBlocks.length &&
    !clearsParent
  ) {
    return;
  }

  task.blockedBy = nextBlockedBy;
  task.blocks = nextBlocks;
  if (clearsParent) {
    task.parentTaskId = undefined;
  }
  task.updatedAt = Date.now();
  task.revision = (task.revision ?? 0) + 1;
}

/**
 * 任务图文件存在但 JSON 解析失败时告警。`AgentTaskStoreImpl.load` 对损坏文件会静默
 * 返回空图，清理将跳过该会话并留下残留节点；这里显式把残留暴露到日志，而不是静默吞掉。
 */
async function warnIfGraphFileUnparsable(projectRoot: string, sessionId: string): Promise<void> {
  const graphPath = path.join(projectRoot, '.agentdocs', 'tasks', `${sessionId}.json`);
  let content: string;
  try {
    content = await fs.readFile(graphPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  try {
    JSON.parse(content);
  } catch (error) {
    console.warn(
      `[turn-rollback] 任务图文件存在但无法解析，该会话的作废回合节点可能残留：${graphPath}（${
        error instanceof Error ? error.message : String(error)
      }）`,
    );
  }
}

function collectTurnTaskIds(
  graph: AgentTaskGraph,
  invalidatedRequestIds: ReadonlySet<string>,
): Set<string> {
  const taskIds = new Set<string>();
  for (const task of Object.values(graph.tasks)) {
    if (task.clientRequestId !== undefined && invalidatedRequestIds.has(task.clientRequestId)) {
      taskIds.add(task.id);
    }
  }
  return taskIds;
}
