// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDisplayPreferencesStore } from './display-preferences.js';
import { useToolExpandDefault } from './use-tool-expand-default.js';

const BASE_OVERRIDES = {
  bash: false,
  fileEdit: true,
  fileRead: false,
  mcp: false,
  skill: false,
  web: false,
  batch: false,
  other: false,
} as const;

describe('useToolExpandDefault', () => {
  beforeEach(() => {
    useDisplayPreferencesStore.setState({
      toolCallsExpandedByDefault: false,
      toolExpandedOverrides: { ...BASE_OVERRIDES },
    });
  });

  it('文件编辑 / 写入默认展开（对齐参考实现 opencode 的文件卡）', () => {
    const { result } = renderHook(() => useToolExpandDefault());

    expect(result.current('edit')).toBe(true);
    expect(result.current('write')).toBe(true);
    expect(result.current('patch')).toBe(true);
    expect(result.current('multi_edit')).toBe(true);
  });

  it('显式关闭 fileEdit 类别后不再默认展开', () => {
    useDisplayPreferencesStore.setState((s) => ({
      toolExpandedOverrides: { ...s.toolExpandedOverrides, fileEdit: false },
    }));

    const { result } = renderHook(() => useToolExpandDefault());

    expect(result.current('edit')).toBe(false);
  });

  it('其余类别仍受全局开关 + 类别开关控制', () => {
    const { result } = renderHook(() => useToolExpandDefault());

    expect(result.current('bash')).toBe(false);

    act(() => {
      useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: true });
    });
    expect(result.current('bash')).toBe(false);

    act(() => {
      useDisplayPreferencesStore.setState((s) => ({
        toolExpandedOverrides: { ...s.toolExpandedOverrides, bash: true },
      }));
    });
    expect(result.current('bash')).toBe(true);
  });
});
