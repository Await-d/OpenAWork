/**
 * FFmpeg 封装 —— 媒体格式转换、视频帧提取、缩略图生成。
 *
 * 使用 ffmpeg-static 提供的预编译二进制，通过 child_process.spawn
 * 执行 ffmpeg 命令行工具进行媒体处理。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as ffmpegStaticModule from 'ffmpeg-static';
import { MIME_TO_CODEC, FORMAT_TO_MIME } from './media-codec.js';
import { resolveMediaBinaryPath } from './media-binary-path.js';

const FFMPEG_PATH = resolveMediaBinaryPath(process.env.FFMPEG_BIN, ffmpegStaticModule.default);

export interface ConvertMediaOptions {
  targetFormat: string;
  /** 视频编码质量: CRF 值（0-51，越低质量越高，默认 23） */
  videoQuality?: number;
  /** 音频比特率，如 '128k' */
  audioBitrate?: string;
  /** 视频分辨率缩放，如 '1280:-1' */
  videoScale?: string;
  /** 视频帧率 */
  videoFps?: number;
  /** 截取起始时间（秒） */
  startTime?: number;
  /** 截取持续时间（秒） */
  duration?: number;
  /** GIF 循环：0=无限循环（默认），-1=不循环 */
  gifLoop?: number;
}

export interface ConvertMediaResult {
  buffer: Buffer;
  outputMimeType: string;
  outputExtension: string;
  inputMimeType: string;
  targetFormat: string;
  sizeBytes: number;
}

export interface ExtractFrameOptions {
  /** 提取帧的时间戳（秒），默认取 00:00:01 */
  timestamp?: number;
  /** 提取多帧时的数量（均匀分布） */
  count?: number;
  /** 输出宽度（高度自动等比缩放） */
  width?: number;
  /** 输出格式：png 或 jpg */
  format?: 'png' | 'jpg';
}

export interface ExtractedFrame {
  buffer: Buffer;
  timestamp: number;
  mimeType: string;
  extension: string;
}

async function removeTempPath(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    console.warn(`[ffmpeg-bridge] 清理临时文件失败: ${path}`, error);
  }
}

/**
 * 转换媒体格式。
 *
 * @param inputBuffer 输入媒体的 Buffer
 * @param inputMimeType 输入 MIME 类型
 * @param options 转换选项
 * @param signal 中止信号
 */
export async function convertMedia(
  inputBuffer: Buffer,
  inputMimeType: string,
  options: ConvertMediaOptions,
  signal?: AbortSignal,
): Promise<ConvertMediaResult> {
  const { targetFormat } = options;
  const outputMimeType = FORMAT_TO_MIME[targetFormat];
  if (!outputMimeType) {
    throw new Error(`不支持的目标格式: ${targetFormat}`);
  }

  const outputCodec = MIME_TO_CODEC[outputMimeType];
  if (!outputCodec) {
    throw new Error(`目标格式 ${targetFormat} 无编码器映射`);
  }

  const hash = createHash('sha1').update(inputBuffer).digest('hex').slice(0, 12);
  const tempDir = join(tmpdir(), 'openawork-media-convert');
  const inputFile = join(tempDir, `input-${hash}.bin`);
  const outputFile = join(tempDir, `output-${hash}.${outputCodec.extension}`);

  await mkdir(tempDir, { recursive: true });
  await writeFile(inputFile, inputBuffer);

  try {
    const args = buildFFmpegArgs(inputFile, outputFile, options, outputCodec);

    await runFFmpeg(args, signal);

    const outputBuffer = await readFile(outputFile);

    return {
      buffer: outputBuffer,
      outputMimeType,
      outputExtension: outputCodec.extension,
      inputMimeType,
      targetFormat,
      sizeBytes: outputBuffer.byteLength,
    };
  } finally {
    await removeTempPath(inputFile);
    await removeTempPath(outputFile);
  }
}

