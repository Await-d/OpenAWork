import { describe, expect, it } from 'vitest';
import {
  buildOfficeProjectionPages,
  OFFICE_PROJECTION_PAGE_COUNT,
  type OfficeCanvasDisplayData,
} from './office-canvas-textures.js';

function buildData(): OfficeCanvasDisplayData {
  return {
    topSummary: {
      title: 'AILinkMarket 团队工作空间',
      memberCount: '4 成员',
      onlineCount: '3 在线',
      status: '运行中',
    },
    metricCards: [
      { icon: 'members', label: '成员', value: '4' },
      { icon: 'tasks', label: '任务', value: '3/8' },
      { icon: 'conversation', label: '汇报', value: '12' },
    ],
    footerStats: [
      { label: '总', value: '6' },
      { label: '运行', value: '3' },
      { label: '等待', value: '2' },
      { label: '异常', value: '1' },
    ],
    officeAgents: [
      { id: 'planner', label: '[L] PM1', status: 'discussing' },
      { id: 'pm2', label: 'PM2', status: 'working' },
      { id: 'executor', label: 'Executor', status: 'working' },
      { id: 'reviewer', label: 'Reviewer', status: 'resting' },
    ],
    activityStats: {
      assistant_message: 5,
      read: 7,
      task_complete: 2,
      tool_use: 9,
      write: 3,
    },
    elapsed: 42,
  };
}

describe('buildOfficeProjectionPages', () => {
  it('生成固定数量的真实运行态投影页', () => {
    const pages = buildOfficeProjectionPages(buildData());
    expect(pages).toHaveLength(OFFICE_PROJECTION_PAGE_COUNT);
    expect(pages.map((page) => page.title)).toEqual([
      '运行总览',
      '角色状态',
      '任务与汇报',
      '事件热度',
    ]);
  });

  it('把 runtime 数据映射到页面文本和柱状条', () => {
    const pages = buildOfficeProjectionPages(buildData());

    expect(pages[0]?.lines).toEqual(
      expect.arrayContaining(['状态：运行中', '成员：4 成员 / 3 在线', '运行：3']),
    );
    expect(pages[1]?.lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining('PM1'),
        expect.stringContaining('讨论中'),
        expect.stringContaining('工作中'),
      ]),
    );
    expect(pages[2]?.subtitle).toContain('任务 3/8');
    expect(pages[3]?.lines).toEqual(expect.arrayContaining(['工具：9', '读取：7']));
  });

  it('没有活动事件时会落到等待文案，而不是随机占位', () => {
    const pages = buildOfficeProjectionPages({
      ...buildData(),
      activityStats: {},
      officeAgents: [],
    });

    expect(pages[1]?.lines).toEqual(['暂无角色状态数据']);
    expect(pages[3]?.subtitle).toBe('等待新的团队运行事件');
    expect(pages[3]?.lines).toEqual(['当前还没有新的活动事件进入时间线。']);
  });
});
