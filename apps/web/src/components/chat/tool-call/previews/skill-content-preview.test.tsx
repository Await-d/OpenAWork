// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSkillContent, SkillContentPreview } from './skill-content-preview.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.restoreAllMocks();
});

describe('Skill 文档与资源', () => {
  it('空正文如实展示且没有虚构资源或描述', () => {
    const data = extractSkillContent('<skill_content name="empty"></skill_content>');
    if (!data) throw new Error('应识别有名称的空内容');
    render(<SkillContentPreview data={data} />);
    expect(screen.getByText('（无内容）')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '技能资源' })).toBeNull();
  });
  it('分离 Markdown 与资源并单独复制路径', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const data = extractSkillContent(
      '<skill_content name="design"># 指南\n\n**重点**\n<skill_files>\n<file>docs/a.md</file>\n<file>scripts/b.ts</file>\n</skill_files></skill_content>',
    );
    expect(data?.files).toEqual(['docs/a.md', 'scripts/b.ts']);
    if (!data) throw new Error('应识别完整技能内容');
    render(<SkillContentPreview data={data} />);
    expect(screen.getByRole('heading', { name: '指南' })).toBeTruthy();
    expect(screen.getByText('重点').tagName).toBe('STRONG');
    fireEvent.click(screen.getByTitle('复制资源路径 docs/a.md'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('docs/a.md'));
    vi.unstubAllGlobals();
  });

  it.each([
    '<skill_content name="x">不完整',
    '诊断\n<skill_content name="x">正文</skill_content>',
    '<skill_content name="x">正文\n<skill_files><file>a</file></skill_content>',
  ])('不完整或混合输出保留回退 %s', (text) => {
    expect(extractSkillContent(text)).toBeNull();
  });

  it('HTML 不执行，危险链接没有可执行地址', () => {
    const data = extractSkillContent(
      '<skill_content name="x"><script>alert(1)</script>\n\n[危险](javascript:alert)\n\n# 安全</skill_content>',
    );
    if (!data) throw new Error('应识别完整技能内容');
    const { container } = render(<SkillContentPreview data={data} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).not.toMatch(/^javascript:/);
  });

  it('长正文可展开全文且保留原始输出', () => {
    const text = '正文\n'.repeat(2100) + '文末';
    const data = extractSkillContent(`<skill_content name="x">${text}</skill_content>`);
    if (!data) throw new Error('应识别完整技能内容');
    render(<SkillContentPreview data={data} />);
    expect(screen.queryByText(/文末/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开技能全文' }));
    expect(screen.getByText(/文末/)).toBeTruthy();
    fireEvent.click(screen.getByText('原始输出'));
    expect(screen.getByText(/<skill_content name="x">/)).toBeTruthy();
  });
});
