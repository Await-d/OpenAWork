import { describe, expect, it } from 'vitest';
import {
  naturalLanguageSummary,
  resolveBackgroundTaskReadInfo,
} from './natural-language-summary.js';

describe('naturalLanguageSummary — background_output', () => {
  it('任务已完成（任务结果模板）时带出任务名与完成态', () => {
    const output = [
      '任务结果',
      '',
      '任务 ID：T-1790128097917-1be633',
      '描述：国际时事最新新闻',
      'Agent：scout',
      '耗时：1m 10s',
      '',
      '---',
      '',
      '正文…',
    ].join('\n');

    expect(naturalLanguageSummary('background_output', { task_id: 'T-1' }, output)).toBe(
      '已读取了后台输出 · 国际时事最新新闻（已完成）',
    );
  });

  it('任务仍在运行（任务状态表格模板）时带出任务名与运行态', () => {
    const output = [
      '# 任务状态',
      '',
      '| 字段 | 值 |',
      '|-------|-------|',
      '| 任务 ID | `T-1790128098049-a086a4` |',
      '| 描述 | 科技AI最新新闻 |',
      '| Agent | scout |',
      '| 状态 | **running** |',
    ].join('\n');

    expect(naturalLanguageSummary('background_output', { task_id: 'T-2' }, output)).toBe(
      '已读取了后台输出 · 科技AI最新新闻（运行中）',
    );
  });

  it('状态表格里的其它终态映射为中文标签', () => {
    const buildStatus = (status: string) =>
      ['# 任务状态', '', '| 描述 | 体育最新新闻 |', `| 状态 | **${status}** |`].join('\n');

    expect(resolveBackgroundTaskReadInfo(buildStatus('failed')).state).toBe('已失败');
    expect(resolveBackgroundTaskReadInfo(buildStatus('cancelled')).state).toBe('已取消');
    expect(resolveBackgroundTaskReadInfo(buildStatus('pending')).state).toBe('排队中');
  });

  it('输出是 JSON 包裹（message 字段）时同样能解析', () => {
    const output = { message: '任务结果\n\n描述：中国国内最新新闻\n', status: 'done' };

    expect(resolveBackgroundTaskReadInfo(output)).toEqual({
      label: '中国国内最新新闻',
      state: '已完成',
    });
  });

  it('解析不到任务名/状态时保持旧文案（不猜归属）', () => {
    expect(naturalLanguageSummary('background_output', { task_id: 'T-3' })).toBe(
      '已读取了后台输出',
    );
    expect(naturalLanguageSummary('background_output', { task_id: 'T-3' }, '任务结果\n')).toBe(
      '已读取了后台输出（已完成）',
    );
  });
});

describe('naturalLanguageSummary — read（查看类工具）', () => {
  it('带出文件路径与精确行区间（优先输出里的 lineStart/lineEnd）', () => {
    expect(
      naturalLanguageSummary(
        'read',
        { filePath: 'src/a.ts', offset: 1, limit: 200 },
        { path: 'src/a.ts', content: 'x', lineStart: 12, lineEnd: 61, totalLines: 240 },
      ),
    ).toBe('已查看了 src/a.ts:12-61');
  });

  it('运行中（无输出）用 offset/limit 估算行区间', () => {
    expect(naturalLanguageSummary('read', { filePath: 'src/a.ts', offset: 20, limit: 10 })).toBe(
      '已查看了 src/a.ts:20-29',
    );
  });

  it('没有偏移信息时只给路径', () => {
    expect(naturalLanguageSummary('read', { path: 'src/a.ts' })).toBe('已查看了 src/a.ts');
  });
});

describe('naturalLanguageSummary — list（目录工具）', () => {
  it('带出目录路径与条目数', () => {
    expect(
      naturalLanguageSummary(
        'list',
        { path: '/workspace/apps/web' },
        { path: '/workspace/apps/web', visitedEntries: 42 },
      ),
    ).toBe('已列举了目录 /workspace/apps/web（42 项）');
  });

  it('运行中（无输出）只给路径', () => {
    expect(naturalLanguageSummary('list', { path: '/workspace/apps/web' })).toBe(
      '已列举了目录 /workspace/apps/web',
    );
  });
});

describe('naturalLanguageSummary — read 命中目录', () => {
  it('目录清单形态不带行区间（行号对目录没有意义）', () => {
    expect(
      naturalLanguageSummary(
        'read',
        { filePath: '/workspace/apps/web/src' },
        {
          path: '/workspace/apps/web/src',
          content: 'dir components\ndir pages\nfile App.tsx',
          lineStart: 1,
          lineEnd: 3,
          totalLines: 3,
        },
      ),
    ).toBe('已查看了 /workspace/apps/web/src');
  });
});

describe('naturalLanguageSummary — 目录/文件创建与还原', () => {
  it('创建目录带出路径', () => {
    expect(
      naturalLanguageSummary('workspace_create_directory', {
        path: '/workspace/OpenAWork/tmp/fixtures',
      }),
    ).toBe('已创建了目录 /workspace/OpenAWork/tmp/fixtures');
  });

  it('还原文件带出路径（输出回退）', () => {
    expect(
      naturalLanguageSummary(
        'workspace_review_revert',
        {},
        { path: '/workspace/OpenAWork/src/a.ts', reverted: true },
      ),
    ).toBe('已还原了文件 /workspace/OpenAWork/src/a.ts');
  });
});

describe('naturalLanguageSummary — question（提问工具）', () => {
  it('带出提问数量', () => {
    expect(
      naturalLanguageSummary('askuserquestion', {
        questions: [{ question: '用哪个包管理器？' }, { question: '要不要跑测试？' }],
      }),
    ).toBe('已向用户提问（2 题）');
  });

  it('没有题目数组时退化为通用文案', () => {
    expect(naturalLanguageSummary('question', {})).toBe('已向用户提问');
  });
});

describe('naturalLanguageSummary — read 展开态省略路径', () => {
  it('omitPath=true 时只给动作（路径由预览 meta 承载）', () => {
    expect(
      naturalLanguageSummary(
        'read',
        { filePath: 'src/a.ts', offset: 1, limit: 100 },
        { path: 'src/a.ts', content: 'x', lineStart: 1, lineEnd: 100, totalLines: 240 },
        { omitPath: true },
      ),
    ).toBe('已查看了文件');
  });
});
