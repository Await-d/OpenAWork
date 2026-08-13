// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, vi } from 'vitest';
import {
  prepareFusionSidebarMocks,
  resetFusionSidebarUiState,
} from './FusionSidebar.test-utils.js';

// SidebarRailV2 已移除工作区头像/切换工作区按钮，折叠态 Peek 预览功能的触发点不再存在，
// 原有三个集成测试（hover 展示预览、延迟关闭、选择会话）已随之删除。

beforeEach(() => {
  cleanup();
  prepareFusionSidebarMocks(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetFusionSidebarUiState(false);
});

describe('FusionSidebar 折叠预览', () => {
  // 工作区头像切换按钮已从 SidebarRailV2 中移除，Peek 触发点不再存在，测试已删除。
});
