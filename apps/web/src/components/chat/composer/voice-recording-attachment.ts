/**
 * 录音产物 → 附件 `File` 的规范化。
 *
 * 浏览器 `MediaRecorder` 产出的容器格式随实现而变（Chromium/Firefox 走
 * `audio/webm` / `audio/ogg`，Safari 走 `audio/mp4`），而网关上传端点只透传
 * `mimeType`、不做容器归一。因此这里负责两件事：
 *
 *   1. 按 mime 推导扩展名，保证 `resolveFileMimeType` 与后端 artifact 名一致；
 *   2. 起一个稳定、可辨识、带时间戳的文件名——artifact 会以
 *      `- <name> (artifact:<id>)` 的形式回填进发给agent 的消息正文，文件名
 *      直接影响模型侧的引用可读性。
 */

/** mime → 扩展名。只覆盖 `MediaRecorder` 实际会产出 / 常见转码产物的容器。 */
const AUDIO_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-flac': 'flac',
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
};

/** 无法识别 mime 时的兜底容器；与 Chromium 主路径保持一致。 */
const DEFAULT_AUDIO_EXTENSION = 'webm';

/** 无 mime 时的兜底类型，避免 `File.type` 为空导致上传端点丢失类型信息。 */
const DEFAULT_AUDIO_MIME = 'audio/webm';

/**
 * 按 mime 推导音频扩展名。容忍 `audio/webm;codecs=opus` 这类带参数的头。
 * 未知 mime 一律回落到 webm——`VoiceRecorder` 本身就是以 webm 为默认容器。
 */
export function resolveAudioFileExtension(mimeType: string | null | undefined): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return AUDIO_EXTENSION_BY_MIME[normalized] ?? DEFAULT_AUDIO_EXTENSION;
}

/** 生成 `voice-input-HHmmss.<ext>` 形式的文件名（本地时区）。 */
export function buildVoiceRecordingFileName(mimeType: string | null | undefined, at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const ss = String(at.getSeconds()).padStart(2, '0');
  return `voice-input-${hh}${mm}${ss}.${resolveAudioFileExtension(mimeType)}`;
}

/**
 * 把 `VoiceRecorder` 产出的录音 blob 包成可上传的附件 `File`。
 *
 * 交给 `appendFiles` 后即复用既有附件管线：上传到
 * `POST /sessions/:sessionId/artifacts` 落库 → 进composer 附件列表 → 发送时
 * 生成 `- <name> (artifact:<id>)` 文本引用交由 agent 用工具读取。
 */
export function createVoiceRecordingFile(blob: Blob, at: Date = new Date()): File {
  const mimeType = blob.type || DEFAULT_AUDIO_MIME;
  return new File([blob], buildVoiceRecordingFileName(mimeType, at), { type: mimeType });
}
