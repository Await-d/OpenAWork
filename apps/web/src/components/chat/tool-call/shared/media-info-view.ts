/**
 * `extract_media_info` 的视图模型（纯函数）。
 *
 * 网关返回 `JSON.stringify({ success, type, mimeType, duration, width, height,
 * videoCodec, audioCodec, codec, bitrate, sampleRate, channels, fps, sizeBytes,
 * format, summary })`（见 `extract-media-info-tool.ts`）；直接落到字段表会把
 * 「时长 / 分辨率 / 编码」摊成一堆原始键值。
 */

export interface MediaInfoView {
  type?: string;
  mimeType?: string;
  /** 秒。 */
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  codec?: string;
  /** 比特率（bps，网关原样）。 */
  bitrate?: number;
  /** Hz。 */
  sampleRate?: number;
  channels?: number;
  sizeBytes?: number;
  format?: string;
  /** 网关已格式化的一句话摘要。 */
  summary?: string;
}

const KNOWN_KEYS = [
  'type',
  'mimeType',
  'duration',
  'width',
  'height',
  'fps',
  'videoCodec',
  'audioCodec',
  'codec',
  'bitrate',
  'sampleRate',
  'channels',
  'sizeBytes',
  'format',
  'summary',
] as const;

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 解析媒体信息输出。失败信封（`success:false` / `error`）返回 `null`，
 * 让调用方回退字段表，避免把错误原因藏起来。
 */
export function extractMediaInfo(output: unknown): MediaInfoView | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;

  if (record['success'] === false) return null;
  const error = record['error'];
  if (typeof error === 'string' && error.trim().length > 0) return null;

  // 先取局部变量再收窄：直接在对象展开里写 `cond ? { x: readX() } : {}` 会让
  // TS 保留 `string | undefined`，在 exactOptionalPropertyTypes 下报错。
  const type = readString(record, 'type');
  const mimeType = readString(record, 'mimeType');
  const duration = readNumber(record, 'duration');
  const width = readNumber(record, 'width');
  const height = readNumber(record, 'height');
  const fps = readNumber(record, 'fps');
  const videoCodec = readString(record, 'videoCodec');
  const audioCodec = readString(record, 'audioCodec');
  const codec = readString(record, 'codec');
  const bitrate = readNumber(record, 'bitrate');
  const sampleRate = readNumber(record, 'sampleRate');
  const channels = readNumber(record, 'channels');
  const sizeBytes = readNumber(record, 'sizeBytes');
  const format = readString(record, 'format');
  const summary = readString(record, 'summary');

  const view: MediaInfoView = {
    ...(type !== undefined ? { type } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(videoCodec !== undefined ? { videoCodec } : {}),
    ...(audioCodec !== undefined ? { audioCodec } : {}),
    ...(codec !== undefined ? { codec } : {}),
    ...(bitrate !== undefined ? { bitrate } : {}),
    ...(sampleRate !== undefined ? { sampleRate } : {}),
    ...(channels !== undefined ? { channels } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };

  // 至少要有一个已建模字段，否则不是媒体信息（可能是别的 JSON）。
  const recognized = KNOWN_KEYS.some((key) => view[key] !== undefined);
  return recognized ? view : null;
}

/** `754` → `12:34`；`>> 1h` 仍给 `1:02:03`。 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}
