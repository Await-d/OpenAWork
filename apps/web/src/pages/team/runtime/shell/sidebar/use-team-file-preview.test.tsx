// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamFilePreview } from './use-team-file-preview.js';

const readFileMock = vi.fn();
const readFileBinaryMock = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => ({
    readFile: readFileMock,
    readFileBinary: readFileBinaryMock,
  }),
}));

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  readFileMock.mockReset();
  readFileBinaryMock.mockReset();
  localStorage.clear();
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'https://gw.test',
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useTeamFilePreview', () => {
  it('图片文件预览走二进制读取并在关闭时释放 blob URL', async () => {
    readFileBinaryMock.mockResolvedValue({
      buffer: Uint8Array.from([137, 80, 78, 71]).buffer,
      contentType: 'image/png',
    });
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:openawork-image-preview');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { result } = renderHook(() => useTeamFilePreview('/workspace/demo'));

    act(() => {
      result.current.preview('/workspace/demo/assets/cover.png');
    });
    await flushAsyncWork();

    expect(readFileBinaryMock).toHaveBeenCalledWith(
      'token-test',
      '/workspace/demo/assets/cover.png',
      { workspaceRoot: '/workspace/demo' },
    );
    expect(readFileMock).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(result.current.content).toBe('blob:openawork-image-preview');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.close();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:openawork-image-preview');
  });
});
