/**
 * 产物图片取数层的纯逻辑模块（Phase 1 / T-03~T-05）。
 *
 * 刻意不 import `react` / `react-native` / `expo-file-system`：
 * 移动端测试基建只有 Vitest（无 `@testing-library/react-native`），纯逻辑
 * 必须独立成无 RN 依赖的模块才能被直接测试。副作用（HTTP 取数、落盘、
 * 尺寸探测）全部留在 `use-artifact-image-source.ts`。
 *
 * 职责：
 * - 缓存键派生、`Map` 顺序实现的 LRU、in-flight 去重、失败重试策略；
 * - 临时文件名派生（artifactId 安全化，防路径穿越）；
 * - artifact `content` 载荷守卫（mime 白名单、`data:` 前缀策略）；
 * - base64 → 临时文件写入 的结构化决策（应写盘 / 可直接用 / 应拒绝）；
 * - 尺寸元数据派生。
 */

/** 内存 LRU 上限：单张移动端图片约 1–4 MB，24 条把常驻内存控制在几十 MB 量级。 */
export const ARTIFACT_IMAGE_CACHE_CAPACITY = 24;

/** 落盘目录名（位于 `expo-file-system` 的 cache 私有目录之下）。 */
export const ARTIFACT_IMAGE_CACHE_DIRECTORY_NAME = 'artifact-images';

/** mime 无法识别时的回退值：RN `<Image>` 对 png 支持最好。 */
export const ARTIFACT_IMAGE_DEFAULT_MIME_TYPE = 'image/png';

/**
 * mime 白名单：`image/<子类型>`，子类型首字符必须为字母或数字，
 * 后续允许字母、数字、`.`、`+`、`-`（覆盖 `image/svg+xml`、`image/vnd.microsoft.icon`）。
 * `image/*` 这类通配写法会命中回退值。
 */
export const ARTIFACT_IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]*$/iu;

/** 自动重试上限：同一 artifact 连续失败 3 次后不再自动重试，只能用户手动 retry。 */
export const ARTIFACT_IMAGE_MAX_ATTEMPTS = 3;

/** 自动重试冷却窗口：失败后 30s 内不重复发请求，避免滚动列表时疯狂重试。 */
export const ARTIFACT_IMAGE_RETRY_COOLDOWN_MS = 30_000;

/**
 * base64 载荷最小长度：真实图片 base64 远大于此值，过短的字符串
 * （如裸路径 `/tmp/foobar`）一律视为非图片载荷。
 */
export const ARTIFACT_IMAGE_MIN_BASE64_LENGTH = 16;

/** 文件名中 artifactId 片段的长度上限，避免超长 id 撑爆文件名。 */
export const ARTIFACT_IMAGE_FILE_SEGMENT_MAX_LENGTH = 48;

/** 失败登记表上限：防止长会话里无限累积失败键。 */
export const ARTIFACT_IMAGE_FAILURE_TRACKER_CAPACITY = 64;

export type ArtifactImageRejectReason =
  | 'not-a-string'
  | 'empty-payload'
  | 'unsupported-data-uri'
  | 'invalid-base64'
  | 'unsupported-uri-scheme';

/**
 * 载荷决策：
 * - `write-base64`：应写盘（已是纯 base64 或 `data:image/...;base64,` 形式）；
 * - `direct-uri`：可直接用（本地 `file://` / `content://` 等已落盘地址，无需再写）；
 * - `reject`：应拒绝（非字符串、空、非 image 的 data URI、非法 base64、远端协议）。
 */
export type ArtifactImagePayloadDecision =
  | { kind: 'write-base64'; base64: string; mimeType: string }
  | { kind: 'direct-uri'; uri: string; mimeType: string }
  | { kind: 'reject'; reason: ArtifactImageRejectReason };

export interface ArtifactImageDimensions {
  width: number;
  height: number;
}

