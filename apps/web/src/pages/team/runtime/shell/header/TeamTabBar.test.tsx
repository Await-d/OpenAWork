// @vitest-environment jsdom
/**
 * 260531 · TeamTabBar smoke
 *
 * 覆盖统一 tab 栏的核心交互：主 tab / 子 tab 点击回调、3D 办公按钮、
 * badge 渲染、对话主 tab 的子视图（含跨层线程）展示。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamTabBar } from './TeamTabBar.js';

afterEach(() => cleanup());

function renderBar(overrides: Partial<Parameters<typeof TeamTabBar>[0]> = {}) {
  const onPrimaryChange = vi.fn();
  const onMiddleChange = vi.fn();
  const onOfficeClick = vi.fn();
  render(
    <div className="team-v2-root">
      <TeamTabBar
        activePrimary="overview"
        middleTab="dashboard"
        onPrimaryChange={onPrimaryChange}
        onMiddleChange={onMiddleChange}
        unreadCount={0}
        clarificationPending={0}
        showOffice
        officeActive={false}
        onOfficeClick={onOfficeClick}
        {...overrides}
      />
    </div>,
  );
  return { onPrimaryChange, onMiddleChange, onOfficeClick };
}

describe('TeamTabBar', () => {
  it('渲染 5 个主 tab 与 3D 办公按钮', () => {
    renderBar();
    for (const label of ['概览', '对话', '任务', '度量', '治理']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('3D 办公')).toBeTruthy();
  });

  it('点击主 tab 触发 onPrimaryChange', () => {
    const { onPrimaryChange } = renderBar();
    fireEvent.click(screen.getByText('任务'));
    expect(onPrimaryChange).toHaveBeenCalledWith('tasks');
  });

  it('overview 主 tab 显示子 tab（仪表盘/关系图谱/健康度）并可点击', () => {
    const { onMiddleChange } = renderBar();
    expect(screen.getByText('关系图谱')).toBeTruthy();
    fireEvent.click(screen.getByText('健康度'));
    expect(onMiddleChange).toHaveBeenCalledWith('health');
  });

  it('对话主 tab 子视图含「层级」与「当前对话」', () => {
    renderBar({ activePrimary: 'conversation', middleTab: 'conversation' });
    expect(screen.getByText('层级')).toBeTruthy();
    expect(screen.getByText('当前对话')).toBeTruthy();
  });

  it('3D 办公按钮点击触发回调', () => {
    const { onOfficeClick } = renderBar();
    fireEvent.click(screen.getByText('3D 办公'));
    expect(onOfficeClick).toHaveBeenCalledTimes(1);
  });

  it('officeActive 时不显示子 tab 行', () => {
    renderBar({ officeActive: true });
    // office 视图下隐藏子 tab（仪表盘等不应出现）
    expect(screen.queryByText('仪表盘')).toBeNull();
  });

  it('对话主 tab 上渲染未读 badge', () => {
    renderBar({ activePrimary: 'conversation', unreadCount: 3 });
    // badge 同时出现在「对话」主 tab 与「消息」子 tab 上
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  });

  it('showOffice=false 时不渲染 3D 按钮', () => {
    renderBar({ showOffice: false });
    expect(screen.queryByText('3D 办公')).toBeNull();
  });
});

describe('TeamTabBar · variant="single"（方案 G 单行超级栏）', () => {
  function renderSingle(overrides: Partial<Parameters<typeof TeamTabBar>[0]> = {}) {
    const onPrimaryChange = vi.fn();
    const onMiddleChange = vi.fn();
    const onOfficeClick = vi.fn();
    render(
      <div className="team-v2-root">
        <TeamTabBar
          variant="single"
          activePrimary="overview"
          middleTab="dashboard"
          onPrimaryChange={onPrimaryChange}
          onMiddleChange={onMiddleChange}
          unreadCount={0}
          clarificationPending={0}
          showOffice
          officeActive={false}
          onOfficeClick={onOfficeClick}
          leadingSlot={<span>工作区切换器</span>}
          centerSlot={<span>状态栏</span>}
          {...overrides}
        />
      </div>,
    );
    return { onPrimaryChange, onMiddleChange, onOfficeClick };
  }

  it('渲染 leadingSlot / centerSlot 与 5 个主 tab', () => {
    renderSingle();
    expect(screen.getByText('工作区切换器')).toBeTruthy();
    expect(screen.getByText('状态栏')).toBeTruthy();
    // 主 tab 以 role="tab" 渲染（排除隐藏测量行的同名文本）。
    for (const label of ['概览', '对话', '任务', '度量', '治理']) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('子 tab 常驻第二行直接可见（无需点击主 tab）', () => {
    renderSingle();
    // overview 主 tab 激活 → 其子视图「仪表盘/关系图谱/健康度」常驻可见
    expect(screen.getByRole('tab', { name: /关系图谱/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /健康度/ })).toBeTruthy();
  });

  it('点击常驻子 tab 一键切换', () => {
    const { onMiddleChange } = renderSingle();
    fireEvent.click(screen.getByRole('tab', { name: /关系图谱/ }));
    expect(onMiddleChange).toHaveBeenCalledWith('graph');
  });

  it('点击主 tab 直接切换（不再走两步下拉）', () => {
    const { onPrimaryChange } = renderSingle();
    fireEvent.click(screen.getByRole('tab', { name: /任务/ }));
    expect(onPrimaryChange).toHaveBeenCalledWith('tasks');
  });

  it('office 视图下不显示子 tab 行', () => {
    renderSingle({ officeActive: true });
    expect(screen.queryByRole('tab', { name: /关系图谱/ })).toBeNull();
  });
});
