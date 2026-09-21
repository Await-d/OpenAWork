// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactWorkbench } from './artifact-workbench.js';

vi.mock('../views/artifact-preview-surface.js', () => ({
  ArtifactPreviewSurface: (props: {
    readonly artifact: ArtifactRecord;
    readonly content: string;
    readonly imageGallery?: {
      readonly items: readonly { readonly src: string }[];
      readonly index: number;
      readonly onIndexChange: (index: number) => void;
    };
  }) => (
    <div
      data-gallery-count={props.imageGallery?.items.length ?? 0}
      data-gallery-index={props.imageGallery?.index ?? -1}
      data-testid="surface-mock"
    >
      {props.imageGallery ? (
        <button
          type="button"
          data-testid="gallery-next"
          onClick={() => {
            const gallery = props.imageGallery;
            if (gallery) {
              gallery.onIndexChange(gallery.index + 1);
            }
          }}
        >
          下一张
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../views/artifact-code-editor.js', () => ({
  ArtifactCodeEditor: () => <div data-testid="code-editor-mock" />,
}));

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'img-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title: '图一',
    content: 'AAAA',
    version: 1,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

function renderWorkbench(input: {
  readonly artifact?: ArtifactRecord;
  readonly imageArtifacts?: readonly ArtifactRecord[];
  readonly omitSelectHandler?: boolean;
  readonly onSelectArtifactId?: (artifactId: string) => void;
}) {
  return render(
    <ArtifactWorkbench
      artifact={input.artifact ?? makeArtifact()}
      deleting={false}
      imageArtifacts={input.imageArtifacts ?? []}
      onDelete={vi.fn()}
      onRevert={vi.fn()}
      onSave={vi.fn()}
      revertingVersionId={null}
      saving={false}
      versions={[]}
      {...(input.omitSelectHandler
        ? {}
        : { onSelectArtifactId: input.onSelectArtifactId ?? vi.fn() })}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ArtifactWorkbench — 图片图集接线', () => {
  it('把同会话图片列表与当前下标交给预览面，切换时回写选中产物', () => {
    const onSelectArtifactId = vi.fn();
    const second = makeArtifact({ id: 'img-2', title: '图二', content: 'BBBB' });
    const markdown = makeArtifact({
      id: 'doc-1',
      type: 'markdown',
      title: '说明文档',
      content: '# 标题',
    });
    renderWorkbench({
      artifact: makeArtifact(),
      imageArtifacts: [makeArtifact(), second, markdown],
      onSelectArtifactId,
    });

    const surface = screen.getByTestId('surface-mock');
    expect(surface.getAttribute('data-gallery-count')).toBe('2');
    expect(surface.getAttribute('data-gallery-index')).toBe('0');

    fireEvent.click(screen.getByTestId('gallery-next'));

    expect(onSelectArtifactId).toHaveBeenCalledWith('img-2');
  });

  it('当前选中图片在列表中的位置决定图集下标', () => {
    const first = makeArtifact({ id: 'img-1', title: '图一' });
    const second = makeArtifact({ id: 'img-2', title: '图二', content: 'BBBB' });
    renderWorkbench({
      artifact: second,
      imageArtifacts: [first, second],
      onSelectArtifactId: vi.fn(),
    });

    expect(screen.getByTestId('surface-mock').getAttribute('data-gallery-index')).toBe('1');
  });

  it('选中项不是图片时不下发图集', () => {
    const markdown = makeArtifact({ id: 'doc-1', type: 'markdown', title: '说明文档' });
    renderWorkbench({
      artifact: markdown,
      imageArtifacts: [makeArtifact()],
      onSelectArtifactId: vi.fn(),
    });

    expect(screen.getByTestId('surface-mock').getAttribute('data-gallery-count')).toBe('0');
  });

  it('没有图片产物或没有选中回写回调时都不下发图集', () => {
    const { unmount } = renderWorkbench({ artifact: makeArtifact(), imageArtifacts: [] });
    expect(screen.getByTestId('surface-mock').getAttribute('data-gallery-count')).toBe('0');
    unmount();

    renderWorkbench({
      artifact: makeArtifact(),
      imageArtifacts: [makeArtifact()],
      omitSelectHandler: true,
    });
    expect(screen.getByTestId('surface-mock').getAttribute('data-gallery-count')).toBe('0');
  });
});
