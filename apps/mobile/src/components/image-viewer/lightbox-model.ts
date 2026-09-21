/**
 * 移动端图片查看器的平台无关纯逻辑层（Phase 2 / T-06~T-07）。
 *
 * 这里是 `ImageLightboxModal` 的数据契约单一事实来源：索引解析、边界不回绕、
 * 变换 reducer、图集构造、src 解析与尺寸 / 文案兜底。模块**不 import
 * `react` / `react-native`**，可在纯 Node（Vitest）下直接测试。
 *
 * 语义基线（**对齐契约，代码不复用**）：
 * - `apps/web/src/components/chat/image/image-lightbox.tsx`
 * - `apps/web/src/pages/artifacts/views/artifact-image-gallery.ts`
 * - `apps/web/src/components/common/display/ImageZoomTrigger.tsx`（仅 48px 兜底取值）
 *
 * 有意偏离见各函数注释（DOM 测量不可移植，改用数据层尺寸兜底）。
 */

/** 缩放步长（对齐 Web 端工具栏 `+` / `−`）。 */
export const ZOOM_STEP = 0.25;

/** 缩放下界（对齐 Web 端 `Math.max(v - 0.25, 0.25)`）。 */
export const MIN_ZOOM_SCALE = 0.25;

/** 缩放上界（对齐 Web 端 `Math.min(v + 0.25, 5)`）。 */
export const MAX_ZOOM_SCALE = 5;

/** 旋转步长（度）。 */
export const ROTATION_STEP_DEGREES = 90;

/**
 * 无内禀尺寸时的最小占位边长（px）。
 * Web 端由 CSS `min-width/min-height: var(--spacing-12, 48px)` 兜底；RN `<Image>`
 * 必须有显式宽高，因此在数据层用同一取值兜底（C1）。
 */
export const MIN_IMAGE_DISPLAY_SIZE = 48;

/** 文件名兜底（对齐 Web 端 `fileName ?? 'image.png'`）。 */
export const DEFAULT_IMAGE_FILE_NAME = 'image.png';

/** 无障碍文案兜底（对齐 Web 端 `alt ?? caption ?? '图片预览'`）。 */
export const DEFAULT_IMAGE_ALT_TEXT = '图片预览';

/** 只接受 `image/*` 白名单，禁止参数注入（如 `image/png;base64,...`）。 */
const IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]*$/iu;

/** mime 缺失或非白名单时的回退值（对齐 Web 端）。 */
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';

/** 全部图片都不可渲染 / 无选中时的进度文案。 */
const EMPTY_PROGRESS_TEXT = '0 / 0';

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

/** 把条目数收敛成非负整数：非法（NaN / Infinity / 负数 / 小数）按 0 处理。 */
function normalizeCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * 把下标钳制到 `[0, count - 1]`；`count === 0` 时返回 0。
 *
 * 对齐 Web 端 `effectiveIndex = Math.min(Math.max(index ?? internal, 0), count - 1)`，
 * 额外收敛非法输入（NaN / 小数），保证可确定复现。
 */
export function clampIndex(index: number, count: number): number {
  const total = normalizeCount(count);
  if (total === 0 || !Number.isFinite(index)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(index), 0), total - 1);
}

/**
 * 受控优先 / 非受控兜底的索引解析：`controlled` 有值时优先，否则用 `internal`，
 * 结果统一 clamp。
 */
export function resolveIndex(
  controlled: number | null | undefined,
  internal: number,
  count: number,
): number {
  return clampIndex(controlled ?? internal, count);
}

/**
 * 分页偏移 → 页下标（原生 `ScrollView` 的 `onMomentumScrollEnd` 直接可用）。
 *
 * `Math.round(offsetX / pageWidth)` 取整（过半个页宽即进入下一页），结果再 clamp 到
 * `[0, count - 1]`：
 * - `offsetX` 为负（iOS 回弹 / 过冲）→ 0；
 * - `offsetX` 超出末页（快速滑动 / 内容被裁剪）→ `count - 1`；
 * - `pageWidth <= 0` / 非有限值（布局尚未测量）或 `offsetX` 非有限值 → 0，
 *   保证不产生 `NaN` / `Infinity` 下标。
 */
