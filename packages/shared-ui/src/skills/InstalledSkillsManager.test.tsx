// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstalledSkillsManager, type MarketInstalledSkill } from '../index.js';

const skill = (patch: Partial<MarketInstalledSkill> = {}): MarketInstalledSkill => ({
  id: 'github:acme/foo-skill/foo',
  name: 'Foo Skill',
  version: '0.2.0',
  latestVersion: '0.2.0',
  source: 'github:acme/foo-skill',
  enabled: true,
  ...patch,
});

function renderManager(overrides: Partial<Parameters<typeof InstalledSkillsManager>[0]> = {}) {
  const props = {
    skills: [skill()],
    onUninstall: vi.fn(),
    onUpdate: vi.fn(),
    onCheckUpdates: vi.fn(),
    ...overrides,
  };
  const view = render(<InstalledSkillsManager {...props} />);
  return { ...props, view };
}

afterEach(cleanup);

describe('InstalledSkillsManager', () => {
  it('渲染名称 / 版本 / 来源与计数摘要', () => {
    renderManager({
      skills: [
        skill(),
        skill({
          id: 'github:acme/bar/bar',
          name: 'Bar',
          source: 'github:acme/bar',
          version: '0.2.1',
          latestVersion: '0.3.0',
        }),
        skill({
          id: 'local-system:/home/a/.claude/skills/local',
          name: 'Local',
          source: 'local-system:/home/a/.claude/skills',
          version: '1.0.0',
          latestVersion: '1.0.0',
        }),
      ],
    });

    expect(screen.getByText('Foo Skill')).toBeTruthy();
    expect(screen.getByText('github:acme/foo-skill/foo')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('github:acme/foo-skill')).toBeTruthy();
    expect(screen.getAllByText('v1.0.0').length).toBe(1);
    expect(screen.getByText('3 个')).toBeTruthy();
    expect(screen.getByText(/1 个可更新/)).toBeTruthy();
  });

  it('仅有更新时才渲染「更新」按钮，点击回传技能 id', () => {
    const { onUpdate } = renderManager({
      skills: [skill(), skill({ id: 'github:acme/bar/bar', name: 'Bar', latestVersion: '0.9.0' })],
    });

    const updateButtons = screen.getAllByText('更新');
    expect(updateButtons.length).toBe(1);
    fireEvent.click(updateButtons[0]!);
    expect(onUpdate).toHaveBeenCalledWith('github:acme/bar/bar');
    expect(screen.getByText('→ v0.9.0')).toBeTruthy();
  });

  it('开关按下一态回传（switch 语义 + aria-checked）', () => {
    const onToggle = vi.fn();
    renderManager({ onToggle });

    const toggle = screen.getByRole('switch', { name: '禁用 Foo Skill' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('github:acme/foo-skill/foo', false);
  });

  it('toggleDisabledReason 命中时降级为只读徽章', () => {
    renderManager({
      onToggle: vi.fn(),
      toggleDisabledReason: () => '系统预装技能，不允许禁用',
    });

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('已启用')).toBeTruthy();
  });

  it('预装技能移除需要二次确认', () => {
    const { onUninstall } = renderManager({ skills: [skill({ preinstalled: true })] });

    fireEvent.click(screen.getByText('移除（需确认）'));
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('确认移除'));
    expect(onUninstall).toHaveBeenCalledWith('github:acme/foo-skill/foo');
  });

  it('检查更新按钮回传回调；空列表渲染空态', () => {
    const { onCheckUpdates } = renderManager({ skills: [] });
    expect(screen.getByText('暂无已安装技能。')).toBeTruthy();
    fireEvent.click(screen.getByText('检查更新'));
    expect(onCheckUpdates).toHaveBeenCalledTimes(1);
  });
});
