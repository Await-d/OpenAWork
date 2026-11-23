// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { TreeNodesPreview } from './tree-nodes-preview.js';

afterEach(cleanup);

const payload = {
  path: '/repo',
  depth: 2,
  visitedEntries: 3,
  nodes: [
    {
      path: '/repo/src',
      name: 'src',
      type: 'directory',
      children: [{ path: '/repo/src/index.ts', name: 'index.ts', type: 'file', children: [] }],
    },
  ],
};

describe('list 目录预览集成', () => {
  it('残缺 JSON 明确提示无法识别并保留原始内容', () => {
    const text = '{"path":"/repo","nodes":[';
    render(<ToolOutputPreview toolName="list" output={text} />);
    expect(screen.getByText(/目录输出格式不完整或无法识别/)).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
  });
  it('实际 JSON 字符串通过 list 分发显示根路径、计数和深度', () => {
    const { container } = render(
      <ToolOutputPreview toolName="list" output={JSON.stringify(payload)} />,
    );
    expect(screen.getByRole('region', { name: '目录清单' })).toBeTruthy();
    expect(screen.getByText('/repo')).toBeTruthy();
    expect(screen.getByText('已返回 1 个目录 · 1 个文件')).toBeTruthy();
    expect(screen.getByText('已访问 3 个条目')).toBeTruthy();
    expect(screen.getByText(/遍历深度 2/)).toBeTruthy();
    expect(container.querySelector('.list-directory-icon')).toBeTruthy();
  });

  it('原生按钮支持聚焦和展开、折叠，准确同步 aria-expanded', () => {
    render(
      <TreeNodesPreview
        data={{ nodes: [{ name: 'src', type: 'dir', children: [{ name: 'index.ts' }] }] }}
      />,
    );
    const button = screen.getByRole('button', { name: /src/ });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByText('index.ts')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByText('index.ts')).toBeNull();
  });

  it('401 个同级文件首屏只显示 400 行，可通过可聚焦按钮查看最后一项', () => {
    const nodes = Array.from({ length: 401 }, (_, i) => ({ name: `sibling-${i}.ts` }));
    const { container } = render(<TreeNodesPreview data={{ nodes }} />);
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(400);
    expect(screen.queryByText('sibling-400.ts')).toBeNull();
    const button = screen.getByRole('button', { name: /加载更多/ });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.getByText('sibling-400.ts')).toBeTruthy();
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(401);
    expect(screen.queryByRole('button', { name: /加载更多/ })).toBeNull();
  });

  it('嵌套条目可分批加载至末尾，包含后续同级文件', () => {
    const children = Array.from({ length: 801 }, (_, i) => ({ name: `nested-${i}.ts` }));
    const { container } = render(
      <TreeNodesPreview
        defaultExpanded
        data={{ nodes: [{ name: 'src', type: 'dir', children }, { name: 'last.ts' }] }}
      />,
    );
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(400);
    expect(screen.queryByText('nested-399.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多/ }));
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(800);
    expect(screen.getByText('nested-798.ts')).toBeTruthy();
    expect(screen.queryByText('nested-799.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多/ }));
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(803);
    expect(screen.getByText('nested-800.ts')).toBeTruthy();
    expect(screen.getByText('last.ts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /加载更多/ })).toBeNull();
  });

  it('明确返回空 children 的目录显示空目录，未知 children 仍显示未展开', () => {
    render(
      <TreeNodesPreview
        data={{
          nodes: [
            { name: 'empty', type: 'directory', children: [] },
            { name: 'unknown', type: 'directory' },
          ],
        }}
      />,
    );
    expect(screen.getByText('空目录').closest('li')?.textContent).toContain('empty');
    expect(screen.getByText('未展开').closest('li')?.textContent).toContain('unknown');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('嵌套子节点也受 400 行预算约束且折叠后能看到后续条目', () => {
    const children = Array.from({ length: 500 }, (_, i) => ({ name: `file-${i}.ts` }));
    const { container } = render(
      <TreeNodesPreview
        defaultExpanded
        data={{ nodes: [{ name: 'src', type: 'dir', children }, { name: 'last.ts' }] }}
      />,
    );
    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(400);
    expect(screen.getByRole('status').textContent).toContain('400');
    fireEvent.click(screen.getByRole('button', { name: /src/ }));
    expect(screen.getByText('last.ts')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('空清单与服务端截断均保留上下文，不推断空目录', () => {
    render(
      <ToolOutputPreview toolName="list" output={{ ...payload, nodes: [], truncated: true }} />,
    );
    expect(screen.getByText('/repo')).toBeTruthy();
    expect(screen.getByText('（未返回目录条目）')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('清单不完整');
  });

  it.each([undefined, '{"path":"/repo","nodes":[', { error: 'permission denied', nodes: [] }])(
    '缺失、损坏与错误输出保留通用回退 %j',
    (output) => {
      render(<ToolOutputPreview toolName="list" output={output} />);
      expect(screen.queryByRole('region', { name: '目录清单' })).toBeNull();
    },
  );

  it('其他工具不因 nodes 字段被强制转换为目录视图', () => {
    render(<ToolOutputPreview toolName="unknown_tool" output={JSON.stringify(payload)} />);
    expect(screen.queryByRole('region', { name: '目录清单' })).toBeNull();
  });
});
