// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LayerSummarySidebar } from './LayerSummarySidebar.js';

describe('LayerSummarySidebar', () => {
  it('PM1 展示规划链标题与 spec/plan/tasks 顺序', () => {
    render(
      <LayerSummarySidebar
        artifactError={null}
        artifactLoading={false}
        dialoguePreview={{
          recommendedNextStep: '继续拆任务',
          recommendedRole: 'planner',
          rewrittenIntent: '整理项目启动计划',
          sourceIntent: '我要开始做项目',
          summary: '规划摘要',
        }}
        planArtifact={{ content: 'plan-content', title: 'plan-title' }}
        reviewArtifact={null}
        row={{
          detail: 'pm1 detail',
          roleLayer: 'pm1',
          sessionId: 'pm1-session',
          state: 'completed',
        }}
        specArtifact={{ content: 'spec-content', title: 'spec-title' }}
        tasksArtifact={{ content: 'tasks-content', title: 'tasks-title' }}
      />,
    );

    expect(screen.getByText('规划链摘要')).toBeTruthy();
    expect(screen.getByText('本层重点 · 规划完整度')).toBeTruthy();
    expect(screen.getByText('PM1 Planning')).toBeTruthy();
    expect(screen.getByText('规划讨论线索')).toBeTruthy();
    expect(screen.getByText('规划产物链')).toBeTruthy();
    expect(screen.getByText('规划阶段')).toBeTruthy();
    expect(screen.getByText('规划链条中的 spec 产物')).toBeTruthy();
    expect(screen.getByText('规划链条中的 plan 产物')).toBeTruthy();
    expect(screen.getByText('规划链条中的 tasks 产物')).toBeTruthy();
    expect(screen.getAllByText('spec-title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('plan-title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tasks-title').length).toBeGreaterThan(0);
  });

  it('PM2 优先展示评审链文案与 review 产物', () => {
    render(
      <LayerSummarySidebar
        artifactError={null}
        artifactLoading={false}
        dialoguePreview={{
          recommendedNextStep: '退回 PM1 修订',
          recommendedRole: 'pm1',
          rewrittenIntent: '评审当前方案风险',
          sourceIntent: '请做技术评审',
          summary: '评审摘要',
        }}
        planArtifact={{ content: 'plan-content', title: 'plan-title' }}
        reviewArtifact={{ content: 'review-content', title: 'review-title' }}
        row={{
          detail: 'pm2 detail',
          roleLayer: 'pm2',
          sessionId: 'pm2-session',
          state: 'failed',
        }}
        specArtifact={null}
        tasksArtifact={{ content: 'tasks-content', title: 'tasks-title' }}
      />,
    );

    expect(screen.getByText('评审链摘要')).toBeTruthy();
    expect(screen.getByText('本层重点 · 评审结论')).toBeTruthy();
    expect(screen.getByText('PM2 Review')).toBeTruthy();
    expect(screen.getByText('评审判断线索')).toBeTruthy();
    expect(screen.getByText('评审主结论')).toBeTruthy();
    expect(screen.getByText('评审依据')).toBeTruthy();
    expect(screen.getAllByText('评审焦点').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('评审建议')).toBeTruthy();
    expect(screen.getByText('上游交付')).toBeTruthy();
    expect(screen.getByText('接手角色')).toBeTruthy();
    expect(screen.getAllByText('review-title').length).toBeGreaterThan(0);
    expect(screen.getByText('review-content')).toBeTruthy();
    const blocks = screen
      .getAllByText(/本次评审摘要|评审判断线索|评审主结论/)
      .map((node) => node.textContent);
    expect(blocks).toEqual(['本次评审摘要', '评审主结论', '评审判断线索']);
  });

  it('executor 展示执行链标题与执行字段名', () => {
    render(
      <LayerSummarySidebar
        artifactError={null}
        artifactLoading={false}
        dialoguePreview={{
          recommendedNextStep: '继续执行下一步',
          recommendedRole: 'executor',
          rewrittenIntent: '根据任务清单实现功能',
          sourceIntent: '开始写代码',
          summary: '执行摘要',
        }}
        planArtifact={null}
        reviewArtifact={null}
        row={{
          detail: 'executor detail',
          roleLayer: 'executor',
          sessionId: 'executor-session',
          state: 'running',
        }}
        specArtifact={null}
        tasksArtifact={{ content: 'tasks-content', title: 'tasks-title' }}
      />,
    );

    expect(screen.getByText('执行链摘要')).toBeTruthy();
    expect(screen.getByText('本层重点 · 执行过程')).toBeTruthy();
    expect(screen.getByText('Executor Trace')).toBeTruthy();
    expect(screen.getByText('执行过程线索')).toBeTruthy();
    expect(screen.getByText('执行观察')).toBeTruthy();
    expect(screen.getByText('执行任务')).toBeTruthy();
    expect(screen.getAllByText('当前动作').length).toBeGreaterThanOrEqual(1);
    const blocks = screen
      .getAllByText(/执行过程线索|本次执行摘要|执行产物链/)
      .map((node) => node.textContent);
    expect(blocks).toEqual(['本次执行摘要', '执行过程线索', '执行产物链']);
  });
});
