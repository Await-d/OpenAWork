import type { ArtifactRecord } from '@openAwork/artifacts';
import { HttpError } from '@openAwork/web-client';
import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewPanelArtifactsWorkspaceHref,
  formatReviewPanelArtifactsStatus,
  formatReviewPanelSectionLabel,
  getReviewPanelArtifactErrorMessage,
  hasInlineArtifactContent,
  resolveReviewPanelArtifactPreview,
  resolveSelectedArtifact,
} from './review-panel-artifact-model.js';

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title: '生成的图片',
    content: 'inline content',
    version: 1,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('resolveSelectedArtifact', () => {
  it('列表缺失或为空时返回 null', () => {
    expect(resolveSelectedArtifact(null, null)).toBeNull();
    expect(resolveSelectedArtifact([], 'artifact-1')).toBeNull();
  });

  it('选中 id 命中时返回对应条目', () => {
    const first = makeArtifact({ id: 'artifact-1' });
    const second = makeArtifact({ id: 'artifact-2' });

    expect(resolveSelectedArtifact([first, second], 'artifact-2')).toBe(second);
  });

  it('选中 id 失效时回落到首个条目', () => {
    const first = makeArtifact({ id: 'artifact-1' });
    const second = makeArtifact({ id: 'artifact-2' });

    expect(resolveSelectedArtifact([first, second], 'artifact-missing')).toBe(first);
    expect(resolveSelectedArtifact([first, second], null)).toBe(first);
  });
});

describe('hasInlineArtifactContent', () => {
  it('只有条目携带字符串 content 时才算内联可用', () => {
    expect(hasInlineArtifactContent(null)).toBe(false);
    expect(hasInlineArtifactContent(makeArtifact())).toBe(true);
    expect(hasInlineArtifactContent(makeArtifact({ content: undefined }))).toBe(false);
  });
});

describe('resolveReviewPanelArtifactPreview', () => {
  it('没有选中产物时返回 idle', () => {
    expect(resolveReviewPanelArtifactPreview(null, { kind: 'idle' })).toEqual({ kind: 'idle' });
  });

  it('列表内联内容优先于补拉状态', () => {
    expect(
      resolveReviewPanelArtifactPreview(makeArtifact(), {
        kind: 'error',
        artifactId: 'artifact-1',
        message: '不应被使用',
      }),
    ).toEqual({ kind: 'ready', content: 'inline content' });
  });

  it('缺少内联内容时按补拉状态映射 loading / ready / error', () => {
    const artifact = makeArtifact({ content: undefined });

    expect(resolveReviewPanelArtifactPreview(artifact, { kind: 'idle' })).toEqual({
      kind: 'loading',
    });
    expect(
      resolveReviewPanelArtifactPreview(artifact, { kind: 'loading', artifactId: 'artifact-1' }),
    ).toEqual({ kind: 'loading' });
    expect(
      resolveReviewPanelArtifactPreview(artifact, {
        kind: 'ready',
        artifactId: 'artifact-1',
        content: 'fetched',
      }),
    ).toEqual({ kind: 'ready', content: 'fetched' });
    expect(
      resolveReviewPanelArtifactPreview(artifact, {
        kind: 'error',
        artifactId: 'artifact-1',
        message: '读取失败',
      }),
    ).toEqual({ kind: 'error', message: '读取失败' });
  });

  it('补拉结果属于其它产物时仍视为加载中', () => {
    const artifact = makeArtifact({ id: 'artifact-2', content: undefined });

    expect(
      resolveReviewPanelArtifactPreview(artifact, {
        kind: 'ready',
        artifactId: 'artifact-1',
        content: 'stale',
      }),
    ).toEqual({ kind: 'loading' });
    expect(
      resolveReviewPanelArtifactPreview(artifact, {
        kind: 'error',
        artifactId: 'artifact-1',
        message: 'stale error',
      }),
    ).toEqual({ kind: 'loading' });
  });
});

describe('formatReviewPanelArtifactsStatus', () => {
  it('覆盖 waiting / loading / error / ready 四态文案', () => {
    expect(formatReviewPanelArtifactsStatus({ kind: 'waiting', message: '等待会话上下文' })).toBe(
      '等待会话上下文',
    );
    expect(formatReviewPanelArtifactsStatus({ kind: 'loading' })).toBe('正在加载产物');
    expect(formatReviewPanelArtifactsStatus({ kind: 'error', message: '加载产物失败' })).toBe(
      '加载产物失败',
    );
    expect(formatReviewPanelArtifactsStatus({ kind: 'ready', artifacts: [] })).toBe('0 个产物');
    expect(
      formatReviewPanelArtifactsStatus({
        kind: 'ready',
        artifacts: [makeArtifact(), makeArtifact({ id: 'artifact-2' })],
      }),
    ).toBe('2 个产物');
  });
});

describe('formatReviewPanelSectionLabel', () => {
  it('计数未知时省略括号数字', () => {
    expect(formatReviewPanelSectionLabel('产物', null)).toBe('产物');
  });

  it('计数已知时渲染括号数字（含 0）', () => {
    expect(formatReviewPanelSectionLabel('文件变更', 0)).toBe('文件变更 (0)');
    expect(formatReviewPanelSectionLabel('文件变更', 3)).toBe('文件变更 (3)');
  });
});

describe('buildReviewPanelArtifactsWorkspaceHref', () => {
  it('无会话 id 时返回 null', () => {
    expect(buildReviewPanelArtifactsWorkspaceHref(null)).toBeNull();
  });

  it('携带 sessionId 并做 URL 编码', () => {
    expect(buildReviewPanelArtifactsWorkspaceHref('session 1/x')).toBe(
      '/artifacts?sessionId=session%201%2Fx',
    );
  });
});

describe('getReviewPanelArtifactErrorMessage', () => {
  it('4xx 保留错误自身的非空可读文案', () => {
    expect(getReviewPanelArtifactErrorMessage(new HttpError('产物已被删除', 404))).toBe(
      '产物已被删除',
    );
  });

  it('4xx 空消息时回落到通用文案', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(getReviewPanelArtifactErrorMessage(new HttpError('   ', 409))).toBe(
        '产物加载失败，请稍后重试',
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('5xx 降级为通用文案，服务端细节只记录到控制台', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(
        getReviewPanelArtifactErrorMessage(
          new HttpError('读取会话产物列表失败（HTTP 503）。内部堆栈：sqlite busy', 503),
        ),
      ).toBe('产物加载失败，请稍后重试');
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('无法判定状态（非 HttpError）与空消息一律降级', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(getReviewPanelArtifactErrorMessage(new Error('boom'))).toBe(
        '产物加载失败，请稍后重试',
      );
      expect(getReviewPanelArtifactErrorMessage(new Error('   '))).toBe('产物加载失败，请稍后重试');
      expect(getReviewPanelArtifactErrorMessage('oops')).toBe('产物加载失败，请稍后重试');
      expect(consoleError).toHaveBeenCalledTimes(3);
    } finally {
      consoleError.mockRestore();
    }
  });
});
