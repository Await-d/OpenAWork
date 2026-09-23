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
