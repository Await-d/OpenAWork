import { describe, expect, it } from 'vitest';
import { resolveMediaBinaryPath } from './media-binary-path.js';

describe('resolveMediaBinaryPath', () => {
  it('Given a configured resource path When resolving Then it prioritizes the configured path', () => {
    const result = resolveMediaBinaryPath('C:\\OpenAWork\\resources\\media\\ffprobe.exe', null);

    expect(result).toBe('C:\\OpenAWork\\resources\\media\\ffprobe.exe');
  });

  it('Given an empty configured path When resolving Then it falls back to the bundled path', () => {
    const result = resolveMediaBinaryPath('', '/opt/openawork/ffprobe');

    expect(result).toBe('/opt/openawork/ffprobe');
  });

  it('Given a non-string bundled path When resolving Then it returns unavailable', () => {
    const result = resolveMediaBinaryPath(undefined, { path: '/opt/openawork/ffprobe' });

    expect(result).toBeNull();
  });
});
