import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeMediaBuffer: vi.fn(async (buffer: Buffer, mimeType: string) => ({
    type: 'image',
    mimeType,
    duration: 0,
    width: 1,
    height: 1,
    codec: 'png',
    sizeBytes: buffer.byteLength,
  })),
  assertSessionWorkspacePath: vi.fn((input: { path: string }) => input.path),
}));

vi.mock('../../media/ffprobe-bridge.js', () => ({
  isFFprobeAvailable: vi.fn(async () => true),
  probeMediaBuffer: mocks.probeMediaBuffer,
  probeMediaUrl: vi.fn(),
}));

vi.mock('../../workspace/workspace-safety.js', () => ({
  assertSessionWorkspacePath: mocks.assertSessionWorkspacePath,
}));

import { executeExtractMediaInfoTool } from '../../tools/extract-media-info-tool.js';

describe('executeExtractMediaInfoTool', () => {
  beforeEach(() => {
    mocks.probeMediaBuffer.mockClear();
    mocks.assertSessionWorkspacePath.mockClear();
  });

  it('reads a workspace-local media path after applying the session boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-media-'));
    const source = join(directory, 'sample.png');
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    await writeFile(source, bytes);

    const result = await executeExtractMediaInfoTool({
      userId: 'user-1',
      sessionId: 'session-1',
      toolInput: { source },
    });

    expect(result.isError).toBe(false);
    expect(mocks.assertSessionWorkspacePath).toHaveBeenCalledWith({
      path: source,
      sessionId: 'session-1',
    });
    expect(mocks.probeMediaBuffer).toHaveBeenCalledWith(bytes, 'image/png', undefined);
  });

  it('treats a relative media filename as a workspace path instead of an artifact id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-media-'));
    const source = join(directory, 'sample.png');
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    await writeFile(source, bytes);
    mocks.assertSessionWorkspacePath.mockReturnValueOnce(source);

    const result = await executeExtractMediaInfoTool({
      userId: 'user-1',
      sessionId: 'session-1',
      toolInput: { source: 'sample.png' },
    });

    expect(result.isError).toBe(false);
    expect(mocks.assertSessionWorkspacePath).toHaveBeenCalledWith({
      path: 'sample.png',
      sessionId: 'session-1',
    });
    expect(mocks.probeMediaBuffer).toHaveBeenCalledWith(bytes, 'image/png', undefined);
  });
});