export function pageIndexFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (!isPositiveFinite(pageWidth) || !Number.isFinite(offsetX)) {
    return 0;
  }
  return clampIndex(Math.round(offsetX / pageWidth), count);
}

/**
 * `goToIndex` 的结果形态：显式可判别的 no-op 标记。
 *
 * `noop` 表示「边界处停在原地」——既不循环，也**不把相同索引回抛给受控调用点**；
 * `change` 表示目标下标确实变化，调用点才应派发 `onIndexChange(index)`。
 */
export type GoToIndexResult =
  | { readonly kind: 'noop'; readonly index: number }
  | { readonly kind: 'change'; readonly index: number };

/**
 * 图集导航（边界不循环）。先 clamp `next`，再与 clamp 后的 `current` 比较：
 * 相等即返回 `{ kind: 'noop' }`（含 `count === 0` / 单图）。
 */
export function goToIndex(current: number, next: number, count: number): GoToIndexResult {
  const target = clampIndex(next, count);
  if (target === clampIndex(current, count)) {
    return { kind: 'noop', index: target };
  }
  return { kind: 'change', index: target };
}

// ---------------------------------------------------------------------------
// 导航可见性与进度
// ---------------------------------------------------------------------------

/** 仅当条目数 > 1 时才允许渲染图集导航（单图不得出现导航）。 */
export function hasMultiple(count: number): boolean {
  return normalizeCount(count) > 1;
}

/**
 * 进度文案 `"{i+1} / {count}"`（对齐 Web 端 `{effectiveIndex + 1} / {count}`）。
 * 无条目时退化为 `"0 / 0"`，避免出现 `"1 / 0"` 这种无意义进度。
 */
export function formatProgress(index: number, count: number): string {
  const total = normalizeCount(count);
  if (total === 0) {
    return EMPTY_PROGRESS_TEXT;
  }
  return `${clampIndex(index, total) + 1} / ${total}`;
}

// ---------------------------------------------------------------------------
// 变换 reducer
// ---------------------------------------------------------------------------

/** 图片变换状态；初始 `{ scale: 1, rotation: 0 }`。 */
export interface TransformState {
  readonly scale: number;
  readonly rotation: number;
}

/** 变换动作：缩放 / 旋转 / 仅重置缩放 / 全部重置 / 缩放层比例回灌。 */
export type TransformAction =
  | { readonly type: 'zoomIn' }
  | { readonly type: 'zoomOut' }
  | { readonly type: 'rotateLeft' }
  | { readonly type: 'rotateRight' }
  | { readonly type: 'resetZoom' }
  | { readonly type: 'resetAll' }
  /** 缩放层上报的**绝对**比例回灌（见 `setScale` 分支注释）。 */
  | { readonly type: 'setScale'; readonly scale: number };

/** 初始变换状态（对齐 Web 端 `useState(1)` + `useState(0)`）。 */
export const INITIAL_TRANSFORM_STATE: TransformState = Object.freeze({
  scale: 1,
  rotation: 0,
});

/** 越界 clamp。 */
function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_ZOOM_SCALE), MAX_ZOOM_SCALE);
}

/** 非法 scale（NaN / Infinity）先归一到初始值，避免脏值扩散。 */
function normalizeScale(scale: number): number {
  return Number.isFinite(scale) ? scale : INITIAL_TRANSFORM_STATE.scale;
}

/** scale 未变化时返回原状态对象，便于 RN 侧跳过无意义的重渲染。 */
function withScale(state: TransformState, scale: number): TransformState {
  return scale === state.scale ? state : { ...state, scale };
}

function isInitialTransform(state: TransformState): boolean {
  return (
    state.scale === INITIAL_TRANSFORM_STATE.scale &&
    state.rotation === INITIAL_TRANSFORM_STATE.rotation
  );
}

