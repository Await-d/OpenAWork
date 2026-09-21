import type { ArtifactRecord } from '@openAwork/artifacts';
import type { ImageLightboxItem } from '../../../components/chat/image/image-lightbox.js';
import { buildArtifactVirtualPath } from '../workspace/artifact-workbench-utils.js';

/**
 * 图集数据（受控模式）。
 *
 * 「图片产物列表 + 当前下标 + 切换回调」由父组件持有，预览面只负责渲染：
 * 这样产物工作台 / 审查面板的选中态是同一份事实来源，切换图片时会同步选中产物，
 * 而不是在查看器内部维护第二套索引。
 */
export interface ArtifactImageGallery {
  items: readonly ImageLightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
}

/** 只接受 `image/*` 白名单（禁止参数注入，如 `image/png;base64,...`）。 */
const IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]*$/iu;
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';

function resolveImageMimeType(artifact: Pick<ArtifactRecord, 'metadata'>): string {
  const mimeType = artifact.metadata?.['mimeType'];
  return typeof mimeType === 'string' && IMAGE_MIME_TYPE_PATTERN.test(mimeType.trim())
    ? mimeType.trim()
    : DEFAULT_IMAGE_MIME_TYPE;
}

/**
 * 把图片产物的 content 解析成可直接渲染的图片地址：
 * `data:image/` 前缀原样使用，裸 base64 按 `metadata.mimeType`（非图片白名单 / 缺省时
 * 回退 `image/png`）拼 data URL。
 * 非字符串 content（列表被裁剪等）与 `data:` 非图片前缀一律返回 `undefined`，
 * 由调用方把该条目过滤掉，避免渲染期抛错。与 ArtifactPreviewSurface 既有解析方式
 * 保持一致，不要在别处另起一套。
 */
export function resolveArtifactImageSrc(
  artifact: Pick<ArtifactRecord, 'metadata'>,
  content: string,
): string;
export function resolveArtifactImageSrc(
  artifact: Pick<ArtifactRecord, 'metadata'>,
  content: unknown,
): string | undefined;
export function resolveArtifactImageSrc(
  artifact: Pick<ArtifactRecord, 'metadata'>,
  content: unknown,
): string | undefined {
  if (typeof content !== 'string') {
    return undefined;
  }

  if (content.startsWith('data:')) {
    return content.startsWith('data:image/') ? content : undefined;
  }

  return `data:${resolveImageMimeType(artifact)};base64,${content}`;
}

interface ResolvedArtifactImageEntry {
  readonly artifactId: string;
  readonly item: ImageLightboxItem;
}

function toResolvedImageEntry(artifact: ArtifactRecord): ResolvedArtifactImageEntry | undefined {
  // 列表响应可能被裁剪：`content` 在运行时不一定存在，按 unknown 收窄后再交给解析函数。
  const content: unknown = artifact.content;
  const src = resolveArtifactImageSrc(artifact, content);
  if (!src) {
    return undefined;
  }

  return {
    artifactId: artifact.id,
    item: {
      src,
      alt: artifact.title,
      caption: artifact.title,
      fileName: buildArtifactVirtualPath(artifact),
    },
  };
}

function resolveArtifactImageEntries(
  artifacts: readonly ArtifactRecord[],
): ResolvedArtifactImageEntry[] {
  return artifacts
    .filter((artifact) => artifact.type === 'image')
    .flatMap((artifact) => {
      const entry = toResolvedImageEntry(artifact);
      return entry ? [entry] : [];
    });
}

/** 从一组产物中筛出图片类型并构造图集条目；非图片产物不进入图集。 */
export function buildArtifactImageLightboxItems(
  artifacts: readonly ArtifactRecord[],
): ImageLightboxItem[] {
  return resolveArtifactImageEntries(artifacts).map((entry) => entry.item);
}

/**
 * 构造预览面所需的图集数据。
 *
 * 选中项不是图片、内容解析不出图片地址、给定列表里没有可渲染的图片产物、或选中项
 * 不在列表中（列表被裁剪 / 会话切换中的过渡帧）时返回 `undefined`——预览面据此
 * 退化为单图放大，不凭空指向别的图片。
 */
export function buildArtifactImageGallery(
  artifacts: readonly ArtifactRecord[],
  selectedArtifact: ArtifactRecord | null,
  onSelectArtifactId: (artifactId: string) => void,
): ArtifactImageGallery | undefined {
  if (!selectedArtifact || selectedArtifact.type !== 'image') {
    return undefined;
  }

  const imageEntries = resolveArtifactImageEntries(artifacts);
  const selectedIndex = imageEntries.findIndex((entry) => entry.artifactId === selectedArtifact.id);
  if (selectedIndex < 0) {
    return undefined;
  }

  return {
    items: imageEntries.map((entry) => entry.item),
    index: selectedIndex,
    onIndexChange: (index) => {
      const target = imageEntries[index];
      if (target) {
        onSelectArtifactId(target.artifactId);
      }
    },
  };
}
