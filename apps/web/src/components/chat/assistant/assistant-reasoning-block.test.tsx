import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AssistantReasoningBlock,
  resetReasoningOpenStateCacheForTests,
} from './assistant-reasoning-block.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

// Mock the display preferences store
vi.mock('../../../stores/settings/display-preferences.js', () => ({
  useDisplayPreferencesStore: vi.fn(),
}));

describe('AssistantReasoningBlock - 响应显示设置变化', () => {
  const mockRenderBody = vi.fn((content: string) => <div>{content}</div>);

  beforeEach(() => {
    resetReasoningOpenStateCacheForTests();
    vi.clearAllMocks();
  });

  it('应该根据显示设置初始化展开状态', () => {
    // 设置为默认展开
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: true }),
    );

    const multiLineContent = `这是一段
多行
推理内容`;

    const { container } = render(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 默认展开时应该没有 collapsed 标记
    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
  });

  it('应该在设置变化时更新展开状态（用户未手动操作）', () => {
    // 初始设置为折叠
    const mockStore = vi.mocked(useDisplayPreferencesStore);
    mockStore.mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const multiLineContent = `这是一段
多行
推理内容`;

    const { container, unmount } = render(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 验证初始为折叠状态
    let section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBe('true');

    // 卸载组件
    unmount();

    // 修改设置为展开
    mockStore.mockImplementation((selector: any) => selector({ reasoningExpandedByDefault: true }));

    // 重新挂载组件
    const { container: container2 } = render(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 应该使用新的设置值，展开显示
    section = container2.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
  });

  it('用户手动操作后，不应再响应设置变化', () => {
    const mockStore = vi.mocked(useDisplayPreferencesStore);
    mockStore.mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const multiLineContent = `这是一段
多行
推理内容`;

    const { container, rerender } = render(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 用户手动展开
    const expandButton = within(container).getByText('展开');
    fireEvent.click(expandButton);

    // 验证已展开
    let section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();

    // 修改设置为折叠
    mockStore.mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    rerender(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 用户手动操作后，不应响应设置变化，仍保持展开
    section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
  });

  it('单行内容应该始终展开，不受设置影响', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const { container } = render(
      <AssistantReasoningBlock
        content="单行内容"
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );

    // 单行内容不可折叠
    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
    expect(within(container).queryByText('展开')).toBeNull();
  });

  it('流式生成中的内容应该始终展开', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const multiLineContent = `这是一段
多行
推理内容`;

    const { container } = render(
      <AssistantReasoningBlock
        content={multiLineContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );

    // 流式生成中不可折叠
    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
  });
});