/**
 * 从视频中提取帧。
 *
 * @param inputBuffer 视频文件的 Buffer
 * @param options 帧提取选项
 * @param signal 中止信号
 */
export async function extractVideoFrames(
  inputBuffer: Buffer,
  options: ExtractFrameOptions,
  signal?: AbortSignal,
): Promise<ExtractedFrame[]> {
  const hash = createHash('sha1').update(inputBuffer).digest('hex').slice(0, 12);
  const tempDir = join(tmpdir(), 'openawork-media-frames');
  const inputFile = join(tempDir, `input-${hash}.bin`);
  await mkdir(tempDir, { recursive: true });
  await writeFile(inputFile, inputBuffer);

  const format = options.format ?? 'png';
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const extension = format === 'jpg' ? 'jpg' : 'png';

  try {
    if (options.count && options.count > 1) {
      // 多帧提取：均匀分布
      const frames = await extractMultipleFrames(inputFile, tempDir, hash, options, format, signal);
      return frames.map((f, i) => ({
        buffer: f,
        timestamp: options.timestamp ?? 0 + i * (options.count ?? 1),
        mimeType,
        extension,
      }));
    }

    // 单帧提取
    const timestamp = options.timestamp ?? 1;
    const outputFile = join(tempDir, `frame-${hash}-0.${format}`);
    const args = [
      '-y',
      '-ss',
      String(timestamp),
      '-i',
      inputFile,
      '-frames:v',
      '1',
      ...(options.width ? ['-vf', `scale=${options.width}:-1`] : []),
      '-f',
      format === 'jpg' ? 'image2' : 'image2',
      '-vcodec',
      format === 'jpg' ? 'mjpeg' : 'png',
      outputFile,
    ];

    await runFFmpeg(args, signal);
    const buffer = await readFile(outputFile);
    await removeTempPath(outputFile);

    return [{ buffer, timestamp, mimeType, extension }];
  } finally {
    await removeTempPath(inputFile);
  }
}

/**
 * 生成视频缩略图（取第 1 秒的帧）。
 */
export async function generateThumbnail(
  inputBuffer: Buffer,
  signal?: AbortSignal,
): Promise<ExtractedFrame> {
  const frames = await extractVideoFrames(
    inputBuffer,
    { timestamp: 1, width: 480, format: 'jpg' },
    signal,
  );
  return frames[0]!;
}

/**
 * 转换媒体格式（URL 输入）。
 *
 * 适用于 HTTP/HTTPS URL，特别是 HLS (.m3u8) 流——FFmpeg 直接流式读取
 * 而非先下载到内存。对于 HLS，FFmpeg 会自动解析播放列表并下载分片。
 */
export async function convertMediaFromUrl(
  inputUrl: string,
  inputMimeType: string,
  options: ConvertMediaOptions,
  signal?: AbortSignal,
): Promise<ConvertMediaResult> {
  const { targetFormat } = options;
  const outputMimeType = FORMAT_TO_MIME[targetFormat];
  if (!outputMimeType) {
    throw new Error(`不支持的目标格式: ${targetFormat}`);
  }

  const outputCodec = MIME_TO_CODEC[outputMimeType];
  if (!outputCodec) {
    throw new Error(`目标格式 ${targetFormat} 无编码器映射`);
  }

  const hash = createHash('sha1').update(inputUrl).digest('hex').slice(0, 12);
  const tempDir = join(tmpdir(), 'openawork-media-convert-url');
  const outputFile = join(tempDir, `output-${hash}.${outputCodec.extension}`);

  await mkdir(tempDir, { recursive: true });

  try {
    const args = buildFFmpegArgsForUrl(inputUrl, outputFile, options, outputCodec, inputMimeType);
    await runFFmpeg(args, signal);

    const outputBuffer = await readFile(outputFile);

    return {
      buffer: outputBuffer,
      outputMimeType,
      outputExtension: outputCodec.extension,
      inputMimeType,
      targetFormat,
      sizeBytes: outputBuffer.byteLength,
    };
  } finally {
    await removeTempPath(outputFile);
  }
}

