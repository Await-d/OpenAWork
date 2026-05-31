/**
 * Regression (§0.121, opkg CLI network timeout): the opkg gateway client's
 * fetch calls (install / remove / push) had no wall-clock deadline, so a hung
 * or half-open gateway connection wedged the CLI command forever — the only
 * unbounded network paths left in the gateway package. Each call now carries an
 * AbortSignal.timeout deadline (overridable via OPKG_REQUEST_TIMEOUT_MS /
 * OPKG_PUSH_TIMEOUT_MS) and surfaces a clear "timed out" error. We set a tiny
 * deadline, make fetch hang until aborted, and assert the timeout message.
 */

// Set before importing the module — the deadline constants are read at load.
process.env['OPKG_REQUEST_TIMEOUT_MS'] = '50';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('opkg gateway client network timeout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('install rejects with a clear timeout message when the gateway never responds', async () => {
    // Hang until the request's own timeout signal aborts, then reject like
    // AbortSignal.timeout does (TimeoutError DOMException).
    vi.mocked(globalThis.fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out.', 'TimeoutError'));
          });
        }),
    );

    const { installSkill } = await import('../../cli/opkg-gateway.js');

    await expect(
      installSkill({ gatewayBaseUrl: 'http://127.0.0.1:9', authToken: 't' }, 'some-skill'),
    ).rejects.toThrow(/timed out/);
  });
});
