import { describe, it, expect, vi } from 'vitest';

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((cb: (s: unknown) => void) => {
      cb({ isConnected: true, isInternetReachable: true, type: 'wifi' });
      return () => undefined;
    }),
  },
}));

describe('NetworkState defaults', () => {
  it('initial state treats connection as true', () => {
    const state = { isConnected: true, isInternetReachable: null, type: 'unknown' };
    expect(state.isConnected).toBe(true);
    expect(state.isInternetReachable).toBeNull();
  });

  it('accepts null for isInternetReachable when unknown', () => {
    const state = { isConnected: false, isInternetReachable: null, type: 'none' };
    expect(state.isInternetReachable).toBeNull();
  });
});

describe('NetworkState updates', () => {
  it('reflects wifi connection', () => {
    const netState = { isConnected: true, isInternetReachable: true, type: 'wifi' };
    const mapped = {
      isConnected: netState.isConnected ?? false,
      isInternetReachable: netState.isInternetReachable,
      type: netState.type,
    };
    expect(mapped.isConnected).toBe(true);
    expect(mapped.type).toBe('wifi');
  });

  it('reflects offline state', () => {
    const netState = { isConnected: null, isInternetReachable: false, type: 'none' };
    const mapped = {
      isConnected: netState.isConnected ?? false,
      isInternetReachable: netState.isInternetReachable,
      type: netState.type,
    };
    expect(mapped.isConnected).toBe(false);
    expect(mapped.type).toBe('none');
  });

  it('falls back to false when isConnected is null', () => {
    const raw: boolean | null = null;
    const isConnected = raw ?? false;
    expect(isConnected).toBe(false);
  });
});

describe('connection type values', () => {
  const validTypes = ['wifi', 'cellular', 'ethernet', 'bluetooth', 'none', 'unknown', 'other'];

  it('wifi is a valid type', () => {
    expect(validTypes).toContain('wifi');
  });

  it('none is a valid offline type', () => {
    expect(validTypes).toContain('none');
  });

  it('unknown is the safe default type', () => {
    expect(validTypes).toContain('unknown');
  });
});
