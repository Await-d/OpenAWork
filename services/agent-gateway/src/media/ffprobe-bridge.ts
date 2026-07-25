/**
 * FFprobe 封装 —— 媒体元信息提取。
 *
 * 使用 ffprobe-static 提供的预编译二进制，通过 child_process.spawn
 * 执行 ffprobe 命令行工具获取媒体文件的元信息。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffprobePath from 'ffprobe-static';
import { getMediaCategory } from './media-codec.js';
import { resolveMediaBinaryPath } from './media-binary-path.js';

const FFPROBE_PATH = resolveMediaBinaryPath(process.env.FFPROBE_BIN, ffprobePath.path);

export interface MediaInfo {
  type: 'audio' | 'video' | 'image' | 'unknown';
  mimeType: string;
  duration: number;
  width?: number;
  height?: number;
  codec?: string;
  audioCodec?: string;
  videoCodec?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  fps?: number;
  sizeBytes: number;
  format?: string;
}

interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  pix_fmt?: string;
}

interface FFprobeOutput {
  streams?: FFprobeStream[];
  format?: {
    filename?: string;
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

async function removeTempFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    console.warn(`[ffprobe-bridge] 清理临时文件失败: ${path}`, error);
  }
}

/**
 * 从 Buffer 提取媒体元信息。
 * 将 buffer 写入临时文件后调用 ffprobe。
 */
export async function probeMediaBuffer(
  buffer: Buffer,
  mimeType: string,
  signal?: AbortSignal,
): Promise<MediaInfo> {
  const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12);
  const tempDir = join(tmpdir(), 'openawork-media-probe');
  const tempFile = join(tempDir, `probe-${hash}.bin`);

  await mkdir(tempDir, { recursive: true });
  await writeFile(tempFile, buffer);

  try {
    return await probeMediaFile(tempFile, mimeType, signal);
  } finally {
    await removeTempFile(tempFile);
  }
}

/**
 * 从文件路径提取媒体元信息。
 */
export async function probeMediaFile(
  filePath: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<MediaInfo> {
  if (!FFPROBE_PATH) {
    return Promise.reject(new Error('ffprobe 不可用。请配置 FFPROBE_BIN 或安装 ffprobe-static。'));
  }

  return new Promise<MediaInfo>((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const child = spawn(FFPROBE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const onAbort = () => {
      child.kill('SIGKILL');
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        reject(new Error('Aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`ffprobe 启动失败: ${err.message}`));
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        reject(new Error(`ffprobe 退出码 ${code}: ${stderr || '未知错误'}`));
        return;
      }

      try {
        const output: FFprobeOutput = JSON.parse(Buffer.concat(stdoutChunks).toString('utf-8'));
        resolve(parseFFprobeOutput(output, mimeType));
      } catch (err) {
        reject(
          new Error(`ffprobe 输出解析失败: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    });
  });
}

/**
 * 从 URL 提取媒体元信息（先下载到临时文件）。
 */
export async function probeMediaUrl(
  url: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<MediaInfo> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载媒体失败: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return probeMediaBuffer(buffer, mimeType, signal);
}

function parseFFprobeOutput(output: FFprobeOutput, mimeType: string): MediaInfo {
  const format = output.format;
  const streams = output.streams ?? [];

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const category = getMediaCategory(mimeType);
  const duration = parseFloat(format?.duration ?? '0') || 0;
  const bitrate = format?.bit_rate ? parseInt(format.bit_rate, 10) : undefined;
  const sizeBytes = format?.size ? parseInt(format.size, 10) : 0;
  const formatName = format?.format_name;

  let type: MediaInfo['type'] = 'unknown';
  if (category === 'audio') type = 'audio';
  else if (category === 'video') type = videoStream ? 'video' : 'audio';
  else if (category === 'image') type = 'image';

  let fps: number | undefined;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (num && den) fps = Math.round((num / den) * 100) / 100;
  }

  return {
    type,
    mimeType,
    duration,
    sizeBytes,
    ...(videoStream?.width ? { width: videoStream.width } : {}),
    ...(videoStream?.height ? { height: videoStream.height } : {}),
    ...(videoStream?.codec_name
      ? { videoCodec: videoStream.codec_name, codec: videoStream.codec_name }
      : {}),
    ...(audioStream?.codec_name ? { audioCodec: audioStream.codec_name } : {}),
    ...(audioStream?.sample_rate ? { sampleRate: parseInt(audioStream.sample_rate, 10) } : {}),
    ...(audioStream?.channels ? { channels: audioStream.channels } : {}),
    ...(bitrate ? { bitrate } : {}),
    ...(fps ? { fps } : {}),
    ...(formatName ? { format: formatName } : {}),
  };
}

/**
 * 检测 ffprobe 是否可用。
 */
export async function isFFprobeAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!FFPROBE_PATH) {
      resolve(false);
      return;
    }
    const child = spawn(FFPROBE_PATH, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
