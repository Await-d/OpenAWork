import { describe, expect, it } from 'vitest';

import {
  SYSTEM_DIRECTIVE_PREFIX,
  createSystemDirective,
  hasSystemReminder,
  isSystemDirective,
  removeSystemReminders,
} from '../hooks/system-directive.js';

describe('system-directive helpers', () => {
  it('creates and detects system directives', () => {
    const directive = createSystemDirective('ULTRAWORK');
    expect(directive).toContain(SYSTEM_DIRECTIVE_PREFIX);
    expect(isSystemDirective(directive)).toBe(true);
  });

  it('detects and removes system reminders', () => {
    const input = 'hello\n<system-reminder>internal</system-reminder>\nworld';
    expect(hasSystemReminder(input)).toBe(true);
    expect(removeSystemReminders(input)).toBe('hello\n\nworld');
  });
});
