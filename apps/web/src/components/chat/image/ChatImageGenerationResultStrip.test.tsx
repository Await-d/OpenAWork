// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatImageGenerationResultStrip } from './ChatImageGenerationResultStrip.js';

const useGenerateImageArtifactMock = vi.hoisted(() => vi.fn());

vi.mock('../tool-call/generate-image/use-artifact.js', () => ({
  useGenerateImageArtifact: useGenerateImageArtifactMock,
}));

const IMAGE_SRC = 'data:image/png;base64,AAAA';
const ARTIFACT_TITLE = '结果图';
const ZOOM_BUTTON_NAME = '放大查看生成的图片';

/** token 断言只看实际声明，避免 CSS 注释里提到的 token 名干扰 `not.toContain`。 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface ArtifactStateOverrides {
  fetchError?: string | null;
  fileName?: string;
  imageLoading?: boolean;
  imageSrc?: string | null;
  retry?: () => void;
}

function arrangeArtifact(overrides: ArtifactStateOverrides = {}): { retry: () => void } {
  const retry = overrides.retry ?? vi.fn();
  useGenerateImageArtifactMock.mockReturnValue({
    imageSrc: overrides.imageSrc === undefined ? IMAGE_SRC : overrides.imageSrc,
    imageLoading: overrides.imageLoading ?? false,
    fetchError: overrides.fetchError ?? null,
    fileName: overrides.fileName ?? 'generated-image.png',
    retry,
  });
  return { retry };
}

function renderStrip(props: Partial<ComponentProps<typeof ChatImageGenerationResultStrip>> = {}) {
  return render(
    <ChatImageGenerationResultStrip
      artifactTitle={ARTIFACT_TITLE}
      modelLabel="GPT Image 2"
      onOpenArtifactsWorkspace={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useGenerateImageArtifactMock.mockReset();
});

describe('ChatImageGenerationResultStrip', () => {
  it('无 artifactId 时不渲染缩略图，保持原有文案与按钮', () => {
    renderStrip();

    expect(screen.getByText('最新图片结果')).toBeTruthy();
    expect(screen.getByText(ARTIFACT_TITLE)).toBeTruthy();
    expect(screen.getByText('GPT Image 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开产物工作区' })).toBeTruthy();
    expect(screen.queryByTestId('chat-image-generation-thumbnail')).toBeNull();
    expect(screen.queryByTestId('chat-image-generation-thumbnail-zoom')).toBeNull();
    expect(screen.queryByTestId('chat-image-generation-thumbnail-loading')).toBeNull();
    expect(screen.queryByTestId('chat-image-generation-thumbnail-error')).toBeNull();
    expect(useGenerateImageArtifactMock).not.toHaveBeenCalled();
  });

  it('有 artifactId 时渲染缩略图：容器无按钮语义，鼠标点击图片打开放大预览', () => {
    arrangeArtifact();
    renderStrip({ artifactId: 'artifact-1' });

    expect(useGenerateImageArtifactMock).toHaveBeenCalledWith('artifact-1');
    const thumbnail = screen.getByTestId('chat-image-generation-thumbnail');
    // 容器不再承担按钮 / 焦点语义，交互责任全部交给独立的「放大查看」按钮。
    expect(thumbnail.getAttribute('role')).toBeNull();
    expect(thumbnail.getAttribute('tabindex')).toBeNull();

    const thumbnailImage = screen.getByAltText(`${ARTIFACT_TITLE} 缩略图`);
    expect(thumbnailImage.getAttribute('src')).toBe(IMAGE_SRC);
    expect(screen.queryByAltText(ARTIFACT_TITLE)).toBeNull();

    fireEvent.click(thumbnailImage);
    expect(screen.getByAltText(ARTIFACT_TITLE)).toBeTruthy();
    // 容器点击与内部点击收敛为单一触发路径，不会渲染出两个查看器。
    expect(document.querySelectorAll('.image-lightbox')).toHaveLength(1);
  });

  it('「放大查看」按钮与 GenerateImageDisplay 同级，点击即可打开预览', () => {
    arrangeArtifact();
    renderStrip({ artifactId: 'artifact-1' });

    const zoomButton = screen.getByRole('button', { name: ZOOM_BUTTON_NAME });
    expect(zoomButton.tagName).toBe('BUTTON');
    expect(zoomButton.getAttribute('type')).toBe('button');
    expect(zoomButton.getAttribute('tabindex')).toBeNull();
    // 按钮挂在缩略图容器上、且是容器最后一个子元素，而不是嵌进 GenerateImageDisplay 内部。
    const thumbnail = screen.getByTestId('chat-image-generation-thumbnail');
    expect(zoomButton.parentElement).toBe(thumbnail);
    expect(thumbnail.lastElementChild).toBe(zoomButton);

    fireEvent.click(zoomButton);
    expect(screen.getByAltText(ARTIFACT_TITLE)).toBeTruthy();
    expect(document.querySelectorAll('.image-lightbox')).toHaveLength(1);
  });

  it('键盘可聚焦并激活「放大查看」按钮打开预览', () => {
    arrangeArtifact();
    renderStrip({ artifactId: 'artifact-1' });

    const zoomButton = screen.getByRole('button', { name: ZOOM_BUTTON_NAME });
    zoomButton.focus();
    expect(document.activeElement).toBe(zoomButton);

    // 原生 <button> 的 Enter / Space 由浏览器合成 click，无需手写 onKeyDown；
    // jsdom 不实现该键盘合成，这里以「聚焦后激活」等价验证按钮的启用路径。
    fireEvent.click(zoomButton);
    expect(screen.getByAltText(ARTIFACT_TITLE)).toBeTruthy();
  });

  it('内层下载按钮的 Enter 不再被缩略图容器劫持为打开预览', () => {
    arrangeArtifact();
    renderStrip({ artifactId: 'artifact-1' });

    const downloadButton = screen.getByTitle('下载图片');
    downloadButton.focus();
    fireEvent.keyDown(downloadButton, { key: 'Enter' });
    fireEvent.keyUp(downloadButton, { key: 'Enter' });

    expect(screen.queryByAltText(ARTIFACT_TITLE)).toBeNull();
  });

  it('拉图期间渲染骨架占位而不是空白', () => {
    arrangeArtifact({ imageSrc: null, imageLoading: true });
    renderStrip({ artifactId: 'artifact-1' });

    expect(screen.getByTestId('chat-image-generation-thumbnail-loading')).toBeTruthy();
    expect(screen.queryByTestId('chat-image-generation-thumbnail')).toBeNull();
    expect(screen.queryByTestId('chat-image-generation-thumbnail-zoom')).toBeNull();
    expect(screen.queryByAltText(`${ARTIFACT_TITLE} 缩略图`)).toBeNull();
  });

  it('拉图失败时渲染重试按钮，原始错误只进 console.error 不落 DOM', () => {
    const rawError = '图片 artifact 内容为空';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockReturnValue(undefined);
    const { retry } = arrangeArtifact({ imageSrc: null, fetchError: rawError });
    renderStrip({ artifactId: 'artifact-1' });

    const errorTile = screen.getByTestId('chat-image-generation-thumbnail-error');
    expect(errorTile.textContent).toContain('图片加载失败');
    expect(screen.queryByAltText(`${ARTIFACT_TITLE} 缩略图`)).toBeNull();

    // 原始错误既不出现在文本里，也不出现在 title 等属性里。
    expect(document.body.innerHTML).not.toContain(rawError);
    const retryButton = screen.getByTestId('chat-image-generation-thumbnail-retry');
    expect(retryButton.getAttribute('title')).toBe('图片加载失败');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[chat-image-result-thumbnail] 图片加载失败', {
      artifactId: 'artifact-1',
      fetchError: rawError,
    });

    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('chat-image-generation-result-thumbnail.css 主题 token', () => {
  // vitest 的 root / cwd 是 apps/web（vitest.config.ts 所在目录）。
  const readCss = (relativePath: string): string =>
    readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
  const cssSource = stripCssComments(
    readCss('src/components/chat/image/chat-image-generation-result-thumbnail.css'),
  );

  it('放大按钮覆盖 hover / active / focus-visible，禁止硬编码色值与 accent 填充文字色', () => {
    // 容器已不再是 role=button，样式中不得残留对应选择器。
    expect(cssSource).not.toContain("[role='button']");
    // --fg-on-accent 只允许出现在 accent 实色填充之上，这里是中性浮层，禁止使用。
    expect(cssSource).not.toContain('--fg-on-accent');
    expect(cssSource).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(cssSource).not.toMatch(/rgba?\(/);

    expect(cssSource).toContain('.chat-image-result-thumb__zoom:hover');
    expect(cssSource).toContain('.chat-image-result-thumb__zoom:active');
    expect(cssSource).toContain('.chat-image-result-thumb__zoom:focus-visible');
    expect(cssSource).toContain('outline: 2px solid var(--accent)');
    expect(cssSource).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');
    expect(cssSource).toContain('color: var(--fg-strong)');
    expect(cssSource).toContain('background: var(--bg-elevated)');
    expect(cssSource).toContain('border: 1px solid var(--border-emphasis)');
  });
});
