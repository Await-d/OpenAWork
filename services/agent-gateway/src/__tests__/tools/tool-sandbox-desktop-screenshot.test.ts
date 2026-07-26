import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{"yoloMode":true}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
  desktopControlScreenshotMock: vi.fn(async () => ({ data: 'ZmFrZQ==' })),
  createDesktopScreenshotArtifactToolResultMock: vi.fn(() => ({
    output: '{"success":true,"artifactId":"artifact-screen-1"}',
    attachments: [
      {
        type: 'input_image' as const,
        artifactId: 'artifact-screen-1',
        fileName: 'desktop-control-screenshot.png',
        mimeType: 'image/png',
        detail: 'high' as const,
      },
    ],
  })),
  readDesktopControlScreenshotPayloadMock: vi.fn(() => 'ZmFrZQ=='),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

vi.mock('../../tools/plugin-tool-settings.js', () => ({
  isDesktopControlPluginEnabledForUser: vi.fn(() => true),
}));

vi.mock('../../tools/desktop-screenshot-artifact.js', () => ({
  createDesktopScreenshotArtifactToolResult: mocks.createDesktopScreenshotArtifactToolResultMock,
  readDesktopControlScreenshotPayload: mocks.readDesktopControlScreenshotPayloadMock,
}));

vi.mock('../../tools/desktop-control.js', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- typeof import() 是 vitest mock 常见模式
  const actual = await vi.importActual<typeof import('../../tools/desktop-control.js')>(
    '../../tools/desktop-control.js',
  );
  return {
    ...actual,
    desktopControlManager: {
      status: vi.fn(async () => ({ enabled: true })),
      screenshot: mocks.desktopControlScreenshotMock,
      click: vi.fn(),
      type: vi.fn(),
      key: vi.fn(),
      hotkey: vi.fn(),
      scroll: vi.fn(),
      wait: vi.fn(),
    },
  };
});

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

describe('tool-sandbox desktop screenshot artifact path', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockClear();
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockClear();
    mocks.desktopControlScreenshotMock.mockClear();
    mocks.createDesktopScreenshotArtifactToolResultMock.mockClear();
    mocks.readDesktopControlScreenshotPayloadMock.mockClear();
  });

  it('desktop_control screenshot returns artifact-backed attachments instead of base64 output', async () => {
    const sandbox = createDefaultSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-desktop-screen-1',
        toolName: 'desktop_control',
        rawInput: { action: 'screenshot', delayMs: 120 },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-desktop-screen-1',
        nextRound: 1,
        requestData: { clientRequestId: 'req-desktop-screen-1' },
      },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe('{"success":true,"artifactId":"artifact-screen-1"}');
    expect(result.attachments).toEqual([
      {
        type: 'input_image',
        artifactId: 'artifact-screen-1',
        fileName: 'desktop-control-screenshot.png',
        mimeType: 'image/png',
        detail: 'high',
      },
    ]);
    expect(mocks.desktopControlScreenshotMock).toHaveBeenCalledWith({
      action: 'screenshot',
      delayMs: 120,
    });
    expect(mocks.readDesktopControlScreenshotPayloadMock).toHaveBeenCalledWith({
      data: 'ZmFrZQ==',
    });
    expect(mocks.createDesktopScreenshotArtifactToolResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
        toolCallId: 'call-desktop-screen-1',
        screenshotPayload: 'ZmFrZQ==',
        sourceKind: 'tool_desktop_control_screenshot',
      }),
    );
  });
});
