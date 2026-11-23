import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchedulesSessionPicker } from './schedules-session-picker.js';
import type { SessionOption } from './use-session-options.js';

const SESSIONS: SessionOption[] = [
  { id: 'sess-1', title: '排期讨论', updatedAt: 1_700_000_000_000 },
  { id: 'sess-2', title: '网关排查', updatedAt: 1_600_000_000_000 },
];

function renderPicker(overrides: Partial<Parameters<typeof SchedulesSessionPicker>[0]> = {}) {
  const props = {
    jobName: '每日同步',
    sessions: SESSIONS,
    loading: false,
    error: null,
    busy: false,
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<SchedulesSessionPicker {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SchedulesSessionPicker', () => {
  it('列出会话并把任务名写进说明，点击即回传会话 id', () => {
    const props = renderPicker();

    expect(screen.getByText('投递到哪个会话？')).toBeTruthy();
    expect(screen.getByText(/「每日同步」执行完成后/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /排期讨论/ }));

    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('sess-1');
  });

  it('搜索按标题与 id 双向过滤', () => {
    renderPicker();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '网关' },
    });

    expect(screen.queryByRole('button', { name: /排期讨论/ })).toBeNull();
    expect(screen.getByRole('button', { name: /网关排查/ })).toBeTruthy();
  });

  it('没有匹配项时给出去重提示', () => {
    renderPicker();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '不存在的会话' },
    });

    expect(screen.getByText('没有匹配的会话。')).toBeTruthy();
  });

  it('一个会话都没有时引导先去新建', () => {
    renderPicker({ sessions: [] });

    expect(screen.getByText('还没有任何会话，先新建一个再回来。')).toBeTruthy();
  });

  it('加载中显示占位，失败时显示错误而不是空列表', () => {
    renderPicker({ loading: true, sessions: [] });
    expect(screen.getByText('正在读取会话…')).toBeTruthy();
    cleanup();

    renderPicker({ error: '网络异常，读取会话失败。' });
    // DialogError 会加「操作失败：」前缀，因此用子串匹配。
    expect(screen.getByRole('alert').textContent).toContain('网络异常，读取会话失败。');
    expect(screen.queryByText('没有匹配的会话。')).toBeNull();
  });

  it('忙碌时禁止再次选择', () => {
    const props = renderPicker({ busy: true });

    fireEvent.click(screen.getByRole('button', { name: /排期讨论/ }));

    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
