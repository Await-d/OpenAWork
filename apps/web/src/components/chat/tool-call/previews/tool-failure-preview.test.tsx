// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolFailurePreview } from './tool-failure-preview.js';

/** 逐字取自真实 audit_logs 的 agentignore 拦截样本（见 `tool-failure-view.test.ts`）。 */
const AGENTIGNORE_DENIAL =
  'Access denied: file "/home/await/project/OpenAWork/.omo/ime-guard-apply.ts" is protected by agentignore rules. 该类路径受 agentignore 保护(常见受保护模式:`.env` / `.env.*`、`*.pem` / `*.key` / `id_rsa*`、`.aws/credentials`、`*.sqlite` / `*.db`、`node_modules/**`、`.git/**` 等)。请勿重复尝试读取或写入;如需其中的值,请让用户显式提供,或改读不含敏感值的等价文件(如 `.env.example`)。';

const ENOENT =
  "ENOENT: no such file or directory, stat '/home/await/project/OpenAWork/apps/web/src/components/permissions/PermissionPrompt.tsx'";

const UNKNOWN_FAILURE = '写文件时发生了未知问题\n    at writeFile (fs.ts:1:1)';

afterEach(cleanup);

describe('ToolFailurePreview · 结构化失败卡', () => {
  it('标题行给出分类标签 + 一句话结论', () => {
    render(<ToolFailurePreview output={AGENTIGNORE_DENIAL} />);
    expect(screen.getByText('写入被拒绝')).toBeTruthy();
    expect(screen.getByText('agentignore 保护路径')).toBeTruthy();
  });

  it('字段区渲染「路径 / 原因 / 建议」，路径用等宽 code 承载', () => {
    const { container } = render(<ToolFailurePreview output={AGENTIGNORE_DENIAL} />);
    const labels = [...container.querySelectorAll('.tool-failure-field dt')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['路径', '原因', '建议']);

    const pathCode = container.querySelector('.tool-failure-field code');
    expect(pathCode?.textContent).toBe('/home/await/project/OpenAWork/.omo/ime-guard-apply.ts');
    // 「建议」不是精确值，不能也塞进 code（否则整段中文变成等宽）。
    expect(container.querySelectorAll('.tool-failure-field code')).toHaveLength(1);
    expect(container.querySelector('[data-field="suggestion"]')?.textContent).toContain(
      '请勿重复尝试读取或写入',
    );
  });

  it('errno 形态渲染错误码 / 详情 / 操作 / 路径', () => {
    const { container } = render(<ToolFailurePreview output={ENOENT} />);
    expect(screen.getByText('系统错误')).toBeTruthy();
    expect(screen.getByText('文件或目录不存在')).toBeTruthy();
    const labels = [...container.querySelectorAll('.tool-failure-field dt')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['错误码', '详情', '操作', '路径']);
  });

  it('结构化卡片提供「复制错误详情」按钮', () => {
    render(<ToolFailurePreview output={AGENTIGNORE_DENIAL} />);
    expect(screen.getByRole('button', { name: '复制完整内容' })).toBeTruthy();
  });

  it('原始输出入口始终存在，且内容是逐字原文（信息不丢）', () => {
    const { container } = render(<ToolFailurePreview output={AGENTIGNORE_DENIAL} />);
    expect(screen.getByText('原始输出')).toBeTruthy();
    expect(container.querySelector('.tool-failure-raw-body')?.textContent).toBe(AGENTIGNORE_DENIAL);
  });

  it('data-failure-* 属性把分类暴露给样式与排查', () => {
    const { container } = render(<ToolFailurePreview output={AGENTIGNORE_DENIAL} />);
    const card = container.querySelector('.tool-failure-card');
    expect(card?.getAttribute('data-failure-kind')).toBe('structured');
    expect(card?.getAttribute('data-failure-category')).toBe('permission');
  });
});

describe('ToolFailurePreview · 纯文本回退', () => {
  it('认不出形态时只渲染标题行 + 原始输出，不硬凑字段', () => {
    const { container } = render(<ToolFailurePreview output={UNKNOWN_FAILURE} />);
    expect(screen.getByText('写文件时发生了未知问题')).toBeTruthy();
    expect(container.querySelectorAll('.tool-failure-field')).toHaveLength(0);
    // plain 视图不提供复制按钮：原文本来就只有一段，直接看「原始输出」即可。
    expect(screen.queryByRole('button', { name: '复制完整内容' })).toBeNull();
    expect(container.querySelector('.tool-failure-raw-body')?.textContent).toBe(UNKNOWN_FAILURE);
  });

  it('isError 为假时什么都不渲染', () => {
    const { container } = render(<ToolFailurePreview output={UNKNOWN_FAILURE} isError={false} />);
    expect(container.innerHTML).toBe('');
  });
});