/**
 * 变换状态机（纯函数，无副作用）：
 * - `zoomIn` / `zoomOut`：步长 0.25，区间 `[0.25, 5]`，越界 clamp；
 * - `rotateLeft` / `rotateRight`：±90°，可累计（不取模，负角合法）；
 * - `resetZoom`：**仅 scale → 1**，保留 rotation（对齐 Web 端「重置缩放」按钮）；
 * - `resetAll`：回到 `{ scale: 1, rotation: 0 }`（对齐 `0` 键 / 「重置全部」按钮）；
 * - `setScale`：采纳外部（缩放层）上报的绝对比例，同样 clamp / 归一 —— 捏合、双击、
 *   原生回弹产生的真实比例经此进入模型，工具栏读数与返回键语义才不会与实际画面脱节。
 */
export function transformReducer(state: TransformState, action: TransformAction): TransformState {
  switch (action.type) {
    case 'zoomIn':
      return withScale(state, clampScale(normalizeScale(state.scale) + ZOOM_STEP));
    case 'zoomOut':
      return withScale(state, clampScale(normalizeScale(state.scale) - ZOOM_STEP));
    case 'rotateLeft':
      return { ...state, rotation: state.rotation - ROTATION_STEP_DEGREES };
    case 'rotateRight':
      return { ...state, rotation: state.rotation + ROTATION_STEP_DEGREES };
    case 'resetZoom':
      return state.scale === INITIAL_TRANSFORM_STATE.scale ? state : { ...state, scale: 1 };
    case 'resetAll':
      return isInitialTransform(state) ? state : INITIAL_TRANSFORM_STATE;
    case 'setScale':
      return withScale(state, clampScale(normalizeScale(action.scale)));
  }
}

/** 返回键 / 关闭按钮的动作决策：先重置变换，还是直接关闭。 */
export type BackAction = 'resetAll' | 'close';

/**
 * 返回键 / 关闭按钮的先重置再关闭决策（对齐移动端查看器惯例，Web 端是
 * 「重置 + 关闭」一步完成）：
 * - 变换仍在初始态 → `'close'`，没有任何东西需要复位；
 * - 发生过缩放 / 旋转 → `'resetAll'`，调用点复位后保持打开，下次触发才关闭。
 *
 * 非法数值（NaN / Infinity）按初始态归一，与 `transformReducer` 的归一策略一致。
 * 与 `transformReducer(state, { type: 'resetAll' })` 构成闭环：`resetAll` 之后再次
 * 调用必定得到 `'close'`。
 */
export function resolveBackAction(state: TransformState): BackAction {
  const scale = normalizeScale(state.scale);
  const rotation = Number.isFinite(state.rotation)
    ? state.rotation
    : INITIAL_TRANSFORM_STATE.rotation;
  if (scale === INITIAL_TRANSFORM_STATE.scale && rotation === INITIAL_TRANSFORM_STATE.rotation) {
    return 'close';
  }
  return 'resetAll';
}

/**
 * 是否要重置变换（C2）。判据是**当前条目的 src**，不是 index：图集在 index 不变时
 * 被重排 / 刷新，只要当前图片变了同样要重置；打开动作（`isOpening`）也重置。
 * 对齐 Web 端 `useEffect(..., [open, currentSrc])`。`null` 与 `undefined` 等价。
 */
export function shouldResetTransform(
  previousSrc: string | null | undefined,
  nextSrc: string | null | undefined,
  isOpening: boolean,
): boolean {
  if (isOpening) {
    return true;
  }
  return (previousSrc ?? undefined) !== (nextSrc ?? undefined);
}

// ---------------------------------------------------------------------------
// 图集构造
// ---------------------------------------------------------------------------

