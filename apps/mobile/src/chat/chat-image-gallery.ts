/**
 * 聊天消息图片图集的平台无关纯逻辑层（W3 / T-14）。
 *
 * 职责：把 `message.inputImages`（`collectInputImages` 保序、不去重、不限量）投影成
 * 查看器图集条目，并给出「源条目 → 图集下标」的映射。URI 由调用方（hook）以
 * `artifactId → uri` 表传入；**只有能解析出可用地址的条目才进入图集**——与 Web 端
 * `buildArtifactImageGallery` 的「丢弃不可渲染项」一致，也与本模块构造图集时的
 * `buildGallery` 过滤语义一致。
 *
 * 关键设计（索引稳定性）：
 * - 条目 id 携带**原始下标**（`input-image:<sourceIndex>`），因此重复条目（同
 *   `artifactId` / 同内容出现多次）互不覆盖，且图集在解析完成前不会变化（调用点
 *   先解析整条消息、后打开查看器）；
 * - `indexOf` 走**源条目引用 → 原始下标 → 图集下标**两级映射：气泡渲染第 3 项、
 *   但前 2 项不可渲染时，点击得到的仍是图集里的真实位置，而不是「渲染时第几个」。
 *
 * 构造复用 `components/image-viewer/lightbox-model` 的 `buildGallery`：过滤、保序、
 * 选中项守卫全部由它保证，本模块只做投影与回映射。
 *
 * 模块不 import `react` / `react-native`，可在纯 Node（Vitest）下直接测试。
 */

import {
  buildGallery,
  type GalleryItem,
  type GallerySourceImage,
} from '../components/image-viewer/lightbox-model';
import type { MobileInputImage } from './chat-message-content';

/** 图集条目 id 前缀；后缀是 `inputImages` 里的原始下标。 */
const MESSAGE_IMAGE_ITEM_ID_PREFIX = 'input-image:';

/**
 * 图集条目：`GalleryItem` 的投影 + 来源下标。
 *
 * 结构上兼容查看器的 `ImageLightboxItem`（多出的字段不参与渲染，只服务于回映射）。
 */
export interface MessageImageGalleryItem {
  readonly id: string;
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fileName?: string;
  /** 该条目在 `message.inputImages` 中的下标（保序证据）。 */
  readonly sourceIndex: number;
}

/** 单条消息的图集：过滤后的条目 + 源条目 → 图集下标映射。 */
export interface MessageImageGallery {
  readonly items: readonly MessageImageGalleryItem[];
  /**
   * 源条目 → 图集下标；不可渲染 / 不属于本图集时返回 -1。
   *
   * 按**对象引用**查找（调用点持有的是 `inputImages` 里的同一引用），与
   * `message.inputImages` 中「同一对象被放两次」的极端情况相比，真实数据里每次
   * `collectInputImages` 都会新建对象，因此引用唯一。
   */
  readonly indexOf: (source: MobileInputImage) => number;
}

/** `imageUrl` 是否已有可直接渲染的地址（无需走 artifact 解析）。 */
export function hasRenderableImageUrl(image: MobileInputImage): boolean {
  const imageUrl = image.imageUrl;
  return typeof imageUrl === 'string' && imageUrl.length > 0;
}

/**
 * 解析单条 `input_image` 的渲染地址：`imageUrl` 直用，否则查 `artifactId → uri` 表。
 *
 * 与 Web 端一致：解析不出地址的条目由调用方丢弃（不伪造占位地址）。
 */
export function resolveInputImageUri(
  image: MobileInputImage,
  uriById: ReadonlyMap<string, string>,
): string | undefined {
  if (hasRenderableImageUrl(image)) {
    return image.imageUrl;
  }
  const artifactId = image.artifactId;
  if (typeof artifactId !== 'string' || artifactId.length === 0) {
    return undefined;
  }
  const resolved = uriById.get(artifactId);
  return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined;
}

/**
 * 收集「需要走 artifact 解析」的 id 列表。
 *
 * - 跳过已有 `imageUrl` 的条目（点击预览**不得**再发请求）；
 * - 跳过空 `artifactId`；
 * - **保序、保留重复**：同一条消息内重复出现的 id 由 W1 取数层的 in-flight 去重
 *   合并成一次请求，这里不再自建一套去重表。
 */
export function collectInputImageArtifactIds(
  inputImages: readonly MobileInputImage[] | null | undefined,
): string[] {
  const artifactIds: string[] = [];
  for (const image of inputImages ?? []) {
    if (hasRenderableImageUrl(image)) {
      continue;
    }
    const artifactId = image.artifactId;
    if (typeof artifactId === 'string' && artifactId.length > 0) {
      artifactIds.push(artifactId);
    }
  }
  return artifactIds;
}

/** `GallerySourceImage.content` 承载的是**已解析地址**；resolver 直接回读。 */
function resolveProjectedImageSrc(image: GallerySourceImage): string | undefined {
  const content = image.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

/**
 * 由消息的 `inputImages` 与解析结果构造图集。
 *
 * - `inputImages` 为空 / 全部不可渲染 → `undefined`；
 * - 条目顺序 = `inputImages` 顺序（`buildGallery` 保序过滤）；
 * - `alt` 取 `fileName`（无真实 alt 时，文件名比泛化文案对读屏更有信息量）。
 */
export function buildMessageImageGallery(
  inputImages: readonly MobileInputImage[] | null | undefined,
  uriById: ReadonlyMap<string, string>,
): MessageImageGallery | undefined {
  const sources = inputImages ?? [];
  if (sources.length === 0) {
    return undefined;
  }

  const sourceIndexById = new Map<string, number>();
  const projected: GallerySourceImage[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const src = resolveInputImageUri(source, uriById);
    if (!src) {
      continue;
    }
    const id = `${MESSAGE_IMAGE_ITEM_ID_PREFIX}${sourceIndex}`;
    sourceIndexById.set(id, sourceIndex);
    projected.push({
      id,
      type: 'image',
      // 只作为 `buildGallery` 的解析输入；语义见 `resolveProjectedImageSrc`。
      content: src,
      ...(source.fileName ? { fileName: source.fileName } : {}),
      ...(source.mimeType ? { mimeType: source.mimeType } : {}),
      ...(source.fileName ? { alt: source.fileName } : {}),
    });
  }
  if (projected.length === 0) {
    return undefined;
  }

  // `buildGallery` 的选中项守卫需要一个必然可渲染的 selected：取过滤后的首项。
  const selected = projected[0];
  if (!selected) {
    return undefined;
  }
  const gallery = buildGallery({ images: projected, selected }, resolveProjectedImageSrc);
  if (!gallery) {
    return undefined;
  }

  const itemIndexBySourceIndex = new Map<number, number>();
  const items: MessageImageGalleryItem[] = gallery.items.map((item: GalleryItem, itemIndex) => {
    const sourceIndex = sourceIndexById.get(item.id);
    if (sourceIndex !== undefined) {
      itemIndexBySourceIndex.set(sourceIndex, itemIndex);
    }
    return {
      id: item.id,
      src: item.src,
      ...(item.alt !== undefined ? { alt: item.alt } : {}),
      ...(item.caption !== undefined ? { caption: item.caption } : {}),
      ...(item.fileName !== undefined ? { fileName: item.fileName } : {}),
      sourceIndex: sourceIndex ?? -1,
    };
  });

  return {
    items,
    indexOf: (source: MobileInputImage): number => {
      const sourceIndex = sources.indexOf(source);
      if (sourceIndex < 0) {
        return -1;
      }
      return itemIndexBySourceIndex.get(sourceIndex) ?? -1;
    },
  };
}
