// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowTemplateRecord, WorkflowTemplateScale } from '@openAwork/web-client';
import { TemplateDetailView } from './TemplateDetailView.js';

function createTemplate(): WorkflowTemplateRecord {
  return {
    id: 'tpl-1',
    name: '示例模板',
    description: '示例描述',
    category: 'team-playbook',
    metadata: {
      teamTemplate: {
        defaultProvider: 'openai',
        optionalAgentIds: [],
        recommendedFor: '新需求快速立项',
        templateFocus: '代码评审',
        templateScale: 'medium' as WorkflowTemplateScale,
      },
    },
    nodes: [
      {
        id: 'node-reviewer',
        type: 'subagent',
        label: '评审 · Reviewer',
      },
    ],
    edges: [],
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
  };
}

describe('TemplateDetailView', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('内联字段保存失败时保留编辑态并显示错误', async () => {
    const onUpdate = vi.fn(async () => false);

    render(
      <TemplateDetailView
        template={createTemplate()}
        rawTemplate={createTemplate()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getAllByTitle('点击编辑')[0]!);

    const input = screen.getByDisplayValue('示例模板');
    fireEvent.change(input, { target: { value: '新的模板名' } });
    fireEvent.click(screen.getByRole('button', { name: '✓' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ name: '新的模板名' });
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('保存失败，请重试。');
    });
    expect(screen.getByDisplayValue('新的模板名')).toBeTruthy();
  });

  it('内联字段保存成功后退出编辑态', async () => {
    const onUpdate = vi.fn(async () => true);

    render(
      <TemplateDetailView
        template={createTemplate()}
        rawTemplate={createTemplate()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getAllByTitle('点击编辑')[0]!);

    const input = screen.getByDisplayValue('示例模板');
    fireEvent.change(input, { target: { value: '新的模板名' } });
    fireEvent.click(screen.getByRole('button', { name: '✓' }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue('新的模板名')).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('editable=false 时不暴露编辑入口，头部动作全部禁用', () => {
    render(
      <TemplateDetailView
        editable={false}
        template={createTemplate()}
        rawTemplate={createTemplate()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: /复制/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /删除/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /编辑/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryAllByTitle('点击编辑')).toHaveLength(0);
    expect(screen.queryByDisplayValue('示例模板')).toBeNull();
  });
});
