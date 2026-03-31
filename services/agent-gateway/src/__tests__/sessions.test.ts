import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
});

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

describe('createSessionSchema', () => {
  it('accepts empty body with default metadata', () => {
    const result = createSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.metadata).toEqual({});
  });

  it('accepts custom metadata', () => {
    const result = createSessionSchema.safeParse({ metadata: { tag: 'test' } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.metadata).toEqual({ tag: 'test' });
  });

  it('accepts toolSurfaceProfile in metadata', () => {
    const result = createSessionSchema.safeParse({
      metadata: { toolSurfaceProfile: 'claude_code_simple' },
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.metadata['toolSurfaceProfile']).toBe('claude_code_simple');
  });

  it('accepts null body (undefined metadata defaults to {})', () => {
    const result = createSessionSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

describe('session list query schema', () => {
  it('defaults limit=20 offset=0', () => {
    const result = querySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('coerces string numbers', () => {
    const result = querySchema.safeParse({ limit: '10', offset: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(5);
    }
  });

  it('rejects limit > 100', () => {
    const result = querySchema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });

  it('rejects negative offset', () => {
    const result = querySchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects limit < 1', () => {
    const result = querySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });
});

describe('stream request validation', () => {
  const streamSchema = z.object({
    message: z.string().min(1).max(32768),
    clientRequestId: z.string().min(1).max(128),
    model: z.string().optional(),
  });

  it('accepts valid message', () => {
    const result = streamSchema.safeParse({ message: 'Hello world', clientRequestId: 'req-1' });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = streamSchema.safeParse({ message: '', clientRequestId: 'req-1' });
    expect(result.success).toBe(false);
  });

  it('rejects message exceeding max length', () => {
    const result = streamSchema.safeParse({ message: 'x'.repeat(32769), clientRequestId: 'req-1' });
    expect(result.success).toBe(false);
  });

  it('accepts optional model field', () => {
    const result = streamSchema.safeParse({
      message: 'hi',
      clientRequestId: 'req-1',
      model: 'gpt-4',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.model).toBe('gpt-4');
  });

  it('rejects missing client request ids', () => {
    const result = streamSchema.safeParse({ message: 'hi' });
    expect(result.success).toBe(false);
  });
});
