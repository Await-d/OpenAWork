export const MAX_SQLITE_BIND_PARAMS = 900;

export function buildSqlitePlaceholders(count: number, separator = ','): string {
  if (count <= 0) {
    throw new Error('SQLite placeholders count must be greater than 0.');
  }

  return Array.from({ length: count }, () => '?').join(separator);
}

export function chunkSqliteBindValues<T>(
  values: readonly T[],
  fixedParamCount = 0,
  maxBindParams = MAX_SQLITE_BIND_PARAMS,
  bindParamsPerValue = 1,
): T[][] {
  if (fixedParamCount < 0) {
    throw new Error('fixedParamCount must be non-negative.');
  }
  if (bindParamsPerValue <= 0) {
    throw new Error('bindParamsPerValue must be greater than 0.');
  }
  if (fixedParamCount + bindParamsPerValue > maxBindParams) {
    throw new Error('fixedParamCount must leave room for at least one chunk value.');
  }

  if (values.length === 0) {
    return [];
  }

  const chunkSize = Math.floor((maxBindParams - fixedParamCount) / bindParamsPerValue);
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += chunkSize) {
    chunks.push(values.slice(start, start + chunkSize));
  }
  return chunks;
}
