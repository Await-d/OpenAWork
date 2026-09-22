import { describe, expect, it } from 'vitest';
import { resolveToolCallImageSource } from './tool-call-image-source.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const REMOTE_IMAGE_URL = 'https://example.com/assets/photo.png';
// 长度 > 128 的裸 base64（真实图片体量远大于此，此处的长度本身就是判定条件）。
const LONG_BASE64 = `iVBORw0KGgoAAAANSUhEUg${'A'.repeat(160)}`;

describe('resolveToolCallImageSource — look_at', () => {
  it('data URL 图片数据 → inline 源', () => {
    expect(resolveToolCallImageSource('look_at', { image_data: PNG_DATA_URL })).toEqual({
      kind: 'inline',
      src: PNG_DATA_URL,
      alt: '已查看的图片',
    });
  });

  it('http(s) 远端图片地址 → remote 源', () => {
    expect(resolveToolCallImageSource('look_at', { image_data: REMOTE_IMAGE_URL })).toEqual({
      kind: 'remote',
      src: REMOTE_IMAGE_URL,
      alt: '已查看的图片',
    });
    expect(
      resolveToolCallImageSource('look_at', { image_data: 'http://example.com/pic.jpg' }),
    ).toEqual({
      kind: 'remote',
      src: 'http://example.com/pic.jpg',
      alt: '已查看的图片',
    });
  });

  it('裸 base64（含换行空白）→ 补全为 PNG data URL 的 inline 源', () => {
    const wrapped = `${LONG_BASE64.slice(0, 80)}\n${LONG_BASE64.slice(80)}`;
    expect(resolveToolCallImageSource('look_at', { image_data: wrapped })).toEqual({
      kind: 'inline',
      src: `data:image/png;base64,${LONG_BASE64}`,
      alt: '已查看的图片',
    });
  });

  it('过短的裸 base64（≤128 字符）不视为图片', () => {
    expect(resolveToolCallImageSource('look_at', { image_data: 'A'.repeat(128) })).toBeNull();
    expect(resolveToolCallImageSource('look_at', { image_data: 'iVBORw0KGgo=' })).toBeNull();
  });

  it('非图片的 data URL（如 PDF）不产生图片预览', () => {
    expect(
      resolveToolCallImageSource('look_at', {
        image_data: 'data:application/pdf;base64,JVBERi0xLjQK',
      }),
    ).toBeNull();
  });

  it('图片类 file_path → workspace 源', () => {
    expect(
      resolveToolCallImageSource('look_at', { file_path: '/workspace/assets/diagram.webp' }),
    ).toEqual({
      kind: 'workspace',
      path: '/workspace/assets/diagram.webp',
      alt: '已查看的图片',
    });
  });

  it('非图片 file_path（文本 / PDF）→ null', () => {
    expect(resolveToolCallImageSource('look_at', { file_path: '/workspace/notes.md' })).toBeNull();
    expect(
      resolveToolCallImageSource('look_at', { file_path: '/workspace/report.pdf' }),
    ).toBeNull();
  });

  it('image_data 与 file_path 皆无 → null', () => {
    expect(resolveToolCallImageSource('look_at', {})).toBeNull();
    expect(resolveToolCallImageSource('look_at', { prompt: '这张图里有什么？' })).toBeNull();
  });

  it('image_data 无法识别时回退到图片 file_path', () => {
    expect(
      resolveToolCallImageSource('look_at', {
        image_data: '看不清的说明文字',
        file_path: '/workspace/screenshots/step-1.png',
      }),
    ).toEqual({
      kind: 'workspace',
      path: '/workspace/screenshots/step-1.png',
      alt: '已查看的图片',
    });
  });

  it('工具名大小写与首尾空白不影响判定', () => {
    expect(resolveToolCallImageSource('  LOOK_AT ', { image_data: PNG_DATA_URL })?.kind).toBe(
      'inline',
    );
  });
});