/** LRU 中缓存的成功结果；`width` / `height` 未知时为 `null`。 */
export interface ArtifactImageSourceRecord {
  uri: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

/** 从 artifact `metadata` 中稳定提取出的字段。 */
export interface ArtifactImageMetadata {
  fileName: string | null;
  mimeType: string;
  dimensions: ArtifactImageDimensions | null;
}

export interface ArtifactImageFailureRecord {
  attempts: number;
  lastFailedAt: number;
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readPositiveDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/** mime 白名单收口：命中则小写返回，否则回退 `image/png`。 */
export function normalizeArtifactImageMimeType(raw: unknown): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (ARTIFACT_IMAGE_MIME_TYPE_PATTERN.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return ARTIFACT_IMAGE_DEFAULT_MIME_TYPE;
}

/**
 * base64 载荷规范化：去除空白（JSON 里可能带换行），校验字符表与长度。
 * 非法返回 `null`，由调用方转成 `reject`。
 */
export function normalizeBase64ImagePayload(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, '');
  if (collapsed.length < ARTIFACT_IMAGE_MIN_BASE64_LENGTH) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(collapsed)) {
    return null;
  }
  if (collapsed.length % 4 === 1) {
    return null;
  }
  return collapsed;
}

/**
 * artifact `content` 载荷守卫。
 *
 * 策略：
 * - 非字符串 / 空串 → 拒绝；
 * - `data:` 前缀只接受 `data:image/`，且只接受 `;base64,` 形式（未压缩的
 *   百分号编码 `data:image/svg+xml,<svg…>` 无法直接落盘，一律拒绝）；
 * - `file://`、`content://`、`assets-library://`、`ph://` → 可直接用；
 * - 其他协议（`http(s)://`、`ftp://`…）→ 拒绝，取数层不做远端二次拉取；
 * - 其余按裸 base64 处理，mime 取 artifact metadata（白名单外回退 png）。
 */
export function decideArtifactImagePayload(
  content: unknown,
  declaredMimeType?: unknown,
): ArtifactImagePayloadDecision {
  if (typeof content !== 'string') {
    return { kind: 'reject', reason: 'not-a-string' };
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { kind: 'reject', reason: 'empty-payload' };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:')) {
    if (!lower.startsWith('data:image/')) {
      return { kind: 'reject', reason: 'unsupported-data-uri' };
    }
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex < 0) {
      return { kind: 'reject', reason: 'unsupported-data-uri' };
    }
    const header = trimmed.slice('data:'.length, commaIndex);
    if (!/;base64$/iu.test(header)) {
      return { kind: 'reject', reason: 'unsupported-data-uri' };
    }
    const semicolonIndex = header.indexOf(';');
    const declared = semicolonIndex >= 0 ? header.slice(0, semicolonIndex) : header;
    const base64 = normalizeBase64ImagePayload(trimmed.slice(commaIndex + 1));
    if (base64 === null) {
      return { kind: 'reject', reason: 'invalid-base64' };
    }
    return {
      kind: 'write-base64',
      base64,
      mimeType: normalizeArtifactImageMimeType(declared),
    };
  }

  if (/^(file|content|assets-library|ph):\/\//iu.test(trimmed)) {
    return {
      kind: 'direct-uri',
      uri: trimmed,
      mimeType: normalizeArtifactImageMimeType(declaredMimeType),
    };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    return { kind: 'reject', reason: 'unsupported-uri-scheme' };
  }

  const base64 = normalizeBase64ImagePayload(trimmed);
  if (base64 === null) {
    return { kind: 'reject', reason: 'invalid-base64' };
  }
  return {
    kind: 'write-base64',
    base64,
    mimeType: normalizeArtifactImageMimeType(declaredMimeType),
  };
}

/** 拒绝原因 → 用户可读文案（hook 直接消费）。 */
export function describeArtifactImageRejectReason(reason: ArtifactImageRejectReason): string {
  switch (reason) {
    case 'not-a-string':
      return '图片产物内容格式不受支持。';
    case 'empty-payload':
      return '图片产物内容为空。';
    case 'unsupported-data-uri':
      return '图片产物的 data URI 形式不受支持。';
    case 'invalid-base64':
      return '图片产物内容不是合法的 base64。';
    case 'unsupported-uri-scheme':
      return '图片产物引用了不受支持的地址。';
  }
}

