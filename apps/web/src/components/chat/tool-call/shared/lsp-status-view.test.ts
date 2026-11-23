import { describe, expect, it } from 'vitest';

import { buildLspStatusView } from './lsp-status-view.js';

/** 形状对齐 `packages/lsp-client/src/types.ts` 的 LSPServerStatus / LSPMissingServer。 */
const OUTPUT = {
  servers: [
    {
      id: 'typescript',
      root: '/workspace/OpenAWork',
      running: true,
      fileCount: 12,
      diagnosticCount: 3,
    },
    { id: 'eslint', root: '/workspace/OpenAWork', running: true, fileCount: 4, diagnosticCount: 0 },
  ],
  missing: [
    {
      id: 'typescript',
      extensions: ['.ts', '.tsx'],
      binary: 'typescript-language-server',
      installCommand: 'npm i -g typescript-language-server',
      installed: true,
    },
    {
      id: 'gopls',
      extensions: ['.go'],
      binary: 'gopls',
      installCommand: 'go install golang.org/x/tools/gopls@latest',
      installed: false,
    },
  ],
};

describe('buildLspStatusView', () => {
  it('分成「运行中」与「可用的语言服务」两组', () => {
    const view = buildLspStatusView(OUTPUT);

    expect(view?.groups?.map((group) => group.label)).toEqual(['运行中', '可用的语言服务']);
    expect(view?.groups?.[0]?.rows).toHaveLength(2);
    expect(view?.groups?.[1]?.rows).toHaveLength(2);
  });

  it('运行中的服务带 root / 文件数 / 诊断数，0 条诊断不占位', () => {
    const rows = buildLspStatusView(OUTPUT)?.groups?.[0]?.rows ?? [];

    expect(rows[0]?.title).toBe('typescript');
    expect(rows[0]?.badges?.[0]).toEqual({ label: '运行中', tone: 'ok' });
    expect(rows[0]?.meta).toEqual(['/workspace/OpenAWork', '12 个文件', '3 条诊断']);
    // eslint 那条 diagnosticCount 为 0，不该出现「0 条诊断」
    expect(rows[1]?.meta).toEqual(['/workspace/OpenAWork', '4 个文件']);
  });

  it('未安装的服务把安装命令放进描述位（那才是用户要拿走的东西）', () => {
    const rows = buildLspStatusView(OUTPUT)?.groups?.[1]?.rows ?? [];
    const gopls = rows.find((row) => row.title === 'gopls');

    expect(gopls?.badges?.[0]).toEqual({ label: '未安装', tone: 'warn' });
    expect(gopls?.description).toBe('go install golang.org/x/tools/gopls@latest');
    expect(gopls?.meta).toEqual(['.go', 'gopls']);
  });

  it('已安装的服务不再展示安装命令（那是已完成的操作指引）', () => {
    const rows = buildLspStatusView(OUTPUT)?.groups?.[1]?.rows ?? [];
    const typescript = rows.find((row) => row.title === 'typescript');

    expect(typescript?.badges?.[0]).toEqual({ label: '已安装', tone: 'ok' });
    expect(typescript?.description).toBeUndefined();
  });

  it('头部说明还有几个没装', () => {
    expect(buildLspStatusView(OUTPUT)?.note).toBe('1 个尚未安装');
  });

  it('binary 支持候选列表', () => {
    const view = buildLspStatusView({
      servers: [],
      missing: [{ id: 'vue', binary: ['vue-language-server', 'vls'], installed: false }],
    });

    expect(view?.groups?.[0]?.rows[0]?.meta).toEqual(['vue-language-server / vls']);
  });

  it('没有 servers 字段时只渲染可安装项', () => {
    const view = buildLspStatusView({
      missing: [{ id: 'rust-analyzer', extensions: ['.rs'], installed: false }],
    });

    expect(view?.groups?.map((group) => group.label)).toEqual(['可用的语言服务']);
  });

  it('两个数组都空时明确说明，而不是渲染一片空白', () => {
    const view = buildLspStatusView({ servers: [], missing: [] });

    expect(view?.groups?.[0]?.rows).toHaveLength(0);
    expect(view?.note).toBe('当前没有 LSP 服务在运行');
  });

  it('不是 lsp_status 的输出时返回 null', () => {
    expect(buildLspStatusView({ foo: 'bar' })).toBeNull();
    expect(buildLspStatusView({ servers: 'x' })).toBeNull();
    expect(buildLspStatusView({ servers: [1, 2] })).toBeNull();
    expect(buildLspStatusView(null)).toBeNull();
  });
});
