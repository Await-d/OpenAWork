// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamLayerTodoWorkbench } from './TeamLayerTodoWorkbench.js';

afterEach(() => {
  cleanup();
});

const stubLayers = [
  { id: 'L1', code: 'b', name: '接待层', color: 'var(--accent)', state: 'running', live: true },
  { id: 'L2', code: 'e', name: '执行层', color: 'var(--success)', state: 'idle', live: false },
];

const stubRoles = [
  { id: 'R1', name: '规划', state: 'run' as const },
  { id: 'R2', name: '执行', state: 'idle' as const },
];

const stubTodos = [
  {
    id: 'T1',
    key: 'TODO-001',
    title: '初始化架构',
    status: 'running' as const,
    priority: 'high' as const,
    time: '3m',
    sub: '搭建脚手架',
  },
  {
    id: 'T2',
    key: 'TODO-002',
    title: '编写文档',
    status: 'done' as const,
  },
];

describe('TeamLayerTodoWorkbench', () => {
  it('render 任务 tab 并显示 layer rail、role strip、todo 列表', () => {
    const onTabChange = vi.fn();
    const onSelectLayer = vi.fn();
    const onSelectRole = vi.fn();
    const onSelectTodo = vi.fn();
    const onTodoFilterChange = vi.fn();

    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={onTabChange}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={onSelectLayer}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={onSelectRole}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={onTodoFilterChange}
        onSelectTodo={onSelectTodo}
      />,
    );

    // tablist 存在
    expect(screen.getByRole('tablist', { name: '工作台选项卡' })).toBeTruthy();

    // 任务 tab 被选中
    const tasksTab = screen.getByRole('tab', { name: /任务/ });
    expect(tasksTab.getAttribute('aria-selected')).toBe('true');

    // layer rail 展示
    expect(screen.getByRole('navigation', { name: '层列表' })).toBeTruthy();
    expect(screen.getByText('接待层')).toBeTruthy();
    expect(screen.getByText('执行层')).toBeTruthy();

    // role strip 展示
    const roleGroup = screen.getByRole('group', { name: '角色筛选' });
    expect(roleGroup).toBeTruthy();
    expect(roleGroup.textContent).toContain('全部');
    expect(roleGroup.textContent).toContain('规划');

    // todo list 展示
    expect(screen.getByText('TODO-001')).toBeTruthy();
    expect(screen.getByText('初始化架构')).toBeTruthy();
    expect(screen.getByText('TODO-002')).toBeTruthy();
  });

  it('tasks tab 使用左右分栏：列表列在左、明细列在右', () => {
    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId="T1"
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    const listColumn = screen.getByLabelText('任务列表').parentElement;
    const detailColumn = screen.getByLabelText('任务详情').parentElement;
    const split = listColumn?.parentElement;

    // 分栏容器标记存在，且两列同属该容器
    expect(split?.getAttribute('data-team-workbench-split')).toBe('list-detail');
    expect(detailColumn?.parentElement).toBe(split);
    // DOM 顺序 = 视觉顺序：列表列在明细列之前（左右并排）
    expect(listColumn?.nextElementSibling).toBe(detailColumn);
    // 分栏使用列排列（不再用上下行排列）
    expect(split?.getAttribute('style') ?? '').toContain('grid-template-columns');
    expect(split?.getAttribute('style') ?? '').not.toContain('grid-template-rows');
  });

  it('点击主 tab 触发 onTabChange 回调', () => {
    const onTabChange = vi.fn();

    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={onTabChange}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /概览/ }));
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });

  it('任务 tab 渲染 L2 过滤区（层级 / 角色）与 L3 列头筛选行', () => {
    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    // L2 过滤区：层级 / 角色标签 + 层导轨
    const filterZone = document.querySelector('.team-wb-filter-zone');
    expect(filterZone).toBeTruthy();
    expect(screen.getByText('层级')).toBeTruthy();
    expect(screen.getByText('角色')).toBeTruthy();
    expect(filterZone?.querySelector('[aria-label="层列表"]')).toBeTruthy();
    expect(filterZone?.querySelector('[aria-label="角色筛选"]')).toBeTruthy();
    // 层概要降级为过滤区头部的一行弱信息
    expect(screen.getByLabelText('层概要')).toBeTruthy();

    // L3 列头筛选行：任务筛选（列表列）
    const todoFilterRow = document.querySelector('.team-wb-filter-row');
    expect(todoFilterRow?.getAttribute('aria-label')).toBe('任务筛选');

    // 主 tab 导航与过滤区是两套控件语言
    const navTabs = document.querySelectorAll('.team-wb-nav-tab');
    expect(navTabs.length).toBe(4);
  });

  it('点击 layer 按钮触发 onSelectLayer 回调', () => {
    const onSelectLayer = vi.fn();

    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={onSelectLayer}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('执行层'));
    expect(onSelectLayer).toHaveBeenCalledTimes(1);
    expect(onSelectLayer).toHaveBeenCalledWith('L2');
  });

  it('点击 todo 项触发 onSelectTodo 回调', () => {
    const onSelectTodo = vi.fn();

    render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={onSelectTodo}
      />,
    );

    fireEvent.click(screen.getByText('编写文档'));
    expect(onSelectTodo).toHaveBeenCalledTimes(1);
    expect(onSelectTodo).toHaveBeenCalledWith('T2');
  });

  it('切换到非 tasks tab 时渲染对应 slot 占位文案', () => {
    render(
      <TeamLayerTodoWorkbench
        tab="overview"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: /概览/ });
    expect(panel.textContent).toContain('内容接入中');
  });

  it('非 tasks tab 提供 slot 时渲染 slot 内容', () => {
    render(
      <TeamLayerTodoWorkbench
        tab="metrics"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId={null}
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
        metricsSlot={<div>自定义度量内容</div>}
      />,
    );

    expect(screen.getByText('自定义度量内容')).toBeTruthy();
  });

  it('切换选中项时不混用边框简写与长写样式', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L1"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="all"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId="T1"
        todoFilter="all"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    rerender(
      <TeamLayerTodoWorkbench
        tab="tasks"
        onTabChange={vi.fn()}
        layers={stubLayers}
        activeLayerId="L2"
        onSelectLayer={vi.fn()}
        roles={stubRoles}
        activeRoleId="R1"
        onSelectRole={vi.fn()}
        todos={stubTodos}
        activeTodoId="T2"
        todoFilter="done"
        onTodoFilterChange={vi.fn()}
        onSelectTodo={vi.fn()}
      />,
    );

    const styleWarnings = consoleError.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('conflicting property'),
    );
    expect(styleWarnings).toEqual([]);
    consoleError.mockRestore();
  });
});