/**
 * 缓存键派生：`<gatewayUrl>|<artifactId>`。
 * 带上 gatewayUrl 是因为不同网关的同名 artifactId 可能代表不同内容；
 * artifactId 为空（或无有效字符）时返回 `null`，由调用方按「不发请求」处理。
 */
export function deriveArtifactImageCacheKey(gatewayUrl: string, artifactId: string): string | null {
  const normalizedArtifactId = artifactId.trim();
  if (normalizedArtifactId.length === 0) {
    return null;
  }
  const normalizedGatewayUrl = gatewayUrl.trim().replace(/\/+$/u, '');
  return `${normalizedGatewayUrl}|${normalizedArtifactId}`;
}

/**
 * 文件名片段安全化：只保留 `[A-Za-z0-9._-]`，折叠连续 `.`（防 `..` 穿越），
 * 去掉首尾分隔符并截断；结果为空时回退 `artifact`。
 */
export function sanitizeArtifactImageFileSegment(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/\.{2,}/gu, '.')
    .replace(/^[.\-_]+|[.\-_]+$/gu, '')
    .slice(0, ARTIFACT_IMAGE_FILE_SEGMENT_MAX_LENGTH)
    .replace(/^[.\-_]+|[.\-_]+$/gu, '');
  return sanitized.length > 0 ? sanitized : 'artifact';
}

/** mime → 扩展名；`jpeg → jpg`、`svg+xml → svg`，未知子类型压缩成字母数字。 */
export function resolveArtifactImageFileExtension(mimeType: unknown): string {
  const subtype = normalizeArtifactImageMimeType(mimeType).slice('image/'.length).toLowerCase();
  if (subtype === 'jpeg') {
    return 'jpg';
  }
  if (subtype === 'svg+xml') {
    return 'svg';
  }
  const compact = subtype.replace(/[^a-z0-9]/gu, '');
  return compact.length > 0 ? compact : 'png';
}

/** 32 位 djb2 → base36：确定性、无依赖，保证不同 cacheKey 的文件名不互相覆盖。 */
function hashArtifactImageSegment(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = hash * 33 + value.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(36);
}

/** 临时文件名：`artifact-<安全片段>-<hash>.<ext>`，全链路不含路径分隔符。 */
export function buildArtifactImageFileName(cacheKey: string, mimeType: unknown): string {
  const segment = sanitizeArtifactImageFileSegment(cacheKey);
  const extension = resolveArtifactImageFileExtension(mimeType);
  return `artifact-${segment}-${hashArtifactImageSegment(cacheKey)}.${extension}`;
}

/** 尺寸元数据派生：仅接受有限正数，字段缺失 / 非法一律返回 `null`。 */
export function deriveArtifactImageDimensions(raw: unknown): ArtifactImageDimensions | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const width = readPositiveDimension(record['width']);
  const height = readPositiveDimension(record['height']);
  if (width === null || height === null) {
    return null;
  }
  return { width, height };
}

/** 先取 metadata 尺寸，再回退到 `Image.getSize` 探测结果。 */
export function resolveArtifactImageDimensions(
  primary: unknown,
  fallback: unknown,
): ArtifactImageDimensions | null {
  return deriveArtifactImageDimensions(primary) ?? deriveArtifactImageDimensions(fallback);
}

/** artifact `metadata` 归一化。 */
export function deriveArtifactImageMetadata(raw: unknown): ArtifactImageMetadata {
  const record = asRecord(raw);
  const fileName = record?.['fileName'];
  return {
    fileName: typeof fileName === 'string' && fileName.trim().length > 0 ? fileName.trim() : null,
    mimeType: normalizeArtifactImageMimeType(record?.['mimeType']),
    dimensions: deriveArtifactImageDimensions(record),
  };
}

/** 任意异常 → 用户可读文案；空消息回退默认文案。 */
export function describeArtifactImageError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : '图片加载失败。';
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  const record = asRecord(error);
  const message = record?.['message'];
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim();
  }
  return '图片加载失败。';
}

/**
 * `Map` 插入顺序实现的 LRU：
 * - `get` 命中后删除再插入，把条目挪到队尾（最新）；
 * - `set` 超出容量时从队首（最旧）淘汰；
 * - 只淘汰内存条目，不删除磁盘文件——正在显示的图片可能仍被其他气泡引用，
 *   磁盘回收交给 OS 的 cache 目录策略。
 */
