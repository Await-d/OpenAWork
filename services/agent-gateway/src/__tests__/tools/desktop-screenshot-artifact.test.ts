import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMediaArtifact: vi.fn(),
}));

vi.mock('../../media/media-artifact.js', () => ({
  createMediaArtifact: mocks.createMediaArtifact,
}));

import {
  createDesktopScreenshotArtifactToolResult,
  decodeDesktopScreenshotPayload,
  readDesktopControlScreenshotPayload,
} from '../../tools/desktop-screenshot-artifact.js';

describe('desktop-screenshot-artifact', () => {
  it('stores screenshot output as an artifact-backed attachment', () => {
    mocks.createMediaArtifact.mockReturnValue({
      artifactId: 'artifact-screen-1',
      title: 'Desktop control screenshot',
      fileName: 'desktop-control-screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      metadata: {},
    });

    const result = createDesktopScreenshotArtifactToolResult({
      userId: 'user-1',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      screenshotPayload: 'ZmFrZQ==',
      title: 'Desktop control screenshot',
      summary: '已保存系统桌面截图。',
      sourceKind: 'tool_desktop_control_screenshot',
      createdByNote: 'desktop_control screenshot',
    });

    expect(JSON.parse(result.output)).toMatchObject({
      success: true,
      artifactId: 'artifact-screen-1',
      fileName: 'desktop-control-screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      summary: '已保存系统桌面截图。',
    });
    expect(result.attachments).toEqual([
      {
        type: 'input_image',
        artifactId: 'artifact-screen-1',
        detail: 'high',
        fileName: 'desktop-control-screenshot.png',
        mimeType: 'image/png',
      },
    ]);
    expect(mocks.createMediaArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
        toolCallId: 'call-1',
        mimeType: 'image/png',
      }),
    );
  });

  it('prefers explicit data-url mime types when decoding screenshots', () => {
    const decoded = decodeDesktopScreenshotPayload('data:image/jpeg;base64,ZmFrZQ==');

    expect(decoded.mimeType).toBe('image/jpeg');
    expect(decoded.buffer.toString('utf-8')).toBe('fake');
  });

  it('reads desktop-control screenshot payload from common fields', () => {
    expect(readDesktopControlScreenshotPayload({ data: 'abc' })).toBe('abc');
    expect(readDesktopControlScreenshotPayload({ screenshotBase64: 'xyz' })).toBe('xyz');
    expect(readDesktopControlScreenshotPayload({ imageBase64: 'img' })).toBe('img');
    expect(readDesktopControlScreenshotPayload({ ok: true })).toBeNull();
  });
});
