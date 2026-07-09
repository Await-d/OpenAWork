export type JsonObject = Readonly<Record<string, unknown>>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(record: JsonObject, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

export function readBoolean(record: JsonObject, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function readNumber(record: JsonObject, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

export function readStringList(record: JsonObject, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}