/**
 * 从视频 URL 提取帧（适用于 HLS 等流媒体）。
 */
export async function extractVideoFramesFromUrl(
  inputUrl: string,
  options: ExtractFrameOptions,
  signal?: AbortSignal,
): Promise<ExtractedFrame[]> {
  const hash = createHash('sha1').update(inputUrl).digest('hex').slice(0, 12);
  const tempDir = join(tmpdir(), 'openawork-media-frames-url');
  await mkdir(tempDir, { recursive: true });

  const format = options.format ?? 'png';
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const extension = format === 'jpg' ? 'jpg' : 'png';

  try {
    if (options.count && options.count > 1) {
      const outputPattern = join(tempDir, `frame-${hash}-%d.${format}`);
      const args = [
        '-y',
        '-user_agent',
        'Mozilla/5.0',
        '-i',
        inputUrl,
        '-vf',
        `select='not(mod(n\\,max(1\\,floor(tb*duration/${options.count}))))',setpts=N/FRAME_RATE/TB${options.width ? `,scale=${options.width}:-1` : ''}`,
        '-vsync',
        'vfr',
        '-frames:v',
        String(options.count),
        '-f',
        'image2',
        outputPattern,
      ];
      await runFFmpeg(args, signal);

      const frames: ExtractedFrame[] = [];
      for (let i = 1; i <= options.count; i++) {
        const framePath = join(tempDir, `frame-${hash}-${i}.${format}`);
        try {
          const buf = await readFile(framePath);
          frames.push({ buffer: buf, timestamp: 0, mimeType, extension });
          await removeTempPath(framePath);
        } catch {
          break;
        }
      }
      return frames;
    }

    // 单帧
    const timestamp = options.timestamp ?? 1;
    const outputFile = join(tempDir, `frame-${hash}-0.${format}`);
    const args = [
      '-y',
      '-user_agent',
      'Mozilla/5.0',
      '-ss',
      String(timestamp),
      '-i',
      inputUrl,
      '-frames:v',
      '1',
      ...(options.width ? ['-vf', `scale=${options.width}:-1`] : []),
      '-f',
      'image2',
      '-vcodec',
      format === 'jpg' ? 'mjpeg' : 'png',
      outputFile,
    ];

    await runFFmpeg(args, signal);
    const buffer = await readFile(outputFile);
    await removeTempPath(outputFile);

    return [{ buffer, timestamp, mimeType, extension }];
  } finally {
    // 清理残留
    const files = await readdir(tempDir);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`frame-${hash}`))
        .map((f) => removeTempPath(join(tempDir, f))),
    );
  }
}

function buildFFmpegArgs(
  input: string,
  output: string,
  options: ConvertMediaOptions,
  outputCodec: { audioCodec?: string; videoCodec?: string; category: string },
): string[] {
  const args: string[] = ['-y'];

  // 输入选项
  if (options.startTime !== undefined) {
    args.push('-ss', String(options.startTime));
  }
  args.push('-i', input);

  // 持续时间
  if (options.duration !== undefined) {
    args.push('-t', String(options.duration));
  }

  // 视频编码
  const isImageOutput = outputCodec.category === 'image';
  if (outputCodec.videoCodec && !isImageOutput) {
    args.push('-vcodec', outputCodec.videoCodec);
    if (options.videoQuality !== undefined && outputCodec.videoCodec === 'libx264') {
      args.push('-crf', String(options.videoQuality));
    }
    if (options.videoScale) {
      args.push('-vf', `scale=${options.videoScale}`);
    }
    if (options.videoFps) {
      args.push('-r', String(options.videoFps));
    }
  }

  // GIF 特殊处理
  if (outputCodec.videoCodec === 'gif') {
    args.push('-an');
    if (options.gifLoop !== undefined) {
      args.push('-loop', String(options.gifLoop));
    }
  }

  // 音频编码
  if (outputCodec.audioCodec && outputCodec.category !== 'image') {
    args.push('-acodec', outputCodec.audioCodec);
    if (options.audioBitrate) {
      args.push('-b:a', options.audioBitrate);
    }
  } else if (outputCodec.category === 'image') {
    args.push('-an');
  }

  args.push(output);
  return args;
}

