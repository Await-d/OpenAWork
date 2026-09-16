// @vitest-environment jsdom
/**
 * TeamMultiLayerCardWall 行为约定：
 *   1. 空数据时给引导文案，不渲染空泳道；
 *   2. 泳道按层级深度从上到下排列（reception → pm1 → pm2 → executor → tester → reviewer）；
 *   3. 一个角色实例一张卡片，同层多实例各自成卡（禁止合并）；
 *   4. 上游来源（sourceLayer / sourceDisplayName）必须可见 —— 它是层级对话上下关系的落点；
 *   5. 无上游时标注「顶层入口」；
 *   6. 流式但尚无正文时用角色身份 typing 占位；
 *   7. 折叠态只渲染最新一条消息的**一行纯文本预览**（不进 markdown 管道），
 *      展开后才渲染完整多轮对话，收起可复原为一行；
 *   8. 「全部展开 / 全部收起」批量作用于所有角色实例；
 *   9. 待处理权限按 sessionId 归到对应卡片，可在卡片上直接处置；
 *  10. 非主会话卡片提供「完整会话」入口，主会话卡片不给（用户就在里面）；
 *  11. 展开态按 scopeKey（会话）持久化，重新挂载后还原，跨会话不串味；
 *  12. 稀疏层级（接待层 / 规划层）实例少时并排在同一行，实例变多自动回到整行占位。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type { CardPendingPermission } from './TeamMultiLayerCardWall.js';
import type { LayerMessages } from './team-layer-messages.js';
import { TeamMultiLayerCardWall } from './TeamMultiLayerCardWall.js';

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function makeInstance(
  overrides: Partial<LayerMessages> & Pick<LayerMessages, 'layer'>,
): LayerMessages {
  return {
    messages: [],
    sessionIds: ['session-default'],
    isActive: false,
    ...overrides,
  };
}

function assistantMessage(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content };
}

function pendingPermission(
  overrides: Partial<CardPendingPermission> &
    Pick<CardPendingPermission, 'requestId' | 'sessionId'>,
): CardPendingPermission {
  return {
    status: 'pending',
    toolName: 'Bash',
    reason: '需要执行命令',
    scope: 'bash',
    riskLevel: 'medium',
    ...overrides,
  };
}

/** 今天的某个时刻（毫秒）。用于断言终态时间标签，避免依赖「跨天补 MM-DD」的分支。 */
function todayAt(hours: number, minutes: number): number {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** a 是否排在 b 之前。 */
function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('TeamMultiLayerCardWall', () => {
  it('无数据时展示引导文案', () => {
    render(<TeamMultiLayerCardWall layers={[]} />);

    expect(screen.getByText(/还没有任何角色的对话/)).toBeTruthy();
  });

  it('泳道按层级深度从上到下排列', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'executor', sessionIds: ['s-exec'] }),
          makeInstance({ layer: 'reception', sessionIds: ['s-reception'] }),
          makeInstance({ layer: 'pm1', sessionIds: ['s-pm1'] }),
        ]}
      />,
    );

    const reception = screen.getByLabelText('接待层 的对话窗口');
    const planning = screen.getByLabelText('PM1 规划层 的对话窗口');
    const executor = screen.getByLabelText('执行层 的对话窗口');

    expect(isBefore(reception, planning)).toBe(true);
    expect(isBefore(planning, executor)).toBe(true);
  });

  // ─── 稀疏层级并排：接待层 + 规划层 ───────────────────────────────────
  // 背景：这两层几乎只会有一个角色实例，各占一整行会在墙的顶部留出两片空白。

  it('接待层与规划层实例少时并排在同一行', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'reception', sessionIds: ['s-reception'] }),
          makeInstance({ layer: 'pm1', sessionIds: ['s-pm1'] }),
        ]}
      />,
    );

    const receptionCell = screen.getByLabelText('接待层 的对话窗口').closest('[data-compact-lane]');
    const planningCell = screen
      .getByLabelText('PM1 规划层 的对话窗口')
      .closest('[data-compact-lane]');

    expect(receptionCell).not.toBeNull();
    expect(planningCell).not.toBeNull();
    // 同一行 = 同一个并排容器
    expect(receptionCell?.parentElement).toBe(planningCell?.parentElement);
  });

  it('稀疏层级实例变多时回到整行展示', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'reception', sessionIds: ['s-a'] }),
          makeInstance({ layer: 'reception', sessionIds: ['s-b'] }),
          makeInstance({ layer: 'pm1', sessionIds: ['s-pm1'] }),
          makeInstance({ layer: 'executor', sessionIds: ['s-exec'] }),
        ]}
      />,
    );

    // 接待层有 2 个实例 → 退出并排行，重新占一整行（两张卡片的 aria-label 相同，逐个断言）
    const receptionCards = screen.getAllByLabelText('接待层 的对话窗口');
    expect(receptionCards).toHaveLength(2);
    for (const card of receptionCards) {
      expect(card.closest('[data-compact-lane]')).toBeNull();
    }
    // 执行层不在稀疏层级名单里，始终整行
    expect(screen.getByLabelText('执行层 的对话窗口').closest('[data-compact-lane]')).toBeNull();
    // 规划层仍是唯一的稀疏层 → 保留在并排容器里
    expect(
      screen.getByLabelText('PM1 规划层 的对话窗口').closest('[data-compact-lane]'),
    ).not.toBeNull();
  });

  it('并排后层级顺序不变：接待层仍在规划层之前', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'pm1', sessionIds: ['s-pm1'] }),
          makeInstance({ layer: 'reception', sessionIds: ['s-reception'] }),
        ]}
      />,
    );

    expect(
      isBefore(
        screen.getByLabelText('接待层 的对话窗口'),
        screen.getByLabelText('PM1 规划层 的对话窗口'),
      ),
    ).toBe(true);
  });

  it('同层多个角色实例各自成卡，不合并', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'executor', sessionIds: ['s-a'], displayName: '前端开发者' }),
          makeInstance({ layer: 'executor', sessionIds: ['s-b'], displayName: '后端开发者' }),
        ]}
      />,
    );

    expect(screen.getByLabelText('前端开发者 的对话窗口')).toBeTruthy();
    expect(screen.getByLabelText('后端开发者 的对话窗口')).toBeTruthy();
    expect(screen.getByText('2 个角色')).toBeTruthy();
  });

  it('展示上游角色实例，表达层级对话的上下关系', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            displayName: '前端开发者',
            sourceLayer: 'pm2',
            sourceDisplayName: '后端管控',
          }),
        ]}
      />,
    );

    expect(screen.getByText('上游 管控')).toBeTruthy();
    expect(screen.getByText('后端管控')).toBeTruthy();
  });

  it('没有上游实例时标注为顶层入口', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[makeInstance({ layer: 'reception', sessionIds: ['s-reception'] })]}
      />,
    );

    expect(screen.getByText('顶层入口')).toBeTruthy();
  });

  it('渲染该角色实例自身的消息内容', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'pm1',
            sessionIds: ['s-pm1'],
            messages: [assistantMessage('m-1', '拆成三个子任务')],
          }),
        ]}
      />,
    );

    // 折叠态是一行纯文本预览，不走 markdown 渲染管道
    expect(screen.getByText('拆成三个子任务')).toBeTruthy();
    expect(screen.queryByTestId('md')).toBeNull();
  });

  it('流式但尚无正文时用角色身份 typing 占位', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            streamingMessage: { id: 'stream', role: 'assistant', content: '', status: 'streaming' },
          }),
        ]}
      />,
    );

    expect(screen.getByText('执行 正在思考')).toBeTruthy();
  });

  it('折叠态只渲染最新一条消息', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            messages: [
              assistantMessage('m-1', '第一步：搭骨架'),
              assistantMessage('m-2', '第二步：接接口'),
              assistantMessage('m-3', '第三步：补测试'),
            ],
          }),
        ]}
      />,
    );

    // 折叠态：最新一条压成一行预览，更早的消息不渲染
    expect(screen.getByText('第三步：补测试')).toBeTruthy();
    expect(screen.queryByText('第二步：接接口')).toBeNull();
    expect(screen.queryByTestId('md')).toBeNull();
  });

  it('展开后渲染多轮对话，收起可复原', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            messages: [
              assistantMessage('m-1', '第一步：搭骨架'),
              assistantMessage('m-2', '第二步：接接口'),
              assistantMessage('m-3', '第三步：补测试'),
            ],
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText('展开执行层的对话'));
    expect(screen.getAllByTestId('md').map((node) => node.textContent)).toEqual([
      '第一步：搭骨架',
      '第二步：接接口',
      '第三步：补测试',
    ]);

    fireEvent.click(screen.getByLabelText('收起执行层的对话'));
    expect(screen.queryByTestId('md')).toBeNull();
    expect(screen.getByText('第三步：补测试')).toBeTruthy();
  });

  it('展开态追加渲染流式消息', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'pm1',
            sessionIds: ['s-pm1'],
            messages: [assistantMessage('m-1', '拆成三个子任务')],
            streamingMessage: {
              id: 'stream',
              role: 'assistant',
              content: '正在补充依赖顺序',
              status: 'streaming',
            },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText('展开PM1 规划层的对话'));

    expect(screen.getAllByTestId('md').map((node) => node.textContent)).toEqual([
      '拆成三个子任务',
      '正在补充依赖顺序',
    ]);
  });

  it('「全部展开」批量作用于所有角色实例', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-a'],
            displayName: '前端开发者',
            messages: [assistantMessage('a-1', '前端一'), assistantMessage('a-2', '前端二')],
          }),
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-b'],
            displayName: '后端开发者',
            messages: [assistantMessage('b-1', '后端一'), assistantMessage('b-2', '后端二')],
          }),
        ]}
      />,
    );

    // 折叠态：两张卡片各只留最新一条的一行预览
    expect(screen.queryAllByTestId('md')).toHaveLength(0);

    fireEvent.click(screen.getByText('全部展开'));
    expect(screen.getAllByTestId('md')).toHaveLength(4);

    fireEvent.click(screen.getByText('全部收起'));
    expect(screen.queryAllByTestId('md')).toHaveLength(0);
  });

  it('「主会话所在层」由数据推导，不跟着点选的层级跑', () => {
    render(
      <TeamMultiLayerCardWall
        activeLayer="pm1"
        layers={[
          makeInstance({
            layer: 'pm1',
            sessionIds: ['s-pm1'],
            messages: [assistantMessage('m-1', '拆任务')],
          }),
          makeInstance({ layer: 'executor', sessionIds: ['s-exec'], isActive: true }),
        ]}
      />,
    );

    // 主会话实例在执行层 → 该泳道标「主会话所在层」
    expect(screen.getByText(/第 4 层.*主会话所在层/)).toBeTruthy();
    // pm1 只是被点选聚焦 → 标「已聚焦」，不能冒领「主会话所在层」
    expect(screen.getByText(/第 2 层.*已聚焦/)).toBeTruthy();
    expect(screen.queryByText(/第 2 层.*主会话所在层/)).toBeNull();
  });

  // ─── 生命周期终态：实例关闭 / 结束后这些展示效果必须还在 ──────────────
  // 背景：会话结束后 state_status 就回落到 idle，前端一度把「结束」整个丢掉，
  // 已结束的实例只剩一个「已就绪」的色点，看不出它跑完了还是没开始。

  it('已完成的实例仍保留卡片，并标出结束时间', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            displayName: '前端开发者',
            messages: [assistantMessage('m-1', '三步都做完了')],
            lifecycle: 'completed',
            endedAt: todayAt(14, 5),
          }),
        ]}
      />,
    );

    // 卡片没消失，最近一条消息照常渲染
    expect(screen.getByLabelText('前端开发者 的对话窗口')).toBeTruthy();
    expect(screen.getByText('三步都做完了')).toBeTruthy();
    // 终态标识条：图标 + 标签 + 结束时间
    expect(screen.getByLabelText('已完成')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('· 14:05')).toBeTruthy();
  });

  it('已失败的实例展示失败原因', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'tester',
            sessionIds: ['s-test'],
            messages: [assistantMessage('m-1', '用例跑不通')],
            lifecycle: 'failed',
            endedAt: todayAt(9, 30),
            failureReason: '依赖安装超时',
          }),
        ]}
      />,
    );

    expect(screen.getByLabelText('已失败')).toBeTruthy();
    expect(screen.getByText('依赖安装超时')).toBeTruthy();
  });

  it('已结束的实例不会因为残留流式消息而显示成正在生成', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            messages: [assistantMessage('m-1', '做到第二就停了')],
            // 推送丢失时流式占位会残留 —— 但它已经取消了，绝不能再显示「正在生成」。
            streamingMessage: {
              id: 'stream',
              role: 'assistant',
              content: '继续做第三步',
              status: 'streaming',
            },
            lifecycle: 'cancelled',
            endedAt: todayAt(11, 0),
          }),
        ]}
      />,
    );

    expect(screen.getByLabelText('已取消')).toBeTruthy();
    expect(screen.queryByText(/正在生成/)).toBeNull();
    expect(screen.queryByText('执行 正在思考')).toBeNull();
    // 折叠态回落到最后一条正式消息，而不是那条残留的流式内容
    expect(screen.getByText('做到第二就停了')).toBeTruthy();
    expect(screen.queryByTestId('md')).toBeNull();
  });

  it('终态优先于「当前角色」—— 已结束的实例不再自称活跃', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'reception',
            sessionIds: ['s-reception'],
            isActive: true,
            messages: [assistantMessage('m-1', '交接完成')],
            lifecycle: 'completed',
            endedAt: todayAt(16, 40),
          }),
        ]}
      />,
    );

    expect(screen.getByLabelText('已完成')).toBeTruthy();
    expect(screen.queryByLabelText('当前角色')).toBeNull();
  });

  it('已结束的实例仍可展开查阅完整对话', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            messages: [
              assistantMessage('m-1', '第一步：搭骨架'),
              assistantMessage('m-2', '第二步：接接口'),
            ],
            lifecycle: 'completed',
            endedAt: todayAt(14, 5),
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText('展开执行层的对话'));

    expect(screen.getAllByTestId('md').map((node) => node.textContent)).toEqual([
      '第一步：搭骨架',
      '第二步：接接口',
    ]);
    // 展开后终态标识仍在
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('顶部指标与泳道统计已结束的角色数', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-done'],
            messages: [assistantMessage('m-1', '收工')],
            lifecycle: 'completed',
            endedAt: todayAt(14, 5),
          }),
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-cancel'],
            lifecycle: 'cancelled',
            endedAt: todayAt(14, 8),
          }),
        ]}
      />,
    );

    expect(screen.getByText('2 个已结束')).toBeTruthy();
    expect(screen.getByText(/2 个角色.*2 个已结束/)).toBeTruthy();
  });

  it('非终态实例不出现任何已结束标识', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'pm1',
            sessionIds: ['s-pm1'],
            messages: [assistantMessage('m-1', '正在拆任务')],
            lifecycle: 'running',
          }),
        ]}
      />,
    );

    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.queryByText('已失败')).toBeNull();
    expect(screen.queryByText('已取消')).toBeNull();
    expect(screen.queryByText(/个已结束/)).toBeNull();
  });

  it('当前会话正在本地流式输出时不再判定为终态', () => {
    // 已结束的角色实例照样可以被继续追问 —— 此刻 handoff 还是上一轮的终态记录
    // （新一轮 handoff 要等后端派发才建），但实例实际上已经活了。
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            isActive: true,
            messages: [assistantMessage('m-1', '上一轮做完了')],
            streamingMessage: {
              id: 'stream',
              role: 'assistant',
              content: '新一轮回复',
              status: 'streaming',
            },
            lifecycle: 'completed',
            endedAt: todayAt(14, 5),
          }),
        ]}
      />,
    );

    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.queryByText(/个已结束/)).toBeNull();
    // 正在生成的回复必须照常可见，不能被终态展示藏起来
    expect(screen.getByText('新一轮回复')).toBeTruthy();
  });

  // ─── 卡片内的可操作项：权限处置 / 打开完整会话 ────────────────────────
  // 背景：这些能力原先只在 feed 视图里有，用户想处置一个子角色的权限请求、
  // 或者想看某个角色的完整会话，必须先切回 feed 视图，卡片墙是「只读墙」。
  // 但权限请求是**实例级**的：窗口墙恰好是最该处置它的地方。

  it('待处理权限按 sessionId 归到对应卡片，不重复铺满整面墙', () => {
    const resolveActions = vi.fn(() => ({
      items: [{ id: 'once', label: '允许一次', onClick: () => undefined }],
    }));

    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'reception', sessionIds: ['s-reception'], isActive: true }),
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            displayName: '前端开发者',
            lifecycle: 'running',
          }),
          makeInstance({
            layer: 'tester',
            sessionIds: ['s-test'],
            displayName: '测试工程师',
            lifecycle: 'running',
          }),
        ]}
        pendingPermissions={[
          pendingPermission({ requestId: 'req-exec', sessionId: 's-exec', toolName: 'Write' }),
          pendingPermission({ requestId: 'req-test', sessionId: 's-test', toolName: 'Bash' }),
        ]}
        resolveInlinePermissionActions={resolveActions}
      />,
    );

    const execCard = screen.getByLabelText('前端开发者 的对话窗口');
    const testCard = screen.getByLabelText('测试工程师 的对话窗口');
    const receptionCard = screen.getByLabelText('接待层 的对话窗口');

    expect(within(execCard).getByText('Write')).toBeTruthy();
    expect(within(execCard).queryByText('Bash')).toBeNull();
    expect(within(testCard).getByText('Bash')).toBeTruthy();
    expect(within(testCard).queryByText('Write')).toBeNull();
    // 没有待处理权限的卡片不出现权限条
    expect(within(receptionCard).queryByTestId('inline-permission-quick-bar')).toBeNull();
  });

  it('折叠态照常展示权限条 —— 权限请求不能被 3 行高的消息区裁掉', () => {
    const onClick = vi.fn();
    const resolveActions = vi.fn(() => ({
      items: [{ id: 'once', label: '允许一次', onClick }],
    }));

    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            displayName: '前端开发者',
            messages: [assistantMessage('m-1', '我要写文件了')],
          }),
        ]}
        pendingPermissions={[pendingPermission({ requestId: 'req-1', sessionId: 's-exec' })]}
        resolveInlinePermissionActions={resolveActions}
      />,
    );

    const card = screen.getByLabelText('前端开发者 的对话窗口');
    expect(within(card).getByTestId('inline-permission-quick-bar')).toBeTruthy();
    expect(resolveActions).toHaveBeenCalledWith('req-1');

    fireEvent.click(within(card).getByText('允许一次'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('已处理 / 已批准的历史权限请求不再渲染权限条', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[makeInstance({ layer: 'executor', sessionIds: ['s-exec'] })]}
        pendingPermissions={[
          pendingPermission({ requestId: 'req-1', sessionId: 's-exec', status: 'approved' }),
          pendingPermission({ requestId: 'req-2', sessionId: 's-exec', status: 'rejected' }),
        ]}
        resolveInlinePermissionActions={vi.fn(() => undefined)}
      />,
    );

    expect(screen.queryByTestId('inline-permission-quick-bar')).toBeNull();
  });

  it('不传权限解析器时不渲染权限条（内嵌只读场景）', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[makeInstance({ layer: 'executor', sessionIds: ['s-exec'] })]}
        pendingPermissions={[pendingPermission({ requestId: 'req-1', sessionId: 's-exec' })]}
      />,
    );

    expect(screen.queryByTestId('inline-permission-quick-bar')).toBeNull();
  });

  it('非主会话卡片可打开该角色的完整会话', () => {
    const onOpenSession = vi.fn();

    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'executor', sessionIds: ['s-exec'], displayName: '前端开发者' }),
        ]}
        onOpenSession={onOpenSession}
      />,
    );

    fireEvent.click(screen.getByLabelText('打开前端开发者的完整会话'));
    expect(onOpenSession).toHaveBeenCalledWith('s-exec');
  });

  it('主会话卡片不给「完整会话」入口 —— 用户此刻就在这个会话里', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({
            layer: 'executor',
            sessionIds: ['s-exec'],
            displayName: '前端开发者',
            isActive: true,
          }),
        ]}
        onOpenSession={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('打开前端开发者的完整会话')).toBeNull();
  });

  it('不传打开回调时不渲染「完整会话」入口', () => {
    render(
      <TeamMultiLayerCardWall
        layers={[
          makeInstance({ layer: 'executor', sessionIds: ['s-exec'], displayName: '前端开发者' }),
        ]}
      />,
    );

    expect(screen.queryByLabelText('打开前端开发者的完整会话')).toBeNull();
  });

  // ─── 展开态持久化 ────────────────────────────────────────────────────

  it('展开态按 scopeKey 持久化，重新挂载后仍保持', () => {
    const layers = [
      makeInstance({
        layer: 'executor',
        sessionIds: ['s-exec'],
        messages: [assistantMessage('m-1', '第一步'), assistantMessage('m-2', '第二步')],
      }),
    ];

    const first = render(<TeamMultiLayerCardWall layers={layers} scopeKey="s-1" />);
    expect(screen.queryAllByTestId('md')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('展开执行层的对话'));
    expect(screen.getAllByTestId('md')).toHaveLength(2);
    first.unmount();

    // 重新挂载（等价于刷新后重建面板）：展开态被还原，而不是全部折回折叠态
    render(<TeamMultiLayerCardWall layers={layers} scopeKey="s-1" />);
    expect(screen.getAllByTestId('md')).toHaveLength(2);
    cleanup();

    // 换一个会话不继承上一个会话的展开态
    render(<TeamMultiLayerCardWall layers={layers} scopeKey="s-2" />);
    expect(screen.queryAllByTestId('md')).toHaveLength(0);
  });

  it('不传 scopeKey 时不落盘 —— 内嵌 / 只读场景不污染 localStorage', () => {
    const layers = [
      makeInstance({
        layer: 'executor',
        sessionIds: ['s-exec'],
        messages: [assistantMessage('m-1', '第一步'), assistantMessage('m-2', '第二步')],
      }),
    ];

    render(<TeamMultiLayerCardWall layers={layers} />);
    fireEvent.click(screen.getByLabelText('展开执行层的对话'));

    expect(window.localStorage.length).toBe(0);
  });
});
