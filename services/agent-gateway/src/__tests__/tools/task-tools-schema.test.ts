/**
 * Regression coverage for the `task` (delegate_task) tool input schema.
 *
 * What this pins (intentionally — these are load-bearing for both the
 * gateway sandbox path that consumes the parsed input and the LLM
 * tool-call validator that uses the JSON schema mirror in
 * `tool-definitions.ts`):
 *
 *   - `session_id` is the canonical "continue existing child" field.
 *     The legacy `resume` name was dropped and reaching for it should
 *     be rejected as an unknown field once `additionalProperties:
 *     false` is enforced (the JSON schema mirror does — the zod
 *     schema itself is permissive by design, but we still want a
 *     test that the *new* name parses cleanly).
 *
 *   - `command` is accepted but documented as a no-op. Tests assert
 *     it parses and stays in `parsed.data` so future consumers can
 *     pick it up without a schema change.
 *
 *   - `subagent_type` ⊕ `category` (XOR) constraint stays intact:
 *     either one is required, never both.
 *
 *   - `run_in_background` and `load_skills` default to `false` and
 *     `[]` respectively when omitted (relaxed from the original
 *     opencode-derived contract to improve model compatibility).
 */

import { describe, expect, it } from 'vitest';

import { taskToolDefinition } from '../../task/task-tools.js';

const baseValid = {
  description: 'do thing',
  prompt: 'work it',
  category: 'general',
  load_skills: [],
  run_in_background: false,
};

describe('task tool — input schema basics', () => {
  it('accepts a minimal call with category-based dispatch', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
  });

  it('accepts subagent_type as an alternative to category', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      category: undefined,
      subagent_type: 'explore',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects calls that supply both category and subagent_type (XOR)', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      subagent_type: 'explore',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => /not both/.test(issue.message))).toBe(true);
    }
  });

  it('rejects calls that supply neither category nor subagent_type', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      category: undefined,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => /required/.test(issue.message))).toBe(true);
    }
  });

  it('defaults run_in_background to false when omitted', () => {
    const { run_in_background: _omit, ...rest } = baseValid;
    const parsed = taskToolDefinition.inputSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.run_in_background).toBe(false);
    }
  });

  it('defaults load_skills to [] when omitted', () => {
    const { load_skills: _omit, ...rest } = baseValid;
    const parsed = taskToolDefinition.inputSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.load_skills).toEqual([]);
    }
  });

  it('treats empty optional string fields as omitted', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      category: '',
      command: '',
      description: '',
      session_id: '',
      subagent_type: 'explore',
      task_id: '',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.category).toBeUndefined();
      expect(parsed.data.command).toBeUndefined();
      expect(parsed.data.description).toBeUndefined();
      expect(parsed.data.session_id).toBeUndefined();
      expect(parsed.data.task_id).toBeUndefined();
    }
  });

  it('treats an empty subagent_type as omitted when category is present', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      subagent_type: '',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.subagent_type).toBeUndefined();
      expect(parsed.data.category).toBe('general');
    }
  });

  it('rejects an empty required prompt', () => {
    expect(taskToolDefinition.inputSchema.safeParse({ ...baseValid, prompt: '' }).success).toBe(
      false,
    );
  });

  it('rejects calls whose category and subagent_type are both blank after normalization', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      category: '',
      subagent_type: '',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => /required/.test(issue.message))).toBe(true);
    }
  });
});

describe('task tool — session_id (replaces legacy `resume`)', () => {
  it('accepts a session_id alongside category-based dispatch', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      session_id: 'ses_abcdef',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session_id).toBe('ses_abcdef');
    }
  });

  it('treats session_id as optional', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session_id).toBeUndefined();
    }
  });

  it('treats an empty session_id as omitted', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      session_id: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session_id).toBeUndefined();
    }
  });

  it('does NOT define a `resume` field on the parsed shape', () => {
    // A safety check: zod's default behaviour silently strips unknown
    // keys (it does not error), but the parsed object must not carry
    // a typed `resume` slot. This protects callers from mistakenly
    // doing `parsed.data.resume` and getting `undefined` at runtime.
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      resume: 'ses_legacy',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const stripped = parsed.data as Record<string, unknown>;
      expect(stripped['resume']).toBeUndefined();
      expect(stripped['session_id']).toBeUndefined();
    }
  });
});

describe('task tool — command (reserved field, no-op)', () => {
  it('accepts a command identifier without rejecting the call', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      command: 'slash-init-deep',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // The field round-trips into parsed.data so a future runtime
      // hook can pick it up without a schema change.
      expect(parsed.data.command).toBe('slash-init-deep');
    }
  });

  it('treats command as optional', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.command).toBeUndefined();
    }
  });

  it('treats an empty command string as omitted', () => {
    const parsed = taskToolDefinition.inputSchema.safeParse({
      ...baseValid,
      command: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.command).toBeUndefined();
    }
  });

  it('documents the no-op intent in the description', () => {
    // The schema's runtime `.describe` text is the only place an LLM
    // sees the contract. Pin enough of it that a silent edit can't
    // turn the field into a "secret active" field without dragging
    // this test along.
    const description =
      taskToolDefinition.inputSchema._def.schema?.shape?.command?._def?.description ?? '';
    // OpenAWork 已将该 describe 文本统一为中文，校验关键约束词仍在：
    // 「保留字段」+「忽略」+ 用 prompt 表达工作。
    expect(description).toMatch(/保留字段/);
    expect(description).toMatch(/忽略/);
    expect(description).toMatch(/prompt/);
  });
});
