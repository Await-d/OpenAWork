import { describe, expect, it } from 'vitest';
import {
  buildVoiceRecordingFileName,
  createVoiceRecordingFile,
  resolveAudioFileExtension,
} from './voice-recording-attachment.js';

describe('resolveAudioFileExtension', () => {
  it('覆盖 MediaRecorder 各家实现的实际产出容器', () => {
    expect(resolveAudioFileExtension('audio/webm')).toBe('webm');
    expect(resolveAudioFileExtension('audio/ogg')).toBe('ogg');
    expect(resolveAudioFileExtension('audio/mp4')).toBe('m4a');
    expect(resolveAudioFileExtension('audio/mpeg')).toBe('mp3');
  });

  it('容忍带 codecs 参数的 mime 头', () => {
    expect(resolveAudioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(resolveAudioFileExtension('  AUDIO/WAV  ')).toBe('wav');
  });

  it('未知或缺失 mime 回落到 webm', () => {
    expect(resolveAudioFileExtension('audio/x-unknown')).toBe('webm');
    expect(resolveAudioFileExtension(undefined)).toBe('webm');
    expect(resolveAudioFileExtension(null)).toBe('webm');
    expect(resolveAudioFileExtension('')).toBe('webm');
  });
});

describe('buildVoiceRecordingFileName', () => {
  it('生成带本地时区时间戳的 voice-input-HHmmss 文件名', () => {
    const at = new Date(2026, 9, 7, 9, 5, 3);

    expect(buildVoiceRecordingFileName('audio/webm', at)).toBe('voice-input-090503.webm');
  });

  it('秒位补零，保证文件名等宽', () => {
    const at = new Date(2026, 0, 1, 23, 59, 9);

    expect(buildVoiceRecordingFileName('audio/mp4', at)).toBe('voice-input-235909.m4a');
  });
});

describe('createVoiceRecordingFile', () => {
  it('把录音 blob 包成带 mime 与时间戳文件名的附件', async () => {
    const blob = new Blob(['fake-opus-bytes'], { type: 'audio/webm' });
    const at = new Date(2026, 9, 7, 14, 30, 52);

    const file = createVoiceRecordingFile(blob, at);

    expect(file.name).toBe('voice-input-143052.webm');
    expect(file.type).toBe('audio/webm');
    expect(file.size).toBe(blob.size);
    // 内容必须与原始 blob 一致——上传端点按字节落库。
    expect(await file.text()).toBe('fake-opus-bytes');
  });

  it('blob 缺省 mime 时补 audio/webm，避免上传端点丢失类型信息', () => {
    const blob = new Blob(['bytes'], { type: '' });

    expect(createVoiceRecordingFile(blob, new Date(2026, 0, 1, 0, 0, 0)).type).toBe('audio/webm');
  });
});
