import { render, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssistantReasoningBlock } from './assistant-reasoning-block.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

// Mock the display preferences store
vi.mock('../../../stores/settings/display-preferences.js', () => ({
  useDisplayPreferencesStore: vi.fn(),
}));

describe('AssistantReasoningBlock - 响应显示设置变化', () => {
  const mockRenderBody = vi.fn((content: string) => <div>{content}</div>);

  beforeEach(() => {
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

  it('非流式且已结束时按设置折叠，Thinking 标签固定在内容区外', () => {
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
        ended={true}
        renderBody={mockRenderBody}
      />,
    );

    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBe('true');
    expect(within(container).getByText('Thinking:')).toBeTruthy();
  });
});

describe('AssistantReasoningBlock - 流式进行中的实时预览折叠', () => {
  const mockRenderBody = vi.fn((content: string) => <div>{content}</div>);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const longContent = Array.from({ length: 20 }, (_, i) => `思考行 ${i + 1}`).join('\n');
  // 与组件 computeClampedBodyMaxHeight(REASONING_COLLAPSED_MAX_LINES) 使用同一公式
  const collapsedMaxHeight = `${3 * 1.6 * 13 + 4}px`;
  // 折叠窗口是"贴底窗口"：column-reverse 让可见区落在末尾，超出部分从顶部裁掉
  const collapsedBodyStyle = {
    maxHeight: collapsedMaxHeight,
    overflow: 'clip',
    display: 'flex',
    flexDirection: 'column-reverse',
  };
  const expandedBodyStyle = {
    maxHeight: null,
    overflow: null,
    display: null,
    flexDirection: null,
  };

  const readBodyClamp = (container: HTMLElement) => {
    const body = container.querySelector<HTMLElement>('.assistant-reasoning-body');
    return {
      maxHeight: body?.style.maxHeight || null,
      overflow: body?.style.overflow || null,
      display: body?.style.display || null,
      flexDirection: body?.style.flexDirection || null,
    };
  };

  it('流式生成中的多行内容与静态折叠使用同一限高', () => {
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

    // 与静态折叠一致：流式中同样折叠（不再使用更宽松的 6 行预览窗口）
    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBe('true');
    expect(section?.getAttribute('data-collapsed-window')).toBe('tail');
    expect(readBodyClamp(container)).toEqual(collapsedBodyStyle);
    expect(within(container).getByText('展开')).toBeTruthy();
  });

  it('流式生成中的超长内容限高与静态折叠一致并提供展开按钮', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const { container } = render(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );

    // 流式中不再无限堆高：进入折叠态并允许展开，且限高与静态折叠完全相同
    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBe('true');
    expect(readBodyClamp(container)).toEqual(collapsedBodyStyle);
    expect(within(container).getByText('展开')).toBeTruthy();
  });

  it('同一内容在流式与静态折叠下渲染高度与样式完全一致（finalize 不跳动）', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const { container: liveContainer, unmount } = render(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );
    const liveClamp = readBodyClamp(liveContainer);
    const liveSection = liveContainer.querySelector('.assistant-reasoning-block');
    const liveText = liveContainer.querySelector('.assistant-reasoning-body')?.textContent;

    unmount();

    const { container: staticContainer } = render(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        renderBody={mockRenderBody}
      />,
    );
    const staticClamp = readBodyClamp(staticContainer);
    const staticSection = staticContainer.querySelector('.assistant-reasoning-block');

    expect(liveClamp.maxHeight).toBe(collapsedMaxHeight);
    expect(liveClamp).toEqual(staticClamp);
    // 折叠窗口贴底指向末尾：流式与静态同为一个"末尾 N 行"窗口（finalize 不翻转方向）
    expect(liveSection?.getAttribute('data-collapsed-window')).toBe('tail');
    expect(staticSection?.getAttribute('data-collapsed-window')).toBe('tail');
    expect(liveSection?.getAttribute('data-collapsed')).toBe('true');
    expect(staticSection?.getAttribute('data-collapsed')).toBe('true');
    expect(liveText).toBe(staticContainer.querySelector('.assistant-reasoning-body')?.textContent);
  });

  it('流式预览中点击展开后展示全部内容，可再收起回到预览', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const { container } = render(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );

    fireEvent.click(within(container).getByText('展开'));

    let section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
    expect(within(container).getByText('收起')).toBeTruthy();

    fireEvent.click(within(container).getByText('收起'));

    section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBe('true');
    expect(readBodyClamp(container)).toEqual(collapsedBodyStyle);
    expect(within(container).getByText('展开')).toBeTruthy();
  });

  it('折叠窗口贴底指向最新思考：流式追加不翻转方向，展开再收起仍回到末尾', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: false }),
    );

    const firstBatch = Array.from({ length: 4 }, (_, i) => `思考行 ${i + 1}`).join('\n');
    const { container, rerender } = render(
      <AssistantReasoningBlock
        content={firstBatch}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );

    // 流式追加内容：窗口保持"贴底"语义，不因内容变长而切回开头
    rerender(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );
    let section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed-window')).toBe('tail');
    expect(readBodyClamp(container)).toEqual(collapsedBodyStyle);
    // 文本没有被截断（裁剪发生在布局层），最新一行仍在 DOM 中
    expect(container.querySelector('.assistant-reasoning-body')?.textContent).toContain(
      '思考行 20',
    );

    // 展开看全量，再收起：仍然回到贴底窗口（可见区指向末尾）
    fireEvent.click(within(container).getByText('展开'));
    expect(readBodyClamp(container)).toEqual(expandedBodyStyle);

    fireEvent.click(within(container).getByText('收起'));
    section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed-window')).toBe('tail');
    expect(readBodyClamp(container)).toEqual(collapsedBodyStyle);
  });

  it('开启"推理默认展开"时流式内容完整展示', () => {
    vi.mocked(useDisplayPreferencesStore).mockImplementation((selector: any) =>
      selector({ reasoningExpandedByDefault: true }),
    );

    const { container } = render(
      <AssistantReasoningBlock
        content={longContent}
        index={0}
        total={1}
        streaming={true}
        renderBody={mockRenderBody}
      />,
    );

    const section = container.querySelector('.assistant-reasoning-block');
    expect(section?.getAttribute('data-collapsed')).toBeNull();
    expect(readBodyClamp(container)).toEqual(expandedBodyStyle);
    expect(within(container).queryByText('展开')).toBeNull();
  });
});
