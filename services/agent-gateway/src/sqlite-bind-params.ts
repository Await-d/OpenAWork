export type SqliteBoundValue = string | number | bigint | Uint8Array | null;

export type SqliteBindableValue = SqliteBoundValue | boolean | undefined;

function describeUnsupportedValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function normalizeUnknownSqliteBindValue(value: unknown): SqliteBoundValue {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  throw new TypeError(`Unsupported SQLite bind parameter type: ${describeUnsupportedValue(value)}`);
}

export function normalizeSqliteBindParams(
  params: readonly SqliteBindableValue[],
): SqliteBoundValue[] {
  return params.map((value) => normalizeUnknownSqliteBindValue(value));
}

export function normalizeUnknownSqliteBindParams(params: readonly unknown[]): SqliteBoundValue[] {
  return params.map((value) => normalizeUnknownSqliteBindValue(value));
}
