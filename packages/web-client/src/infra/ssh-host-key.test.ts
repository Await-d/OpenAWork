import { afterEach, expect, it, vi } from 'vitest';
import { createSshClient } from './ssh.js';
afterEach(() => vi.unstubAllGlobals());
it('指纹更新使用认证请求与连接 ID 编码', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', request);
  const input = {
    expectedFingerprint: 'SHA256:' + 'A'.repeat(43),
    fingerprint: 'SHA256:' + 'B'.repeat(43),
  };
  await createSshClient('http://localhost:3000').trustHostKey('test-token', 'conn/id', input);
  expect(request).toHaveBeenCalledWith('http://localhost:3000/ssh/connections/conn%2Fid/host-key', {
    method: 'PUT',
    signal: expect.any(AbortSignal),
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
});
