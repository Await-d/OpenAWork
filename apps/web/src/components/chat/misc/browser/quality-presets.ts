/**
 * 实时预览的画质档位（流畅 / 均衡 / 清晰 / 无损）。
 *
 * 一个档位同时决定两件事，二者必须一起变，否则会出现「位图更大了但视口还是 1x」
 * 这种只花成本、不涨清晰度的组合：
 *
 * - `displayScale`：帧盒相对 CSS 像素的倍数，同时作为 `device` 上行的
 *   `deviceScaleFactor`（CDP 的 screencast 只缩不放，视口物理像素才是清晰度上限）。
 *   **实际生效值还要与显示器 DPR 取小**（`resolveDisplayScale`）——在 1x 屏上按 1.5
 *   或 2 倍取像素只是让 Chromium 多光栅化一遍再缩回去显示，清晰度不涨而编码 / 传输 /
 *   解码全额变慢。
 * - `quality`：起流 JPEG 质量。分辨率越高，同样质量下体积增长越快，所以档位质量
 *   不随倍数线性提高。
 *
 * 这只是「起手定档」：运行中网关仍会按 ack 往返继续降档 / 回升（见 hub.ts 的
 * `noteFrameLatency`），下限 40、上限就是这里给的值。
 */

export type BrowserQualityPresetId = 'smooth' | 'balanced' | 'sharp' | 'lossless';

export interface BrowserQualityPreset {
  id: BrowserQualityPresetId;
  label: string;
  /** 帧盒 / 视口相对 CSS 像素的倍数（1 = 1:1，不放大也不缩）。 */
  displayScale: number;
  /** 起流 JPEG 质量（PNG 无损档位不发送此字段）。 */
  quality?: number;
  /** screencast 编码格式；JPEG 为默认有损，PNG 为无损。 */
  format: 'jpeg' | 'png';
  /** 控件里的一句话说明，避免用户只能靠猜。 */
  hint: string;
}

export const BROWSER_QUALITY_PRESETS: readonly BrowserQualityPreset[] = [
  {
    id: 'smooth',
    label: '流畅',
    displayScale: 1,
    quality: 45,
    format: 'jpeg',
    hint: '1:1 像素，最省资源；适合滚动 / 动画多的页面',
  },
  {
    id: 'balanced',
    label: '均衡',
    displayScale: 1.5,
    quality: 50,
    format: 'jpeg',
    hint: '最多 1.5 倍像素（受屏幕 DPR 限制），文字更清楚；多数场景的推荐档位',
  },
  {
    id: 'sharp',
    label: '清晰',
    displayScale: 2,
    quality: 50,
    format: 'jpeg',
    hint: '最多 2 倍像素（接近 Retina，受屏幕 DPR 限制）；帧更大，弱链路会自动降质量',
  },
  {
    id: 'lossless',
    label: '无损',
    displayScale: 1,
    format: 'png',
    hint: 'PNG 无损编码，文字和细节最完整；帧体积更大，动画页面可能降低帧率',
  },
];

export const DEFAULT_QUALITY_PRESET_ID: BrowserQualityPresetId = 'balanced';

/** 解析档位 id；未知 / 缺失一律回落默认档，保证永远有可渲染的定档。 */
export function resolveQualityPreset(id: string | null | undefined): BrowserQualityPreset {
  const matched = BROWSER_QUALITY_PRESETS.find((preset) => preset.id === id);
  if (matched) {
    return matched;
  }
  const fallback = BROWSER_QUALITY_PRESETS.find(
    (preset) => preset.id === DEFAULT_QUALITY_PRESET_ID,
  );
  // 常量表里一定存在默认档；这里兜底只是为了让返回类型不必是可空的。
  return fallback ?? BROWSER_QUALITY_PRESETS[0]!;
}