function buildFFmpegArgsForUrl(
  inputUrl: string,
  output: string,
  options: ConvertMediaOptions,
  outputCodec: { audioCodec?: string; videoCodec?: string; category: string },
  _inputMimeType: string,
): string[] {
  const args: string[] = ['-y'];

  // HTTP/HLS 输入选项
  args.push('-user_agent', 'Mozilla/5.0');
  args.push('-referer', 'https://x.com/');
  // 允许不安全的 TLS（某些 CDN 证书有问题）
  args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto');

  // 输入选项
  if (options.startTime !== undefined) {
    args.push('-ss', String(options.startTime));
  }
  args.push('-i', inputUrl);

  // 持续时间
  if (options.duration !== undefined) {
    args.push('-t', String(options.duration));
  }

  // 视频编码
  const isImageOutput = outputCodec.category === 'image';
  if (outputCodec.videoCodec && !isImageOutput) {
    args.push('-vcodec', outputCodec.videoCodec);
    if (options.videoQuality !== undefined && outputCodec.videoCodec === 'libx264') {
      args.push('-crf', String(options.videoQuality));
    }
    if (options.videoScale) {
      args.push('-vf', `scale=${options.videoScale}`);
    }
    if (options.videoFps) {
      args.push('-r', String(options.videoFps));
    }
  }

  // GIF 特殊处理
  if (outputCodec.videoCodec === 'gif') {
    args.push('-an');
    if (options.gifLoop !== undefined) {
      args.push('-loop', String(options.gifLoop));
    }
  }

  // 音频编码
  if (outputCodec.audioCodec && outputCodec.category !== 'image') {
    args.push('-acodec', outputCodec.audioCodec);
    if (options.audioBitrate) {
      args.push('-b:a', options.audioBitrate);
    }
  } else if (outputCodec.category === 'image') {
    args.push('-an');
  }

  args.push(output);
  return args;
}

async function extractMultipleFrames(
  inputFile: string,
  tempDir: string,
  hash: string,
  options: ExtractFrameOptions,
  format: string,
  signal?: AbortSignal,
): Promise<Buffer[]> {
  const count = options.count ?? 1;
  const frames: Buffer[] = [];

  // 使用 select 滤镜均匀取帧
  const outputPattern = join(tempDir, `frame-${hash}-%d.${format}`);
  const args = [
    '-y',
    '-i',
    inputFile,
    '-vf',
    `select='not(mod(n\\,max(1\\,floor(tb*duration/${count}))))',setpts=N/FRAME_RATE/TB${options.width ? `,scale=${options.width}:-1` : ''}`,
    '-vsync',
    'vfr',
    '-frames:v',
    String(count),
    '-f',
    'image2',
    outputPattern,
  ];

  await runFFmpeg(args, signal);

  for (let i = 1; i <= count; i++) {
    const framePath = join(tempDir, `frame-${hash}-${i}.${format}`);
    try {
      const buf = await readFile(framePath);
      frames.push(buf);
      await removeTempPath(framePath);
    } catch {
      break;
    }
  }

  return frames;
}

function runFFmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  if (!FFMPEG_PATH) {
    return Promise.reject(new Error('ffmpeg 不可用。请配置 FFMPEG_BIN 或安装 ffmpeg-static。'));
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: Buffer[] = [];
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
      reject(new Error(`ffmpeg 启动失败: ${err.message}`));
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-500) || '未知错误'}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * 检测 ffmpeg 是否可用。
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!FFMPEG_PATH) {
      resolve(false);
      return;
    }
    const child = spawn(FFMPEG_PATH, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
