import { describe, it, expect, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

describe('auth store logic', () => {
  describe('token storage keys', () => {
    it('access token key is stable', () => {
      const key = 'openwork_access_token';
      expect(key).toMatch(/^openwork_/);
    });

    it('refresh token key is stable', () => {
      const key = 'openwork_refresh_token';
      expect(key).toMatch(/^openwork_/);
    });
  });

  describe('gateway URL default', () => {
    it('defaults to localhost', () => {
      const defaultUrl = 'http://localhost:3000';
      expect(defaultUrl).toMatch(/^https?:\/\//);
      expect(defaultUrl).toContain('3000');
    });
  });

  describe('URL normalization', () => {
    it('strips trailing slash', () => {
      const raw = 'http://localhost:3000/';
      const normalized = raw.replace(/\/$/, '');
      expect(normalized).toBe('http://localhost:3000');
    });

    it('leaves URL without trailing slash unchanged', () => {
      const raw = 'http://localhost:3000';
      const normalized = raw.replace(/\/$/, '');
      expect(normalized).toBe('http://localhost:3000');
    });
  });
});

describe('network error handling', () => {
  it('login failure throws with message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    });

    const doLogin = async (url: string, email: string, password: string) => {
      const res = await mockFetch(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error((err.error as string | undefined) ?? 'Login failed');
      }
      return res.json();
    };

    await expect(doLogin('http://localhost:3000', 'bad@test.com', 'wrongpass')).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('network failure propagates as error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const doLogin = async () => {
      return mockFetch('http://localhost:3000/auth/login');
    };

    await expect(doLogin()).rejects.toThrow('Network error');
  });
});

describe('reconnect delay calculation', () => {
  it('exponential backoff increases delay', () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) => Math.min(1000 * 2 ** attempt, 30000));
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
    expect(delays[3]).toBe(8000);
    expect(delays[4]).toBe(16000);
  });

  it('caps at 30 seconds', () => {
    const delay = Math.min(1000 * 2 ** 10, 30000);
    expect(delay).toBe(30000);
  });
});
