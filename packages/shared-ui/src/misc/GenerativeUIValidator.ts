import type { GenerativeUIMessage } from './GenerativeUI.js';

export const ALLOWED_SUBMIT_ROUTES: readonly string[] = [
  'agent.chat',
  'agent.action',
  'agent.approve',
];

export interface GenerativeUIValidationResult {
  valid: boolean;
  errors: string[];
}

function sanitizeString(value: string): string {
  if (value.toLowerCase().includes('<script')) {
    return '[sanitized]';
  }
  return value;
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const entries = Object.entries(source).map(([key, nestedValue]) => [
      key,
      sanitizeUnknown(nestedValue),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeUnknown(payload);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

function isGenerativeUIType(value: unknown): value is GenerativeUIMessage['type'] {
  return (
    value === 'form' ||
    value === 'table' ||
    value === 'chart' ||
    value === 'approval' ||
    value === 'code_diff' ||
    value === 'status' ||
    value === 'compaction' ||
    value === 'tool_call'
  );
}

function validateSubmitRoutes(payload: unknown, path: string, errors: string[]): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => {
      validateSubmitRoutes(entry, `${path}[${index}]`, errors);
    });
    return;
  }

  const record = payload as Record<string, unknown>;
  const submitRoute = record.submitRoute;
  if (submitRoute !== undefined) {
    if (typeof submitRoute !== 'string') {
      errors.push(`${path}.submitRoute must be a string`);
    } else if (!ALLOWED_SUBMIT_ROUTES.includes(submitRoute)) {
      errors.push(`${path}.submitRoute must be one of: ${ALLOWED_SUBMIT_ROUTES.join(', ')}`);
    }
  }

  Object.entries(record).forEach(([key, value]) => {
    validateSubmitRoutes(value, `${path}.${key}`, errors);
  });
}

export function validateGenerativeUIMessage(message: unknown): GenerativeUIValidationResult {
  const errors: string[] = [];

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const record = message as Record<string, unknown>;

  if (!isGenerativeUIType(record.type)) {
    errors.push('message.type is invalid');
  }

  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    errors.push('message.payload must be an object');
  } else {
    validateSubmitRoutes(record.payload, 'message.payload', errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