/** 图集输入条目（产物 / 附件的最小投影）。 */
export interface GallerySourceImage {
  readonly id: string;
  /** 条目类型；只有 `'image'` 进入图集（对齐 Web 端 `artifact.type === 'image'`）。 */
  readonly type?: string;
  /** 原始内容（base64 / data URL）；是否可渲染由 `resolveSource` 判定。 */
  readonly content?: unknown;
  readonly mimeType?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fileName?: string;
}

/** 过滤后的图集条目，可直接交给查看器渲染。 */
export interface GalleryItem {
  readonly id: string;
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fileName?: string;
}

/** `buildGallery` 入参：候选条目 + 当前选中项。 */
export interface GalleryInput {
  readonly images: readonly GallerySourceImage[];
  /** 当前选中项；缺失 / `null` 视为「无选中」。 */
  readonly selected?: GallerySourceImage | null;
}

/** 图集构造结果；`index` 是**过滤后**下标（构造成功时必然 ≥ 0）。 */
export interface GalleryBuildResult {
  readonly items: readonly GalleryItem[];
  readonly index: number;
  /** id → 过滤后下标；不在图集中返回 -1（由调用点决定 no-op）。 */
  readonly indexOf: (id: string) => number;
}

/** src 解析器：把条目内容解析为可渲染地址，不可渲染时返回 `undefined`。 */
export type ResolveGallerySource = (image: GallerySourceImage) => string | undefined;

function toGalleryItem(
  image: GallerySourceImage,
  resolveSource: ResolveGallerySource,
): GalleryItem | undefined {
  if (image.type !== 'image') {
    return undefined;
  }
  const src = resolveSource(image);
  if (!src) {
    return undefined;
  }
  return {
    id: image.id,
    src,
    alt: image.alt,
    caption: image.caption,
    fileName: image.fileName,
  };
}

/**
 * 构造图集（受控数据层）。过滤不可渲染项、**保持原始顺序**，并给出四守卫：
 * 1. 无选中（`selected` 缺失 / null）；
 * 2. 选中项类型不是图片；
 * 3. 过滤后没有任何可渲染条目；
 * 4. 选中项不在过滤后条目里（列表被裁剪 / 内容不可渲染 / 过渡帧）。
 *
 * 任一守卫命中都返回 `undefined`——调用面据此退化为单图放大，不凭空指向别的图片。
 * 对齐 Web 端 `buildArtifactImageGallery`，但把 `onIndexChange → 选中 id` 的映射
 * 改为 `indexOf(id)`，由调用点自行回写选中态。
 */
export function buildGallery(
  input: GalleryInput,
  resolveSource: ResolveGallerySource,
): GalleryBuildResult | undefined {
  const selected = input.selected;
  if (!selected) {
    return undefined;
  }
  if (selected.type !== 'image') {
    return undefined;
  }

  const items: GalleryItem[] = [];
  for (const image of input.images) {
    const item = toGalleryItem(image, resolveSource);
    if (item) {
      items.push(item);
    }
  }
  if (items.length === 0) {
    return undefined;
  }

  const index = items.findIndex((item) => item.id === selected.id);
  if (index < 0) {
    return undefined;
  }

  return {
    items,
    index,
    indexOf: (id: string) => items.findIndex((item) => item.id === id),
  };
}

// ---------------------------------------------------------------------------
// src 解析
// ---------------------------------------------------------------------------

/** mime 白名单校验：非字符串 / 参数注入 / 非图片一律回退 `image/png`。 */
function resolveImageMimeType(mimeType: unknown): string {
  return typeof mimeType === 'string' && IMAGE_MIME_TYPE_PATTERN.test(mimeType.trim())
    ? mimeType.trim()
    : DEFAULT_IMAGE_MIME_TYPE;
}

/**
 * 把图片内容解析成可直接渲染的地址（对齐 Web 端 `resolveArtifactImageSrc`）：
 * - `content` 非字符串 → `undefined`（不抛错，由调用方过滤）；
 * - `data:` 前缀只接受 `data:image/`，其它协议 → `undefined`；
 * - 裸 base64 → `data:<mime>;base64,<content>`，mime 未过白名单则回退 `image/png`。
 */
