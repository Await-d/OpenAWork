/**
 * `skills-page-model` 的纯函数覆盖：三类条目（市场 / 本地工作区 / 已安装）向
 * 统一 `SkillRow` 的映射、来源路径的展示压缩、分页页码折行规则。
 *
 * 关键口径：`hasUpdate` 只在「远端版本存在且与已装版本不同」时为真（后台尚未
 * 检查更新时 `latestVersion` 会回落到本地版本，**不得**因此显示「可更新」）；
 * 本地条目的安装目标是目录而非注册源；系统目录来源需要单独标记。
 */

import { describe, expect, it } from 'vitest';
import {
  buildVisiblePages,
  formatSourceLabel,
  mergeSkillDisplayDetail,
  toInstalledRow,
  toLocalRow,
  toMarketRow,
} from './skills-page-model.js';

type MarketInput = Parameters<typeof toMarketRow>[0];
type LocalInput = Parameters<typeof toLocalRow>[0];
type InstalledInput = Parameters<typeof toInstalledRow>[0];

function market(overrides: Partial<MarketInput> = {}): MarketInput {
  return {
    id: 'web-search-plus',
    name: 'web-search-plus',
    version: '1.3.0',
    description: '多引擎检索与结果去重。',
    category: 'development',
    tags: ['检索'],
    downloads: 12033,
    verified: true,
    installable: true,
    ...overrides,
  };
}

const NOT_INSTALLED = {
  source: 'openAwork/market',
  installedVersion: null,
  enabled: null,
  preinstalled: false,
};

describe('toMarketRow', () => {
  it('未安装时展示「安装」且无已装版本', () => {
    const row = toMarketRow(market(), NOT_INSTALLED);

    expect(row.actionLabel).toBe('安装');
    expect(row.installedVersion).toBeNull();
    expect(row.hasUpdate).toBe(false);
    expect(row.dirPath).toBeNull();
    expect(row.installable).toBe(true);
  });

  it('已安装时按钮改为「重新安装」，并带上已装版本与启用态', () => {
    const row = toMarketRow(market(), {
      source: 'openAwork/market',
      installedVersion: '1.2.0',
      enabled: false,
      preinstalled: true,
    });

    // 按钮是动作（再点即重装），状态由「已安装 vX」徽章表达。
    expect(row.actionLabel).toBe('重新安装');
    expect(row.installedVersion).toBe('1.2.0');
    expect(row.enabled).toBe(false);
    expect(row.preinstalled).toBe(true);
  });

  it('installable === false 的来源不展示安装能力', () => {
    expect(toMarketRow(market({ installable: false }), NOT_INSTALLED).installable).toBe(false);
  });

  it('installable 未声明时默认可安装（与旧卡片网格一致）', () => {
    const row = toMarketRow(market({ installable: undefined }), NOT_INSTALLED);
    expect(row.installable).toBe(true);
  });
});

describe('toLocalRow', () => {
  const local: LocalInput = {
    ...market({ id: 'perf-lab', name: 'perf-lab', downloads: 0, verified: false }),
    dirPath: '/repo/skills/perf-lab',
    workspaceRelativePath: 'skills/perf-lab',
  };

  it('本地条目来源固定为 local-workspace，安装目标是目录', () => {
    const row = toLocalRow(local, { ...NOT_INSTALLED, source: 'local-workspace' });

    expect(row.source).toBe('local-workspace');
    expect(row.dirPath).toBe('/repo/skills/perf-lab');
    expect(row.workspaceRelativePath).toBe('skills/perf-lab');
    expect(row.actionLabel).toBe('安装');
  });

  it('已安装的本地条目展示「重新加载」', () => {
    const row = toLocalRow(local, {
      ...NOT_INSTALLED,
      source: 'local-workspace',
      installedVersion: '0.3.2',
    });

    expect(row.actionLabel).toBe('重新加载');
    expect(row.installedVersion).toBe('0.3.2');
  });
});