describe('resolveToolCallImageSource — desktop_automation / desktop_control', () => {
  it('output 为 JSON 字符串 → artifact 源', () => {
    const output = JSON.stringify({
      success: true,
      artifactId: 'artifact-123',
      fileName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
    });

    expect(resolveToolCallImageSource('desktop_automation', {}, output)).toEqual({
      kind: 'artifact',
      artifactId: 'artifact-123',
      alt: '桌面截图',
    });
  });

  it('output 为已解析对象 → artifact 源', () => {
    expect(
      resolveToolCallImageSource(
        'desktop_control',
        {},
        {
          artifactId: 'artifact-456',
          mimeType: 'image/jpeg',
        },
      ),
    ).toEqual({
      kind: 'artifact',
      artifactId: 'artifact-456',
      alt: '桌面截图',
    });
  });

  it('mimeType 缺失时按图片产物兜底', () => {
    expect(
      resolveToolCallImageSource('desktop_automation', {}, JSON.stringify({ artifactId: 'a-1' })),
    ).toEqual({ kind: 'artifact', artifactId: 'a-1', alt: '桌面截图' });
  });

  it('mimeType 非图片 → null', () => {
    expect(
      resolveToolCallImageSource(
        'desktop_automation',
        {},
        JSON.stringify({ artifactId: 'a-2', mimeType: 'application/pdf' }),
      ),
    ).toBeNull();
  });

  it('无 artifactId → null', () => {
    expect(
      resolveToolCallImageSource('desktop_automation', {}, JSON.stringify({ success: true })),
    ).toBeNull();
  });

  it('output 非 JSON 字符串 / 为空 → 安全忽略并返回 null', () => {
    expect(
      resolveToolCallImageSource('desktop_automation', {}, '桌面截图失败：连接超时'),
    ).toBeNull();
    expect(resolveToolCallImageSource('desktop_automation', {}, '')).toBeNull();
    expect(resolveToolCallImageSource('desktop_automation', {}, undefined)).toBeNull();
    expect(resolveToolCallImageSource('desktop_automation', {}, null)).toBeNull();
  });
});

describe('resolveToolCallImageSource — computer_use', () => {
  const SCREENSHOT_ATTACHMENT = {
    type: 'input_image' as const,
    artifactId: 'artifact-gui-1',
    fileName: 'computer-use-final.png',
    mimeType: 'image/png',
    detail: 'high' as const,
  };

  it('从 attachments 的 artifactId 解析为 artifact 源（output 里没有 artifactId）', () => {
    const output = JSON.stringify({
      success: true,
      steps: 2,
      summary: '已完成：打开了系统设置',
      history: [{ step: 1, thought: '先点开始菜单', action: 'click', success: true }],
    });

    expect(resolveToolCallImageSource('computer_use', {}, output, [SCREENSHOT_ATTACHMENT])).toEqual(
      {
        kind: 'artifact',
        artifactId: 'artifact-gui-1',
        alt: 'GUI 操作截图',
      },
    );
  });

  it('无 attachments / 空数组 → null（截图不在 output 里）', () => {
    const output = JSON.stringify({ success: true, steps: 1, summary: '完成', history: [] });

    expect(resolveToolCallImageSource('computer_use', {}, output)).toBeNull();
    expect(resolveToolCallImageSource('computer_use', {}, output, [])).toBeNull();
  });

  it('跳过非图片附件，取第一个可用的图片附件', () => {
    const attachments = [
      { type: 'input_image' as const, artifactId: 'artifact-text', mimeType: 'text/plain' },
      { type: 'input_image' as const, artifactId: 'artifact-gui-2', mimeType: 'image/jpeg' },
    ];

    expect(resolveToolCallImageSource('computer_use', {}, undefined, attachments)).toEqual({
      kind: 'artifact',
      artifactId: 'artifact-gui-2',
      alt: 'GUI 操作截图',
    });
  });

  it('没有 artifactId 时回退 imageUrl（data URL → inline，http(s) → remote）', () => {
    expect(
      resolveToolCallImageSource('computer_use', {}, undefined, [
        { type: 'input_image', imageUrl: PNG_DATA_URL, mimeType: 'image/png' },
      ]),
    ).toEqual({ kind: 'inline', src: PNG_DATA_URL, alt: 'GUI 操作截图' });
    expect(
      resolveToolCallImageSource('computer_use', {}, undefined, [
        { type: 'input_image', imageUrl: REMOTE_IMAGE_URL, mimeType: 'image/png' },
      ]),
    ).toEqual({ kind: 'remote', src: REMOTE_IMAGE_URL, alt: 'GUI 操作截图' });
  });

  it('附件只有无法识别的 imageUrl（如网关相对路径）→ null', () => {
    expect(
      resolveToolCallImageSource('computer_use', {}, undefined, [
        { type: 'input_image', imageUrl: '/attachments/a.png', mimeType: 'image/png' },
      ]),
    ).toBeNull();
  });

  it('其它工具不消费 attachments', () => {
    expect(
      resolveToolCallImageSource('read', { file_path: '/workspace/a.ts' }, 'ok', [
        SCREENSHOT_ATTACHMENT,
      ]),
    ).toBeNull();
    expect(
      resolveToolCallImageSource('desktop_control', {}, JSON.stringify({ success: true }), [
        SCREENSHOT_ATTACHMENT,
      ]),
    ).toBeNull();
  });
});

describe('resolveToolCallImageSource — 其它工具', () => {
  it('无关工具即使带图片字段也返回 null', () => {
    expect(resolveToolCallImageSource('read', { file_path: '/workspace/a.png' })).toBeNull();
    expect(
      resolveToolCallImageSource(
        'generate_image',
        { prompt: '一只猫' },
        {
          artifactId: 'a-3',
        },
      ),
    ).toBeNull();
    expect(resolveToolCallImageSource('bash', { command: 'ls' }, 'ok')).toBeNull();
  });
});