export function resolveImageSrc(content: unknown, mimeType?: unknown): string | undefined {
  if (typeof content !== 'string') {
    return undefined;
  }
  if (content.startsWith('data:')) {
    return content.startsWith('data:image/') ? content : undefined;
  }
  return `data:${resolveImageMimeType(mimeType)};base64,${content}`;
}

// ---------------------------------------------------------------------------
// 尺寸兜底（C1，RN 专属）
// ---------------------------------------------------------------------------

/** 图片内禀尺寸；运行时可能缺失 / 非法，因此按 `unknown` 收窄。 */
export interface ImageIntrinsicSize {
  readonly width?: unknown;
  readonly height?: unknown;
}

/** contain 适配的边界（通常传 `useWindowDimensions()` 的可用区域）。 */
export interface DisplayBounds {
  readonly maxWidth?: unknown;
  readonly maxHeight?: unknown;
}

/** 可直接用于 RN `<Image style>` 的显式宽高。 */
export interface DisplaySize {
  readonly width: number;
  readonly height: number;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 解析图片显示尺寸（RN 必须有显式宽高，**不做任何 DOM 测量**——这是对 Web 端
 * `ImageZoomTrigger`「按渲染尺寸 4px 判定坍缩 + `data-intrinsic-size` CSS 兜底」
 * 的有意替代）：
 * - 内禀尺寸缺失 / 非法（0 / 负数 / NaN / Infinity / 非数字）→ `fallback × fallback`
 *   最小占位（默认 48px，取值对齐 Web 端 `--spacing-12, 48px`）；
 * - 内禀尺寸有效 → 按 `bounds` 做 contain 等比适配（不放大上限以外的裁剪）；
 * - `bounds` 缺失 / 非法 → 返回内禀尺寸本身。
 *
 * 第二个参数是 contain 边界而非 `fallback`（有意偏离任务书的简写签名）：纯逻辑层
 * 不能读取 `Dimensions`（禁止 import `react-native`），边界必须由调用方显式传入。
 */
export function resolveDisplaySize(
  intrinsic: ImageIntrinsicSize,
  bounds?: DisplayBounds | null,
  fallback: number = MIN_IMAGE_DISPLAY_SIZE,
): DisplaySize {
  const placeholder = isPositiveFinite(fallback) ? fallback : MIN_IMAGE_DISPLAY_SIZE;
  const width = intrinsic.width;
  const height = intrinsic.height;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    return { width: placeholder, height: placeholder };
  }

  const maxWidth = bounds?.maxWidth;
  const maxHeight = bounds?.maxHeight;
  if (!isPositiveFinite(maxWidth) || !isPositiveFinite(maxHeight)) {
    return { width, height };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

// ---------------------------------------------------------------------------
// 文案兜底
// ---------------------------------------------------------------------------

/** 无障碍文案：`alt ?? caption ?? '图片预览'`（`??` 语义，空字符串原样保留）。 */
export function resolveAltText(alt?: string | null, caption?: string | null): string {
  return alt ?? caption ?? DEFAULT_IMAGE_ALT_TEXT;
}

/** 下载 / 分享文件名：`fileName ?? 'image.png'`。 */
export function resolveFileName(fileName?: string | null): string {
  return fileName ?? DEFAULT_IMAGE_FILE_NAME;
}

// ---------------------------------------------------------------------------
// 旋转几何与工具栏读数（W2c / T-11）
// ---------------------------------------------------------------------------

/**
 * 把角度归一化到 `[0, 360)`；非有限值按 0 处理。
 *
 * 旋转状态是**可累计的原始值**（可以停在 -90 / 450），这里只做「怎么画」的等价换算，
 * 不回写状态 —— `resolveBackAction` 仍按原始值判断「有没有旋转过」。
 */
export function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) {
    return 0;
  }
  return ((rotation % 360) + 360) % 360;
}

