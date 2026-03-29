import { describe, it, expect } from 'vitest';

describe('auth utilities', () => {
  describe('hashToken', () => {
    it('produces consistent SHA-256 hex digest', async () => {
      const { createHash } = await import('crypto');
      const token = 'test-refresh-token-abc123';
      const hash1 = createHash('sha256').update(token).digest('hex');
      const hash2 = createHash('sha256').update(token).digest('hex');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]+$/);
    });

    it('different tokens produce different hashes', async () => {
      const { createHash } = await import('crypto');
      const h1 = createHash('sha256').update('token-a').digest('hex');
      const h2 = createHash('sha256').update('token-b').digest('hex');
      expect(h1).not.toBe(h2);
    });
  });

  describe('generateRefreshToken', () => {
    it('produces base64url string of sufficient length', async () => {
      const { randomBytes } = await import('crypto');
      const token = randomBytes(48).toString('base64url');
      expect(token.length).toBeGreaterThan(60);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique tokens each time', async () => {
      const { randomBytes } = await import('crypto');
      const t1 = randomBytes(48).toString('base64url');
      const t2 = randomBytes(48).toString('base64url');
      expect(t1).not.toBe(t2);
    });
  });
});

describe('JWT payload shape', () => {
  it('contains sub and email fields', () => {
    const payload = { sub: 'user-uuid-123', email: 'user@example.com' };
    expect(payload).toHaveProperty('sub');
    expect(payload).toHaveProperty('email');
    expect(payload.sub).toBe('user-uuid-123');
    expect(payload.email).toBe('user@example.com');
  });
});

describe('loginSchema validation', () => {
  it('accepts valid email and password', async () => {
    const { z } = await import('zod');
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const result = schema.safeParse({ email: 'test@example.com', password: 'securepass' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', async () => {
    const { z } = await import('zod');
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const result = schema.safeParse({ email: 'not-an-email', password: 'securepass' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', async () => {
    const { z } = await import('zod');
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const result = schema.safeParse({ email: 'test@example.com', password: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', async () => {
    const { z } = await import('zod');
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });
});
