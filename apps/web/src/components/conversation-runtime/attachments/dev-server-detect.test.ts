import { describe, expect, it } from 'vitest';
import { detectDevServerUrl, isLikelyDevServerCommand } from './dev-server-detect.js';

describe('detectDevServerUrl', () => {
  it('detects vite output', () => {
    const output = `
  VITE v6.0.0  ready in 320 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:5173/');
  });

  it('detects next.js output', () => {
    const output = `  ▲ Next.js 15.0.0
  - Local:        http://localhost:3000

 ✓ Ready in 1.2s`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:3000');
  });

  it('normalizes 0.0.0.0 to localhost', () => {
    const output = `ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:3000');
  });

  it('detects 127.0.0.1 URLs', () => {
    const output = `Server running at http://127.0.0.1:8080/`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://127.0.0.1:8080/');
  });

  it('returns null for empty output', () => {
    expect(detectDevServerUrl('')).toBeNull();
    expect(detectDevServerUrl('no urls here')).toBeNull();
  });

  it('prefers lines with hint keywords', () => {
    const output = `
downloading http://localhost:9999/some-file.tar.gz
  ➜  Local:   http://localhost:5173/
`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:5173/');
  });

  it('handles webpack dev server', () => {
    const output = `<i> [webpack-dev-server] Project is running at http://localhost:8080/`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:8080/');
  });

  it('handles expo output', () => {
    const output = `Listening on http://localhost:8081`;
    const result = detectDevServerUrl(output);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('http://localhost:8081');
  });
});

describe('isLikelyDevServerCommand', () => {
  it.each([
    'npm run dev',
    'pnpm dev',
    'yarn start',
    'npx vite',
    'next dev',
    'nuxt dev',
    'ng serve',
    'python3 -m http.server 8000',
    'php -S localhost:8000',
  ])('returns true for "%s"', (cmd) => {
    expect(isLikelyDevServerCommand(cmd)).toBe(true);
  });

  it.each(['npm install', 'git push origin main', 'cat package.json', 'rm -rf dist'])(
    'returns false for "%s"',
    (cmd) => {
      expect(isLikelyDevServerCommand(cmd)).toBe(false);
    },
  );
});
