// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamSessionHeader } from './TeamSessionHeader.js';

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe('TeamSessionHeader', () => {
  it('展示团队来源 / provider / 核心角色与层级提示', () => {
    render(
      <TeamSessionHeader
        roleLayer="pm2"
        substate="dispatching"
        stateStatus="running"
        sessionMetadata={{
          teamDefinition: {
            source: {
              kind: 'builtin-template',
              templateName: '代码审查流水线',
            },
            defaultProvider: 'openai',
            requiredRoleBindings: [
              { role: 'planner', agentLabel: 'Prometheus' },
              { role: 'executor', agentLabel: 'Hephaestus' },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText('PM2 管控层 (d)')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('📤 已派发给规划层')).toBeTruthy();
    expect(screen.getByText('来源 · 内置模板 · 代码审查流水线')).toBeTruthy();
    expect(screen.getByText('模型 · openai')).toBeTruthy();
    expect(screen.getByText('规划师')).toBeTruthy();
    expect(screen.getByText('Prometheus')).toBeTruthy();
    expect(screen.getByText('执行者')).toBeTruthy();
    expect(screen.getByText('Hephaestus')).toBeTruthy();
    expect(screen.getByText('提示：可切到“任务与产物”查看当前派发包。')).toBeTruthy();
  });

  it('无团队配置时仍会展示状态相关的操作提示', () => {
    render(
      <TeamSessionHeader
        roleLayer="executor"
        substate={null}
        stateStatus="paused"
        sessionMetadata={null}
      />,
    );

    expect(screen.getByText('执行层 (e)')).toBeTruthy();
    expect(screen.getByText('已暂停')).toBeTruthy();
    expect(screen.getByText('提示：恢复运行树后，本层会从当前状态继续。')).toBeTruthy();
    expect(screen.queryByText(/来源 ·/)).toBeNull();
    expect(screen.queryByText(/模型 ·/)).toBeNull();
  });
});
