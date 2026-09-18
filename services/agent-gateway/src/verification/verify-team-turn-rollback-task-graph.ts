/**
 * 文件任务图回退清理验收（计划 §3 第 6 步 / 审查 H3）——从主验收脚本抽出的断言块。
 *
 * 清理语义是「摘除被作废回合节点 + 清除存活节点对已删除节点的引用」：
 *   - `blockedBy` / `blocks` 过滤掉已删除节点；
 *   - `parentTaskId` 指向已删除节点时置空（不级联删除该节点，见
 *     `session-turn-rollback-task-graph.ts` 模块头的后代语义选择）。
 * 本模块对回退后的图做全量扫描：图内不得存在任何指向已删除节点的引用，
 * 且后续回合的父子链必须完整保留。
 */

import { existsSync } from 'node:fs';
import type { AgentTaskGraph } from '@openAwork/agent-core';
import { assert } from './task-verification-helpers.js';

export function assertTaskGraphPurgeOutcome(input: {
  graph: AgentTaskGraph;
  removedTaskId: string;
  survivorTaskId: string;
  survivorChildTaskId: string;
  survivorBlocksRefTaskId: string;
  survivorGrandchildTaskId: string;
  emptyChildGraphPath: string;
  corruptGraphPath: string;
  rollbackWarnings: readonly string[];
}): void {
  const removedTaskIds = new Set([input.removedTaskId]);
  assert(
    input.graph.tasks[input.removedTaskId] === undefined,
    `voided turn task node must be removed from the file task graph (still present: ${input.removedTaskId})`,
  );

  const survivor = input.graph.tasks[input.survivorTaskId];
  assert(
    survivor !== undefined,
    `surviving turn task node must remain in the file task graph (missing: ${input.survivorTaskId})`,
  );
  assert(
    !survivor.blockedBy.includes(input.removedTaskId),
    `surviving task must drop blockedBy references to the voided task (got [${survivor.blockedBy.join(
      ', ',
    )}])`,
  );

  const survivorChild = input.graph.tasks[input.survivorChildTaskId];
  assert(
    survivorChild !== undefined,
    `surviving child task must remain in the file task graph (missing: ${input.survivorChildTaskId})`,
  );
  assert(
    survivorChild.parentTaskId === undefined,
    `surviving task must drop the dangling parentTaskId (got ${String(survivorChild.parentTaskId)})`,
  );

  const survivorGrandchild = input.graph.tasks[input.survivorGrandchildTaskId];
  assert(
    survivorGrandchild !== undefined,
    `later-turn grandchild task must remain in the file task graph (missing: ${input.survivorGrandchildTaskId})`,
  );
  assert(
    survivorGrandchild.parentTaskId === input.survivorChildTaskId,
    `later-turn grandchild must keep its parent link to the surviving child (expected ${input.survivorChildTaskId}, got ${String(
      survivorGrandchild.parentTaskId,
    )})`,
  );

  const survivorBlocksRef = input.graph.tasks[input.survivorBlocksRefTaskId];
  assert(
    survivorBlocksRef !== undefined,
    `surviving blocks-ref task must remain in the file task graph (missing: ${input.survivorBlocksRefTaskId})`,
  );
  assert(
    !(survivorBlocksRef.blocks ?? []).includes(input.removedTaskId),
    `surviving task must drop dangling blocks references (got [${(
      survivorBlocksRef.blocks ?? []
    ).join(', ')}])`,
  );

  for (const task of Object.values(input.graph.tasks)) {
    assert(
      !removedTaskIds.has(task.id),
      `removed task node must not reappear in the file task graph (id=${task.id})`,
    );
    assert(
      task.parentTaskId === undefined || !removedTaskIds.has(task.parentTaskId),
      `no surviving task may keep a parentTaskId pointing at a removed node (task=${task.id}, parent=${String(
        task.parentTaskId,
      )})`,
    );
    for (const dependencyId of task.blockedBy) {
      assert(
        !removedTaskIds.has(dependencyId),
        `no surviving task may keep a blockedBy pointing at a removed node (task=${task.id}, dependency=${dependencyId})`,
      );
    }
    for (const dependencyId of task.blocks ?? []) {
      assert(
        !removedTaskIds.has(dependencyId),
        `no surviving task may keep a blocks pointing at a removed node (task=${task.id}, dependency=${dependencyId})`,
      );
    }
  }

  assert(
    !existsSync(input.emptyChildGraphPath),
    'task graph file must be removed when the rollback empties it',
  );
  assert(
    input.rollbackWarnings.some((message) => message.includes(input.corruptGraphPath)),
    `purge must warn about the unparsable task graph file (${input.corruptGraphPath})`,
  );
  assert(
    existsSync(input.corruptGraphPath),
    'unparsable task graph file must not be silently deleted as if it were an empty graph',
  );
}
