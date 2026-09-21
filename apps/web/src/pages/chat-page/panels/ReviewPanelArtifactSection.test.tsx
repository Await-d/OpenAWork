// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewPanelArtifactSection } from './ReviewPanelArtifactSection.js';
import type {
  ReviewPanelArtifactsState,
  ReviewPanelArtifactPreviewState,
} from './review-panel-artifact-model.js';

const toastMock = vi.hoisted(() => vi.fn());
const copyTextToClipboardMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../artifacts/views/artifact-preview-surface.js', () => ({
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
      data-content={props.content}
      data-gallery-count={props.imageGallery?.items.length ?? 0}
      data-gallery-index={props.imageGallery?.index ?? -1}
      data-testid="artifact-preview-surface-mock"
      data-type={props.artifact.type}
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

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

vi.mock('../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title: '生成的图片',
    content: 'data:image/png;base64,AAAA',
    version: 2,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

function renderSection(input: {
  readonly artifactsState: ReviewPanelArtifactsState;
  readonly onReload?: () => void;
  readonly onSelectArtifact?: (artifactId: string) => void;
  readonly preview?: ReviewPanelArtifactPreviewState;
  readonly selectedArtifact?: ArtifactRecord | null;
}) {
  return render(
    <MemoryRouter>
      <ReviewPanelArtifactSection
        artifactsState={input.artifactsState}
        onReload={input.onReload ?? (() => undefined)}
        onSelectArtifact={input.onSelectArtifact ?? (() => undefined)}
        preview={input.preview ?? { kind: 'idle' }}
        selectedArtifact={input.selectedArtifact ?? null}
        sessionId="session-1"
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  toastMock.mockReset();
  copyTextToClipboardMock.mockClear();
});

describe('ReviewPanelArtifactSection', () => {
  it('加载中展示 loading 文案', () => {
    renderSection({ artifactsState: { kind: 'loading' } });

    expect(screen.getByText('正在加载产物...')).not.toBeNull();
  });

  it('加载失败展示错误文案与重试按钮', () => {
    const onReload = vi.fn();
    renderSection({
      artifactsState: { kind: 'error', message: '读取会话产物列表失败（HTTP 500）。' },
      onReload,
    });

    expect(screen.getByText('读取会话产物列表失败（HTTP 500）。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('空列表展示空态并保留打开产物工作区入口', () => {
    renderSection({ artifactsState: { kind: 'ready', artifacts: [] } });

    expect(screen.getByText('本会话暂无内容型产物')).not.toBeNull();
    expect(screen.getByRole('link', { name: '打开工作区' }).getAttribute('href')).toBe(
      '/artifacts?sessionId=session-1',
    );
  });

  it('列表展示类型徽章、标题、版本与时间，点击后回调选中 id', () => {
    const onSelectArtifact = vi.fn();
    const artifacts = [
      makeArtifact({ id: 'artifact-1', title: '生成的图片', type: 'image', version: 2 }),
      makeArtifact({ id: 'artifact-2', title: '说明文档', type: 'markdown', version: 7 }),
    ];
    renderSection({
      artifactsState: { kind: 'ready', artifacts },
      onSelectArtifact,
      preview: { kind: 'ready', content: 'data:image/png;base64,AAAA' },
      selectedArtifact: artifacts[0] ?? null,
    });

    expect(screen.getByText('Image')).not.toBeNull();
    expect(screen.getByText('Markdown')).not.toBeNull();
    expect(screen.getByText('生成的图片')).not.toBeNull();
    expect(screen.getByText('说明文档')).not.toBeNull();
    expect(screen.getByText('v7')).not.toBeNull();

    const secondButton = screen.getByRole('button', { name: /说明文档/ });
    expect(secondButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(secondButton);

    expect(onSelectArtifact).toHaveBeenCalledWith('artifact-2');
  });

  it('可预览类型交给 ArtifactPreviewSurface 渲染', () => {
    const artifact = makeArtifact({ type: 'markdown', content: '# 标题' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [artifact] },
      preview: { kind: 'ready', content: '# 标题' },
      selectedArtifact: artifact,
    });

    const surface = screen.getByTestId('artifact-preview-surface-mock');
    expect(surface.getAttribute('data-type')).toBe('markdown');
    expect(surface.getAttribute('data-content')).toBe('# 标题');
    expect(surface.getAttribute('data-gallery-count')).toBe('0');
  });

  it('选中图片产物时把同会话图片列表交给预览面，切换后回写选中产物', () => {
    const onSelectArtifact = vi.fn();
    const images = [
      makeArtifact({ id: 'artifact-1', title: '图一' }),
      makeArtifact({ id: 'artifact-2', title: '图二' }),
      makeArtifact({ id: 'artifact-3', type: 'markdown', title: '说明文档', content: '# 标题' }),
    ];
    renderSection({
      artifactsState: { kind: 'ready', artifacts: images },
      onSelectArtifact,
      preview: { kind: 'ready', content: images[0]?.content ?? '' },
      selectedArtifact: images[0] ?? null,
    });

    const surface = screen.getByTestId('artifact-preview-surface-mock');
    expect(surface.getAttribute('data-gallery-count')).toBe('2');
    expect(surface.getAttribute('data-gallery-index')).toBe('0');

    fireEvent.click(screen.getByTestId('gallery-next'));

    expect(onSelectArtifact).toHaveBeenCalledWith('artifact-2');
  });

  it('选中图片不在产物列表里时不传图集，避免指向别的图片', () => {
    const orphan = makeArtifact({ id: 'artifact-orphan', title: '列表外图片' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [makeArtifact({ id: 'artifact-1' })] },
      preview: { kind: 'ready', content: orphan.content },
      selectedArtifact: orphan,
    });

    const surface = screen.getByTestId('artifact-preview-surface-mock');
    expect(surface.getAttribute('data-gallery-count')).toBe('0');
    expect(screen.queryByTestId('gallery-next')).toBeNull();
  });

  it('不可预览类型降级为元信息 + 复制内容，不渲染预览面', () => {
    const artifact = makeArtifact({ type: 'code', title: '脚本片段', content: 'const a = 1;\n' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [artifact] },
      preview: { kind: 'ready', content: 'const a = 1;\n' },
      selectedArtifact: artifact,
    });

    expect(screen.queryByTestId('artifact-preview-surface-mock')).toBeNull();
    expect(screen.getByText(/脚本片段\.txt · v2/)).not.toBeNull();
    expect(screen.getByText('const a = 1;')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '复制内容' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledWith('const a = 1;\n');
  });

  it('内容为空时降级展示空内容提示且禁用复制', () => {
    const artifact = makeArtifact({ type: 'code', content: '' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [artifact] },
      preview: { kind: 'ready', content: '' },
      selectedArtifact: artifact,
    });

    expect(screen.getByText('产物内容为空。')).not.toBeNull();
    expect(screen.getByRole('button', { name: '复制内容' }).hasAttribute('disabled')).toBe(true);
  });

  it('预览内容加载失败展示错误与重试', () => {
    const onReload = vi.fn();
    const artifact = makeArtifact({ type: 'image' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [artifact] },
      onReload,
      preview: { kind: 'error', message: '读取产物详情失败。' },
      selectedArtifact: artifact,
    });

    expect(screen.getByText('读取产物详情失败。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('预览内容加载中展示加载态', () => {
    const artifact = makeArtifact({ type: 'image' });
    renderSection({
      artifactsState: { kind: 'ready', artifacts: [artifact] },
      preview: { kind: 'loading' },
      selectedArtifact: artifact,
    });

    expect(screen.getByText('正在加载产物内容...')).not.toBeNull();
  });
});
