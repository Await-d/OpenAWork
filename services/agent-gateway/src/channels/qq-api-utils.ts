export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown, key: string): string {
  if (!isRecord(value)) {
    return '';
  }
  const child = value[key];
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'number' || typeof child === 'boolean') {
    return String(child);
  }
  return '';
}

export function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  if (typeof child === 'number' && Number.isFinite(child)) {
    return child;
  }
  if (typeof child === 'string') {
    const parsed = Number(child);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseJsonObject(rawText: string, context: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    throw new Error(`Failed to parse QQ ${context} response: ${rawText.slice(0, 300)}`);
  }
  throw new Error(`Invalid QQ ${context} response: ${rawText.slice(0, 300)}`);
}
