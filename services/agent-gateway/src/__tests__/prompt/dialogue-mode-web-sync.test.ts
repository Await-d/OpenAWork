/**
 * 对话模式提示词 ↔ Web 模式说明 同步契约
 *
 * 背景：`apps/web/src/pages/chat-page/mode/dialogue-mode.ts` 是模式提示词行为的
 * UI 镜像（模式选择器文案与说明）。两侧此前靠人工同步，本契约在网关侧读取 Web
 * 源码做语义锚点断言：任一侧漂移（Web 不再声明某模式、或锚点短语被删）都会失败。
 *
 * 说明：这是**测试期**跨包读取（`node:fs`），生产代码零依赖；Web 文件移动时会
 * 先由 existsSync 失败并给出路径更新提示。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DialogueMode } from '@openAwork/shared';
import { describe, expect, it } from 'vitest';
import { DIALOGUE_MODE_SYSTEM_PROMPTS } from '../../routes/stream-system-prompts.js';

const WEB_MODE_DEFINITIONS_PATH = fileURLToPath(
  new URL('../../../../../apps/web/src/pages/chat-page/mode/dialogue-mode.ts', import.meta.url),
);

/** 每个模式在两侧都必须存在的语义锚点（须同时表达该模式的核心行为）。 */
const MODE_SYNC_ANCHORS: Record<DialogueMode, string> = {
  clarify: '只读',
  coding: '最小变更',
  programmer: '影响面驱动',
};

describe('对话模式提示词与 Web 模式说明同步', () => {
  it('Web 模式定义文件存在（移动文件时需同步更新本测试路径）', () => {
    expect(existsSync(WEB_MODE_DEFINITIONS_PATH), `找不到 ${WEB_MODE_DEFINITIONS_PATH}`).toBe(true);
  });

  it('Web 定义覆盖全部 DialogueMode，且两侧共享语义锚点', () => {
    const webSource = readFileSync(WEB_MODE_DEFINITIONS_PATH, 'utf8');

    for (const mode of Object.keys(MODE_SYNC_ANCHORS) as DialogueMode[]) {
      const anchor = MODE_SYNC_ANCHORS[mode];

      expect(webSource, `Web 模式定义缺少 value: '${mode}'`).toContain(`value: '${mode}'`);
      expect(webSource, `Web 模式说明缺少锚点「${anchor}」`).toContain(anchor);
      expect(DIALOGUE_MODE_SYSTEM_PROMPTS[mode], `提示词缺少锚点「${anchor}」`).toContain(anchor);
    }
  });
});