describe('toInstalledRow', () => {
  const installed: InstalledInput = {
    id: 'sql-explain-critic',
    name: 'sql-explain-critic',
    version: '0.6.3',
    latestVersion: '0.7.0',
    source: 'openAwork/market',
    enabled: true,
  };

  it('远端版本更高时标记可更新', () => {
    const row = toInstalledRow(installed);
    expect(row.hasUpdate).toBe(true);
    expect(row.latestVersion).toBe('0.7.0');
    expect(row.actionLabel).toBe('已安装');
  });

  it('latestVersion 缺失或与本地相同时不算可更新', () => {
    expect(toInstalledRow({ ...installed, latestVersion: undefined }).hasUpdate).toBe(false);
    expect(toInstalledRow({ ...installed, latestVersion: '0.6.3' }).hasUpdate).toBe(false);
  });

  it('系统目录来源被单独标记，预装标记默认关闭', () => {
    const row = toInstalledRow({
      ...installed,
      source: 'local-system:/home/await/.claude/skills',
      latestVersion: undefined,
    });

    expect(row.systemSourced).toBe(true);
    expect(row.preinstalled).toBe(false);
  });
});

describe('mergeSkillDisplayDetail', () => {
  const marketDetail = {
    id: 'repo-conventions',
    name: 'repo-conventions',
    version: '1.6.2',
    description: '市场版说明',
    category: 'document',
    tags: ['市场标签'],
    downloads: 12033,
    verified: true,
    installable: true,
    author: 'openAwork',
    license: 'MIT',
    readme: '# README',
    permissions: ['出站 HTTPS'],
  };

  it('明细为空时返回 null（面板回落到行字段）', () => {
    const row = toLocalRow(
      { ...market({ id: 'local-x' }), dirPath: '/repo/skills/local-x' },
      { ...NOT_INSTALLED, source: 'local-workspace' },
    );
    expect(mergeSkillDisplayDetail(row, null)).toBeNull();
  });

  it('版本 / 名称 / 描述 / 分类以条目自身为准，避免本地技能显示市场版本', () => {
    const row = toLocalRow(
      {
        ...market({ id: 'repo-conventions', name: 'repo-conventions', version: '0.1.0' }),
        description: '本地清单说明',
        category: 'development',
        dirPath: '/repo/skills/repo-conventions',
      },
      { ...NOT_INSTALLED, source: 'local-workspace' },
    );

    const merged = mergeSkillDisplayDetail(row, marketDetail);

    expect(merged?.version).toBe('0.1.0');
    expect(merged?.description).toBe('本地清单说明');
    expect(merged?.category).toBe('development');
    // 附加信息仍取自市场详情
    expect(merged?.readme).toBe('# README');
    expect(merged?.permissions).toEqual(['出站 HTTPS']);
    expect(merged?.author).toBe('openAwork');
  });

  it('行字段为空时用详情兜底（已安装条目没有描述 / 分类）', () => {
    const row = toInstalledRow({
      id: 'web-search-plus',
      name: 'web-search-plus',
      version: '1.2.0',
      latestVersion: '1.3.0',
      source: 'openAwork/market',
      enabled: true,
    });

    const merged = mergeSkillDisplayDetail(row, {
      ...marketDetail,
      id: 'web-search-plus',
      name: 'web-search-plus',
      version: '1.3.0',
      description: '市场说明',
      category: 'development',
    });

    expect(merged?.version).toBe('1.2.0'); // 已装版本优先
    expect(merged?.description).toBe('市场说明');
    expect(merged?.category).toBe('development');
  });
});

describe('formatSourceLabel', () => {
  it.each([
    ['非系统来源原样返回', 'openAwork/market', 'openAwork/market'],
    ['路径较长时压成末两段', 'local-system:/home/await/.claude/skills', '…/.claude/skills'],
    ['段数不足两段时不压缩', 'local-system:/skills', '/skills'],
    [
      'Windows 反斜杠同样压缩',
      'local-system:C:\\Users\\a\\AppData\\Roaming\\skills',
      '…/Roaming/skills',
    ],
  ])('%s', (_label, input, expected) => {
    expect(formatSourceLabel(input)).toBe(expected);
  });
});

describe('buildVisiblePages', () => {
  it('总页数不超过 5 时全部展示', () => {
    expect(buildVisiblePages(1, 1)).toEqual([1]);
    expect(buildVisiblePages(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('靠前时保留首 4 页 + 末页', () => {
    expect(buildVisiblePages(1, 6)).toEqual([1, 2, 3, 4, 6]);
  });

  it('靠后时保留首页 + 末 4 页', () => {
    expect(buildVisiblePages(6, 6)).toEqual([1, 3, 4, 5, 6]);
  });

  it('中间时保留首页 + 当前页邻域 + 末页', () => {
    expect(buildVisiblePages(10, 20)).toEqual([1, 9, 10, 11, 20]);
  });
});
