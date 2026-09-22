import path from 'node:path';

import type { DirectoryAgentsInjector, ToolCallResult } from '@openAwork/agent-core';
import { DirectoryAgentsInjectorImpl } from '@openAwork/agent-core';

/**
 * 对齐 opencode v2.0.12 的 read 行为：成功读取文件后，向上发现「最近的」
 * AGENTS.md（含 CRUSH.md / CLAUDE.md / GEMINI.md），把其内容作为指令上下文
 * 追加进本次 read 的输出。
 *
 * 与 `DirectoryAgentsInjectorImpl.findNearestAgentsFile` 的配合约定：
 * - 向上发现到「工作区根」为止（stopAt），不越过工作区去读宿主机其它目录；
 * - 工作区根自身的 AGENTS.md 由会话初始指令负责，read 注入不复读，保持与上游一致；
 * - 任何发现 / 读取异常都必须被吞掉，绝不改变 read 本身的成功结果。
 */

/**
 * 去重状态的内存上界。
 *
 * 网关是长跑进程，会话数量会随时间无限增长；若按 sessionId 无界记录，进程内存
 * 会随历史会话单调增长。这里用两个上界把最坏情况固定在 O(N × M)：
 * - MAX_TRACKED_SESSIONS：最多跟踪 256 个会话，超出后按插入顺序淘汰最旧会话（近似 LRU）；
 * - MAX_INJECTED_PATHS_PER_SESSION：单会话最多记录 64 条已注入路径，超出后丢弃最早记录。
 * 256 × 64 ≈ 1.6 万个短字符串，量级可忽略；代价是被淘汰后可能重复注入一次，
 * 属于可接受的退让（重复注入不影响正确性，只多花一点上下文）。
 */
const MAX_TRACKED_SESSIONS = 256;
const MAX_INJECTED_PATHS_PER_SESSION = 64;

export class DirectoryAgentsInjectionTracker {
  /** sessionId → 已注入过的 AGENTS.md 绝对路径集合；Map 保持插入顺序用于淘汰。 */
  private readonly injectedBySession = new Map<string, Set<string>>();

  isInjected(sessionId: string, agentsFilePath: string): boolean {
    const injected = this.injectedBySession.get(sessionId);
    if (!injected || !injected.has(agentsFilePath)) {
      return false;
    }
    // 命中即刷新插入顺序，使淘汰近似 LRU（最近用过的会话更不容易被淘汰）。
    this.injectedBySession.delete(sessionId);
    this.injectedBySession.set(sessionId, injected);
    return true;
  }

  markInjected(sessionId: string, agentsFilePath: string): void {
    const existing = this.injectedBySession.get(sessionId);
    if (existing) {
      this.injectedBySession.delete(sessionId);
    }
    const injected = existing ?? new Set<string>();
    injected.add(agentsFilePath);

    if (injected.size > MAX_INJECTED_PATHS_PER_SESSION) {
      // Set 保持插入顺序：丢弃最早记录，宁可重复注入也不让单会话集合无界增长。
      const oldest = injected.values().next().value;
      if (oldest !== undefined) {
        injected.delete(oldest);
      }
    }

    this.injectedBySession.set(sessionId, injected);

    while (this.injectedBySession.size > MAX_TRACKED_SESSIONS) {
      const oldestSession = this.injectedBySession.keys().next().value;
      if (oldestSession === undefined) {
        break;
      }
      this.injectedBySession.delete(oldestSession);
    }
  }

  reset(): void {
    this.injectedBySession.clear();
  }
}

interface ReadToolOutput {
  path: string;
  content: string;
  [key: string]: unknown;
}

export interface DirectoryAgentsInjectionOptions {
  sessionId: string;
  /** 工作区根绝对路径；null 表示无法确定，此时向上发现会一直走到文件系统根。 */
  workspaceRoot: string | null;
  /** 可注入依赖，便于单测；默认使用进程级单例。 */
  injector?: DirectoryAgentsInjector;
  tracker?: DirectoryAgentsInjectionTracker;
  /** 失败回调，便于观测；默认写 stderr（console.warn）。 */
  onError?: (error: unknown) => void;
}

const defaultInjector = new DirectoryAgentsInjectorImpl();
const defaultTracker = new DirectoryAgentsInjectionTracker();

function isReadToolOutput(value: unknown): value is ReadToolOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { path?: unknown; content?: unknown };
  return typeof candidate.path === 'string' && typeof candidate.content === 'string';
}

function isSameDirectory(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function logInjectionFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn('[directory-agents-injection] 注入 AGENTS.md 上下文失败，已跳过：', message);
}

/**
 * 在 read 成功结果上尝试注入最近的 AGENTS.md。
 *
 * 仅在以下条件同时满足时改写输出，否则原样返回：
 * 1. `result.isError` 为 false（失败 / 校验失败 / 超时一律不注入）；
 * 2. 输出是带 `path` 与 `content` 的 read 结构；
 * 3. 向上发现命中非工作区根自身的 AGENTS.md；
 * 4. 该 AGENTS.md 在本会话尚未注入过。
 *
 * 注入只追加 `content` 字段，不新增未知字段，保持 read 的 outputSchema 可校验。
 */
export async function injectDirectoryAgentsIntoReadResult(
  result: ToolCallResult,
  options: DirectoryAgentsInjectionOptions,
): Promise<ToolCallResult> {
  const output = result.output;
  try {
    if (result.isError || !isReadToolOutput(output)) {
      return result;
    }

    const injector = options.injector ?? defaultInjector;
    const tracker = options.tracker ?? defaultTracker;
    const { sessionId, workspaceRoot } = options;

    const entry = await injector.findNearestAgentsFile(output.path, workspaceRoot ?? undefined);
    if (!entry) {
      return result;
    }

    // 工作区根自身的 AGENTS.md 由会话初始指令负责，read 注入不复读（与上游一致）。
    if (workspaceRoot && isSameDirectory(path.dirname(entry.filePath), workspaceRoot)) {
      return result;
    }

    if (tracker.isInjected(sessionId, entry.filePath)) {
      return result;
    }

    const injectionBlock = injector.buildInjectionBlock([entry]);
    if (!injectionBlock) {
      return result;
    }

    tracker.markInjected(sessionId, entry.filePath);

    return {
      ...result,
      output: {
        ...output,
        content: `${output.content}\n\n${injectionBlock}`,
      },
    };
  } catch (error) {
    (options.onError ?? logInjectionFailure)(error);
    return result;
  }
}
