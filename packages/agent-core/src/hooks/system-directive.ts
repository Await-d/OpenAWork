export const SYSTEM_DIRECTIVE_PREFIX = '[SYSTEM DIRECTIVE: OPENAWORK';

export const SystemDirectiveTypes = {
  TODO_CONTINUATION: 'TODO CONTINUATION',
  RALPH_LOOP: 'RALPH LOOP',
  ULTRAWORK: 'ULTRAWORK',
  ANALYZE_MODE: 'ANALYZE MODE',
  COMPACTION_CONTEXT: 'COMPACTION CONTEXT',
  PERMISSION_CONTEXT: 'PERMISSION CONTEXT',
} as const;

export type SystemDirectiveType = (typeof SystemDirectiveTypes)[keyof typeof SystemDirectiveTypes];

export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`;
}

export function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX);
}

export function hasSystemReminder(text: string): boolean {
  return /<system-reminder>[\s\S]*?<\/system-reminder>/i.test(text);
}

export function removeSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
}