export class ArtifactImageLruCache<TValue> {
  private readonly entries = new Map<string, TValue>();
  private readonly capacity: number;

  constructor(capacity: number = ARTIFACT_IMAGE_CACHE_CAPACITY) {
    const normalized = Math.floor(capacity);
    this.capacity = Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
  }

  get(key: string): TValue | undefined {
    if (!this.entries.has(key)) {
      return undefined;
    }
    const value = this.entries.get(key);
    this.entries.delete(key);
    if (value !== undefined) {
      this.entries.set(key, value);
    }
    return value;
  }

  peek(key: string): TValue | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: TValue): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** 键顺序：最旧 → 最新。 */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get maxSize(): number {
    return this.capacity;
  }
}

interface ArtifactImageInFlightEntry<TValue> {
  consumers: number;
  controller: AbortController;
  promise: Promise<TValue>;
}

/**
 * in-flight 去重：同一 key 的并发调用共享同一次请求。
 *
 * 请求自带 `AbortController`：每个消费者调用 `release(key)`，当最后一个
 * 消费者离开（组件卸载）时中断请求，避免共享请求因单个消费者卸载而被误伤。
 * 请求 settle 后自动从表中移除 —— 失败不会被缓存，下一次调用会重新发起。
 */
export class ArtifactImageInFlight<TValue> {
  private readonly entries = new Map<string, ArtifactImageInFlightEntry<TValue>>();

  run(key: string, factory: (signal: AbortSignal) => Promise<TValue>): Promise<TValue> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.consumers += 1;
      return existing.promise;
    }
    const controller = new AbortController();
    const holder: { entry: ArtifactImageInFlightEntry<TValue> | null } = { entry: null };
    const promise = Promise.resolve()
      .then(() => factory(controller.signal))
      .finally(() => {
        const entry = holder.entry;
        if (entry !== null && this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      });
    const entry: ArtifactImageInFlightEntry<TValue> = { consumers: 1, controller, promise };
    holder.entry = entry;
    this.entries.set(key, entry);
    return promise;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    entry.consumers -= 1;
    if (entry.consumers <= 0) {
      this.entries.delete(key);
      entry.controller.abort();
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.controller.abort();
    }
  }
}

/**
 * 失败登记与重试策略：
 * - 失败条目在超过容量时按插入顺序淘汰最旧项（清理）；
 * - `canAttempt`：无记录 → 允许；尝试次数达上限 → 永久禁止自动重试；
 *   否则需等过冷却窗口；
 * - 成功或用户手动 retry 时调用 `clear` 重置。
 */
export class ArtifactImageFailureTracker {
  private readonly failures = new Map<string, ArtifactImageFailureRecord>();

  constructor(
    private readonly maxAttempts: number = ARTIFACT_IMAGE_MAX_ATTEMPTS,
    private readonly cooldownMs: number = ARTIFACT_IMAGE_RETRY_COOLDOWN_MS,
    private readonly capacity: number = ARTIFACT_IMAGE_FAILURE_TRACKER_CAPACITY,
  ) {}

  get(key: string): ArtifactImageFailureRecord | null {
    return this.failures.get(key) ?? null;
  }

  canAttempt(key: string, now: number): boolean {
    const failure = this.failures.get(key);
    if (!failure) {
      return true;
    }
    if (failure.attempts >= this.maxAttempts) {
      return false;
    }
    return now - failure.lastFailedAt >= this.cooldownMs;
  }

  recordFailure(key: string, message: string, now: number): ArtifactImageFailureRecord {
    const previous = this.failures.get(key);
    const next: ArtifactImageFailureRecord = {
      attempts: (previous?.attempts ?? 0) + 1,
      lastFailedAt: now,
      message,
    };
    this.failures.delete(key);
    this.failures.set(key, next);
    while (this.failures.size > this.capacity) {
      const oldest = this.failures.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.failures.delete(oldest.value);
    }
    return next;
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  clearAll(): void {
    this.failures.clear();
  }

  get size(): number {
    return this.failures.size;
  }
}