/** 四分之一转（90° / 270°）：这一档宽高互换，原生缩放基准随之失效。 */
function isQuarterTurn(rotation: number): boolean {
  const normalized = normalizeRotationDegrees(rotation);
  return normalized === 90 || normalized === 270;
}

/**
 * 旋转后的显示尺寸：90° / 270° **先交换宽高**，再按 `bounds` 做 contain 等比适配。
 *
 * `resolveDisplaySize` 的全部兜底语义原样保留（内禀尺寸非法 → `fallback` 占位、
 * `bounds` 非法 → 返回（交换后的）内禀尺寸本身），因为它就是被复用的实现。
 *
 * 返回值是**旋转后的视觉盒**，同时也是缩放层的原生视口尺寸；旋转前的布局尺寸用
 * `resolveRotatedContentSize` 推导（四分之一转下两者互为转置）。
 * UI 只走 ±90° 步进（见 `ROTATION_STEP_DEGREES`），因此 45° 这类非象限角不在可达范围内。
 */
export function resolveRotatedDisplaySize(
  size: ImageIntrinsicSize,
  rotation: number,
  bounds?: DisplayBounds | null,
  fallback: number = MIN_IMAGE_DISPLAY_SIZE,
): DisplaySize {
  if (!isQuarterTurn(rotation)) {
    return resolveDisplaySize(size, bounds, fallback);
  }
  return resolveDisplaySize({ width: size.height, height: size.width }, bounds, fallback);
}

/**
 * 旋转前的布局尺寸：视觉盒在四分之一转下转置，其余角度原样返回（同一对象引用）。
 *
 * 用途：`<Image>` 必须先按**未旋转**的尺寸布局、再施加 `rotate` 变换。直接拿视觉盒去
 * 布局会让 `resizeMode="contain"` 先按错误的宽高比缩一圈，旋转后图像显著偏小；转置后
 * 再旋转，视觉盒恰好等于 `resolveRotatedDisplaySize` 的结果（无裁剪、无多余留白）。
 */
export function resolveRotatedContentSize(displaySize: DisplaySize, rotation: number): DisplaySize {
  if (!isQuarterTurn(rotation)) {
    return displaySize;
  }
  return { width: displaySize.height, height: displaySize.width };
}

/**
 * 缩放读数：`Math.round(scale × 100)%`（对齐 Web 端 `{Math.round(scale * 100)}%`）。
 * 非有限数字按初始比例读作 `100%`，不产生 `NaN%`。
 */
export function formatZoomPercent(scale: number): string {
  return `${Math.round(normalizeScale(scale) * 100)}%`;
}

/** 工具栏按钮可用性：到上下界 / 已无变换可复位时为 `false`。 */
export interface TransformControls {
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly canReset: boolean;
}

/**
 * 工具栏按钮门控（纯函数）。旋转**不设上下界**（可累计、负角合法），因此只有缩放两端
 * 与「重置全部」存在禁用态：
 * - `canZoomOut`：`scale > MIN_ZOOM_SCALE`（已在 0.25× 时再缩就是 no-op）；
 * - `canZoomIn`：`scale < MAX_ZOOM_SCALE`；
 * - `canReset`：缩放或旋转任一偏离初始态（只有此时 `resetAll` 才会真的改变状态）。
 *
 * 与 `resolveBackAction` 同源且同归一策略：`canReset === false` 等价于「返回键此刻应直接关闭」。
 */
export function resolveTransformControls(state: TransformState): TransformControls {
  const scale = normalizeScale(state.scale);
  const rotation = Number.isFinite(state.rotation)
    ? state.rotation
    : INITIAL_TRANSFORM_STATE.rotation;
  return {
    canZoomOut: scale > MIN_ZOOM_SCALE,
    canZoomIn: scale < MAX_ZOOM_SCALE,
    canReset:
      scale !== INITIAL_TRANSFORM_STATE.scale || rotation !== INITIAL_TRANSFORM_STATE.rotation,
  };
}
