export function isSqliteMalformedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /database disk image is malformed/iu.test(error.message);
}

/**
 * SQLite 约束错误（FK / UNIQUE / NOT NULL / CHECK）。这类失败由请求携带的数据违反约束
 * 引起，属于客户端/数据错误，不应被当作内部故障返回 500。`better-sqlite3` 会带上
 * `SQLITE_CONSTRAINT_*` 形式的 `code`，但消息文本是跨驱动稳定的兜底判据。
 */
export function isSqliteConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    return true;
  }

  const message = 'message' in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && /constraint failed/iu.test(message);
}
