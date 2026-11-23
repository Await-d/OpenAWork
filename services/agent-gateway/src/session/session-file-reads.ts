/**
 * 「read 证据」的持久化与查询（`edit` / `multi_edit` 的前置校验）。
 *
 * 历史实现只扫 `audit_logs` 最近 **50** 条 `tool_name='read'` 的行，而
 * `audit_logs` 是**每次工具调用都写一行**（`infra/audit-log.ts`）——一次
 * `batch` 就是 4~5 行。高强度会话里 50 行几分钟就被 bash/grep 挤出窗口，于是
 * 「读过文件 → 跑了几十次工具 → 回来编辑」必然误报
 * `You must read file ... before editing it`（实测一次排障包 83 条里 15 条都是它）。
 *
 * 现在改为专用表精确记账：`read` 成功后 upsert，编辑前按 `(session, path)` 精确查。
 * `audit_logs` 仍保留为**旧会话兜底**——升级前读过的文件没有本表记录，不能让
 * 升级本身制造一次「所有文件都要重读」的回归。
 */
import { sqliteAll, sqliteRun } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

/**
 * 旧会话兜底窗口。
 *
 * 比历史的 50 条放宽一个数量级，既能让升级后第一次编辑不至于误报，又保留上限
 * 避免在成熟实例（`audit_logs` 可到数百 MB）上做全表扫描。新写入全部走专用表，
 * 这个窗口只会随时间自然失效。
 */
const LEGACY_AUDIT_ROW_LIMIT = 500;

interface AuditLogRow {
  input_json: string | null;
  output_json: string | null;
}

/**
 * 记录一次成功的读取。重复读同一文件只更新时间戳（主键幂等）。
 *
 * 记账失败不得影响读取本身：这是纯粹的前置证据，丢一条的代价是模型多读一次。
 */
export function recordFileRead(sessionId: string, filePath: string): void {
  if (!sessionId || !filePath) {
    return;
  }
  try {
    sqliteRun(
      `INSERT INTO session_file_reads (session_id, path, read_at)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id, path) DO UPDATE SET read_at = excluded.read_at`,
      [sessionId, filePath, Date.now()],
    );
  } catch (error) {
    logGatewayWarn('[session-file-reads] 记录 read 证据失败，已跳过：', error);
  }
}

/**
 * 从 `read` 工具的输出里取实际读取路径并记账。
 *
 * `read` 的 `execute` 拿不到 `sessionId`（工具定义本身是无状态的），因此记账放在
 * 沙箱的统一执行出口（`tool-sandbox.ts` 写审计之后、注入 AGENTS.md 之前）——
 * 那里同时有 `sessionId` 与最终结果。输出里的 `path` 是**归一化后的绝对路径**，
 * 正好是 `edit` 侧 `assertEditableWorkspaceFilePath` 传给校验的形式，两侧口径
 * 天然一致。
 */
export function recordFileReadFromToolOutput(sessionId: string, output: unknown): void {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return;
  }
  const path = (output as Record<string, unknown>)['path'];
  if (typeof path === 'string' && path.length > 0) {
    recordFileRead(sessionId, path);
  }
}

/**
 * 判断本会话是否读过该文件。
 *
 * 先查专用表（精确、无窗口），未命中再回退到 `audit_logs` 兜底（覆盖升级前的
 * 历史读取）。两条路径都只认**成功**的读取。
 */
export function hasFileReadEvidence(sessionId: string, filePath: string): boolean {
  if (!sessionId || !filePath) {
    return false;
  }
  if (hasRecordedRead(sessionId, filePath)) {
    return true;
  }
  return hasLegacyAuditRead(sessionId, filePath);
}

function hasRecordedRead(sessionId: string, filePath: string): boolean {
  try {
    const rows = sqliteAll<{ path: string }>(
      'SELECT path FROM session_file_reads WHERE session_id = ? AND path = ? LIMIT 1',
      [sessionId, filePath],
    );
    return rows.length > 0;
  } catch (error) {
    // 表不存在（未跑迁移的库）时退回旧路径，不能让编辑因为记账表缺失而全部失败。
    logGatewayWarn('[session-file-reads] 查询 read 证据失败，回退审计日志：', error);
    return false;
  }
}

function hasLegacyAuditRead(sessionId: string, filePath: string): boolean {
  try {
    const rows = sqliteAll<AuditLogRow>(
      `SELECT input_json, output_json
       FROM audit_logs
       WHERE session_id = ?
         AND is_error = 0
         AND tool_name = 'read'
       ORDER BY id DESC
       LIMIT ?`,
      [sessionId, LEGACY_AUDIT_ROW_LIMIT],
    );

    return rows.some((row) => {
      try {
        const input =
          typeof row.input_json === 'string'
            ? (JSON.parse(row.input_json) as Record<string, unknown>)
            : null;
        const output =
          typeof row.output_json === 'string'
            ? (JSON.parse(row.output_json) as Record<string, unknown>)
            : null;
        return input?.['path'] === filePath || output?.['path'] === filePath;
      } catch {
        return false;
      }
    });
  } catch (error) {
    // 库不可用 / 表缺失时按「没有证据」处理（fail-safe：模型重读一次即可），
    // 不能把编辑前置校验变成一条会中断工具调用的异常。
    logGatewayWarn('[session-file-reads] 审计日志兜底查询失败：', error);
    return false;
  }
}
