/**
 * Regression (§0.128, findPrometheusPlans per-file stat isolation):
 * findPrometheusPlans lists known plan directories then `stat`s each file inside a
 * `Promise.all` to sort by mtime. The stat was unguarded, so a plan file that
 * vanished between `readdir` and `stat` (TOCTOU — concurrent /plan edit, git
 * checkout, manual cleanup) rejected the WHOLE batch; the outer catch then
 * swallowed it as `[]` and the Sisyphus start-work flow wrongly concluded "no
 * plans" (risking a duplicate). The stat is now isolated per-file: the vanished
 * file is dropped, the rest still return.
 *
 * We mock node:fs so readdir yields two plans and stat throws for one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BoulderStateModule from '../../session/boulder-state.js';

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    readdir: mocks.readdir,
    stat: mocks.stat,
    // findPrometheusPlans only uses readdir + stat; the rest of boulder-state
    // (readFile/writeFile/etc.) isn't exercised by this test.
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
}));

let findPrometheusPlans: typeof BoulderStateModule.findPrometheusPlans;

beforeEach(async () => {
  mocks.readdir.mockReset();
  mocks.stat.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  findPrometheusPlans = (await import('../../session/boulder-state.js')).findPrometheusPlans;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findPrometheusPlans per-file stat resilience', () => {
  it('某个计划文件在 readdir 与 stat 之间消失时跳过它而非返回空列表', async () => {
    mocks.readdir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('.agentdocs/workflow')) {
        return ['good.md', 'vanished.md', 'notes.txt'];
      }
      return [];
    });
    mocks.stat.mockImplementation(async (p: string) => {
      if (p.endsWith('vanished.md')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: 1000 } as unknown as never;
    });

    const plans = await findPrometheusPlans('/workspace');

    // The vanished file is dropped; the healthy plan still returns (and the
    // non-.md file was never statted).
    expect(plans).toHaveLength(1);
    expect(plans[0]?.endsWith('good.md')).toBe(true);
  });

  it('全部计划文件可 stat 时按 mtime 倒序返回', async () => {
    mocks.readdir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('.agentdocs/workflow')) {
        return ['older.md', 'newer.md'];
      }
      return [];
    });
    mocks.stat.mockImplementation(async (p: string) => {
      return { mtimeMs: p.endsWith('newer.md') ? 2000 : 1000 } as unknown as never;
    });

    const plans = await findPrometheusPlans('/workspace');

    expect(plans).toHaveLength(2);
    expect(plans[0]?.endsWith('newer.md')).toBe(true);
    expect(plans[1]?.endsWith('older.md')).toBe(true);
  });

  it('优先发现 .agentdocs/workflow，同时兼容 .omo/plans 与旧版 .sisyphus/plans', async () => {
    mocks.readdir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('.agentdocs/workflow')) {
        return ['native.md'];
      }
      if (dir.endsWith('.omo/plans')) {
        return ['omo.md'];
      }
      if (dir.endsWith('.sisyphus/plans')) {
        return ['legacy.md'];
      }
      return [];
    });
    mocks.stat.mockResolvedValue({ mtimeMs: 1000 } as unknown as never);

    const plans = await findPrometheusPlans('/workspace');

    expect(plans).toHaveLength(3);
    expect(plans[0]).toContain('.agentdocs/workflow/native.md');
    expect(plans[1]).toContain('.omo/plans/omo.md');
    expect(plans[2]).toContain('.sisyphus/plans/legacy.md');
  });
});
