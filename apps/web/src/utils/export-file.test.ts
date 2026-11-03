// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportFile } from './export-file.js';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__TAURI__');
});

describe('exportFile', () => {
  it('在桌面端通过 Tauri 保存文本文件', async () => {
    const invoke = vi.fn().mockResolvedValue('/tmp/report.md');
    window.__TAURI__ = { core: { invoke } };

    const result = await exportFile({
      content: '# report',
      filename: 'report.md',
      mimeType: 'text/markdown;charset=utf-8',
    });

    expect(result).toEqual({ kind: 'desktop', path: '/tmp/report.md' });
    expect(invoke).toHaveBeenCalledWith('save_export_file', {
      content: '# report',
      filename: 'report.md',
    });
  });

  it('桌面端取消保存时返回 cancelled 且不触发浏览器下载', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const createElement = vi.spyOn(document, 'createElement');
    window.__TAURI__ = { core: { invoke } };

    const result = await exportFile({
      content: 'cancelled',
      filename: 'cancelled.txt',
      mimeType: 'text/plain;charset=utf-8',
    });

    expect(result).toEqual({ kind: 'cancelled' });
    expect(createElement).not.toHaveBeenCalled();
  });

  it('在桌面端把 data URL 转为字节保存', async () => {
    const invoke = vi.fn().mockResolvedValue('/tmp/image.png');
    window.__TAURI__ = { core: { invoke } };

    const result = await exportFile({
      dataUrl: 'data:text/plain;base64,aGk=',
      filename: 'image.png',
    });

    expect(result).toEqual({ kind: 'desktop', path: '/tmp/image.png' });
    expect(invoke).toHaveBeenCalledWith('save_export_file_bytes', {
      bytes: [104, 105],
      filename: 'image.png',
    });
  });

  it('在桌面端把 Blob 转为字节保存（弹原生保存对话框）', async () => {
    const invoke = vi.fn().mockResolvedValue('/tmp/report.pdf');
    window.__TAURI__ = { core: { invoke } };

    const result = await exportFile({
      blob: new Blob(['hi']),
      filename: 'report.pdf',
    });

    expect(result).toEqual({ kind: 'desktop', path: '/tmp/report.pdf' });
    expect(invoke).toHaveBeenCalledWith('save_export_file_bytes', {
      bytes: [104, 105],
      filename: 'report.pdf',
    });
  });

  it('桌面端 Blob 保存被取消时返回 cancelled 且不触发浏览器下载', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const createElement = vi.spyOn(document, 'createElement');
    window.__TAURI__ = { core: { invoke } };

    const result = await exportFile({ blob: new Blob(['x']), filename: 'x.bin' });

    expect(result).toEqual({ kind: 'cancelled' });
    expect(invoke).toHaveBeenCalledWith('save_export_file_bytes', {
      bytes: [120],
      filename: 'x.bin',
    });
    expect(createElement).not.toHaveBeenCalled();
  });

  it('Web 端 Blob 走 object URL + anchor 并回收（不残留 Blob URL）', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:openawork-blob-test');
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    const result = await exportFile({ blob: new Blob(['data']), filename: 'data.bin' });

    expect(result).toEqual({ kind: 'browser' });
    expect(anchor.download).toBe('data.bin');
    expect(anchor.href).toBe('blob:openawork-blob-test');
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:openawork-blob-test');
  });

  it('Web 端保持浏览器下载行为', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:openawork-test');
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    const result = await exportFile({
      content: 'web',
      filename: 'web.txt',
      mimeType: 'text/plain;charset=utf-8',
    });

    expect(result).toEqual({ kind: 'browser' });
    expect(anchor.download).toBe('web.txt');
    expect(anchor.href).toBe('blob:openawork-test');
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:openawork-test');
  });
});
