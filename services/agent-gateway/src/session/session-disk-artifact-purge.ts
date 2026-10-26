/**
 * 会话删除时的磁盘型产物回收（`artifacts-index.json` + 磁盘文件）。
 *
 * 磁盘型产物（客户端上传的会话附件、工具产物、截图等）由
 * `ArtifactManagerImpl` 的进程内索引管理，**与 `artifacts` 表是两套数据**：
 * 删除会话时数据库行会随 `ON DELETE CASCADE` 消失，但索引条目与磁盘文件
 * 没有任何级联关系，不显式回收就会永久残留（每个会话的附件、截图都留在
 * 数据目录里，长期运行必然膨胀）。
 *
 * 与 `composer-queue-artifact-purge.ts` 的分工：那边只回收「待发队列附件副本」
 * （条目离开队列即失效）；这里按 `sessionId` 回收整个会话的全部磁盘产物，
 * 时机是会话行**已删除之后**——此时任何 `artifactId` 都不可能再被解析
 * （`resolveInputImageContent` 查不到所属会话的产物）。
 *
 * **批量优先**：`removeMany` 每次都会全量重写索引文件，因此会话树（父 + 多个
 * 子会话）必须先把所有产物 id 收集起来，最后**一次**落盘；逐个会话调用会把
 * 写放大变成 O(会话数)。
 *
 * **best-effort，绝不抛错**：调用点处在会话删除流程中，磁盘回收失败不应让
 * 删除接口整体 500（会话 DB 行已经删掉，重试也只会得到 404）。
 */

import { getGatewayArtifactManager } from '../infra/artifact-manager.js';
import { describeError, logGatewayWarn } from '../infra/gateway-logger.js';

/** 只依赖产物管理器的读 / 删能力，便于单测注入假实现。 */
export interface SessionDiskArtifactManager {
  list(sessionId: string): Promise<ReadonlyArray<{ readonly id: string }>>;
  removeMany(artifactIds: Iterable<string>): number;
}

/**
 * 回收一批会话的全部磁盘型产物，返回实际删掉的条目数。
 *
 * `manager` 缺省走进程内单例；单测可注入假实现。
 */
export async function purgeSessionDiskArtifactsForSessions(input: {
  sessionIds: readonly string[];
  manager?: SessionDiskArtifactManager;
}): Promise<number> {
  if (input.sessionIds.length === 0) {
    return 0;
  }
  const manager = input.manager ?? getGatewayArtifactManager();
  try {
    const artifactIds = new Set<string>();
    for (const sessionId of input.sessionIds) {
      for (const artifact of await manager.list(sessionId)) {
        artifactIds.add(artifact.id);
      }
    }
    if (artifactIds.size === 0) {
      return 0;
    }
    // 索引只落盘一次：逐条 `remove` / 逐会话 `removeMany` 会把整个索引重写 N 遍。
    return manager.removeMany(artifactIds);
  } catch (error) {
    logGatewayWarn('会话磁盘产物回收失败（会话已删除，仅剩磁盘残留）', {
      sessionCount: input.sessionIds.length,
      ...describeError(error),
    });
    return 0;
  }
}

/** 单会话版本（薄封装，便于独立调用与单测）。 */
export async function purgeSessionDiskArtifacts(input: {
  sessionId: string;
  manager?: SessionDiskArtifactManager;
}): Promise<number> {
  return purgeSessionDiskArtifactsForSessions({
    sessionIds: [input.sessionId],
    ...(input.manager ? { manager: input.manager } : {}),
  });
}
