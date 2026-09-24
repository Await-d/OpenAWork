/**
 * Tool output spill — 超限工具结果的全文落盘。
 *
 * 对齐参考库 opencode v2.0.15 `tool-output.ts` 的语义：工具输出超过模型/存储
 * 上限时，把**全文**写到磁盘，模型侧只看到有界预览 + 取回提示。本仓的取回入口
 * 是 `read_tool_output`（按 toolCallId 分页），落盘路径由
 * `(sessionId, toolCallId)` 直接推导，无需改动持久化契约。
 *
 * 边界与失败策略：
 *   - 路径只接受 `[A-Za-z0-9_-]` 的 id，且解析结果必须位于 spill 根目录之下
 *     （防目录穿越）；
 *   - 写失败只告警、返回 null，绝不影响工具执行本身；
 *   - 读失败（文件不存在等）返回 null，调用方回退到数据库中的截断输出；
 *   - 会话删除时清理该会话的整个 spill 目录；启动时清理过期目录（7 天）。
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { resolveGatewayToolOutputsDir } from '../infra/storage-paths.js';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STALE_SPILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isSafeId(value: string): boolean {
  return SAFE_ID_PATTERN.test(value);
}

function resolveSpillRoot(): string {
  return resolve(resolveGatewayToolOutputsDir());
}

function resolveSessionSpillDir(sessionId: string): string | null {
  if (!isSafeId(sessionId)) return null;
  return join(resolveSpillRoot(), sessionId);
}

/** 推导 `(sessionId, toolCallId)` 对应的 spill 文件路径；不安全 id 返回 null。 */
export function resolveToolOutputSpillPath(sessionId: string, toolCallId: string): string | null {
  const dir = resolveSessionSpillDir(sessionId);
  if (!dir || !isSafeId(toolCallId)) return null;
  const filePath = join(dir, `${toolCallId}.txt`);
  const root = resolveSpillRoot();
  // 纵深防御：解析后的路径必须仍在 spill 根目录之下。
  return resolve(filePath).startsWith(`${root}${sep}`) ? filePath : null;
}

/** 把全文写入 spill 文件；失败只告警并返回 null。 */
export function spillToolOutput(input: {
  sessionId: string;
  toolCallId: string;
  content: string;
}): string | null {
  const filePath = resolveToolOutputSpillPath(input.sessionId, input.toolCallId);
  if (!filePath) return null;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, input.content, 'utf8');
    return filePath;
  } catch (error) {
    console.warn(
      `[tool-output-spill] 写入失败（忽略，不影响工具执行）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** 读回 spill 全文；文件不存在 / 不可读时返回 null（调用方回退数据库输出）。 */
export function readSpilledToolOutput(sessionId: string, toolCallId: string): string | null {
  const filePath = resolveToolOutputSpillPath(sessionId, toolCallId);
  if (!filePath) return null;
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** 会话删除时清理该会话的 spill 目录（幂等）。 */
export function deleteSpilledToolOutputsForSession(sessionId: string): void {
  const dir = resolveSessionSpillDir(sessionId);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[tool-output-spill] 清理失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 启动时清理过期 spill 目录（默认 7 天）。
 *
 * 会话删除是主清理路径；这里兜底处理「会话从未删除」的长期磁盘增长。
 * 失败只告警。
 */
export async function pruneStaleSpilledToolOutputs(options?: { maxAgeMs?: number }): Promise<void> {
  const root = resolveSpillRoot();
  const maxAgeMs = options?.maxAgeMs ?? STALE_SPILL_MAX_AGE_MS;
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      try {
        if (now - statSync(dir).mtimeMs > maxAgeMs) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // 单个目录统计/删除失败不影响其它目录。
      }
    }
  } catch {
    // 根目录不存在（从未 spill）是正常情况。
  }
}
