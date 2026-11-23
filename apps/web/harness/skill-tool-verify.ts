/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/skill-tool-verify.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { envelope, malformed, skillCases } from './skill-tool-fixtures.js';
const { chromium } = await import('playwright');
const outputDir = resolve('apps/web/harness/skill-tool-artifacts');
await mkdir(outputDir, { recursive: true });
const results: { name: string; passed: boolean; detail?: string }[] = [];
const screenshots: string[] = [];
const diagnostics: { prefix: string; exceptions: string[]; consoleErrors: string[] }[] = [];
const themes: string[] = [];
const check = (name: string, passed: boolean, detail?: string) => {
  results.push({ name, passed, detail });
  if (!passed) console.log(`FAIL ${name}: ${detail ?? ''}`);
};
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['dark', 'light'] as const)
    for (const width of [375, 768, 1440]) {
      const prefix = `${mode}/${width}`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: mode });
      page.setDefaultTimeout(15000);
      const exceptions: string[] = [],
        consoleErrors: string[] = [];
      page.on('pageerror', (e) => exceptions.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      diagnostics.push({ prefix, exceptions, consoleErrors });
      const c = (name: string, passed: boolean, detail?: string) =>
        check(`${prefix} ${name}`, passed, detail);
      const section = (id: string) => page.locator(`[data-case="${id}"]`);
      const outer = (id: string) => section(id).locator('[aria-expanded]').first();
      const overflow = async (stage: string) => {
        const actual = await page.evaluate(() => document.documentElement.scrollWidth);
        c(`${stage} no page overflow`, actual <= width, `scrollWidth=${actual}; viewport=${width}`);
      };
      try {
        await page.goto(`http://127.0.0.1:5173/harness/skill-tool.html?mode=${mode}`, {
          waitUntil: 'networkidle',
          timeout: 120000,
        });
        await outer('success-name').waitFor();
        await overflow('collapsed');
        for (const [id, summary] of [
          ['success-name', '已加载技能 frontend'],
          ['success-skill', '已加载技能 frontend'],
          ['loading', '正在加载技能 frontend'],
          ['failure', '技能加载失败 frontend'],
          ['cancelled', '已取消加载技能 frontend'],
          ['error-override', '技能加载失败 frontend'],
        ])
          c(`${id} state summary`, (await section(id!).innerText()).includes(summary!));
        const first = outer('success-name');
        await first.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        const ring = await first.evaluate((e) => ({
          visible: e.matches(':focus-visible'),
          outline: getComputedStyle(e).outline,
          shadow: getComputedStyle(e).boxShadow,
        }));
        c(
          'outer focus ring',
          ring.visible &&
            ((!ring.outline.startsWith('none') && !ring.outline.includes(' 0px')) ||
              ring.shadow !== 'none'),
          JSON.stringify(ring),
        );
        await page.keyboard.press('Enter');
        c('Enter opens real Skill', (await first.getAttribute('aria-expanded')) === 'true');
        await page.keyboard.press('Space');
        c('Space closes real Skill', (await first.getAttribute('aria-expanded')) === 'false');
        for (const { id } of skillCases) {
          if ((await outer(id).getAttribute('aria-expanded')) !== 'true') await outer(id).click();
        }
        for (const id of ['success-name', 'success-skill']) {
          const s = section(id);
          c(
            `${id} Markdown heading`,
            await s.getByRole('heading', { name: '验收技能指南' }).isVisible(),
          );
          c(
            `${id} Markdown bold/list/code/table/link`,
            (await s.locator('strong').count()) > 0 &&
              (await s.locator('.skill-content-preview li').count()) === 4 &&
              (await s.locator('pre code').count()) > 0 &&
              (await s.locator('table').count()) === 1 &&
              (await s.getByRole('link', { name: '官方文档' }).getAttribute('href')) ===
                'https://example.com/guide',
          );
          c(
            `${id} resources`,
            (await s.getByRole('region', { name: '技能资源' }).locator('li').count()) === 2,
          );
          c(`${id} duplicate parameters hidden`, !(await s.innerText()).includes('参数'));
          const raw = s.getByRole('button', { name: '原始输出', exact: true });
          await raw.focus();
          await page.keyboard.press('Enter');
          c(`${id} raw disclosure opens`, (await raw.getAttribute('aria-expanded')) === 'true');
          // Raw output has its own bounded preview; expand before checking byte-preserving envelope.
          const more = s.getByRole('button', { name: /展开全部/ });
          if (await more.count()) await more.click();
          c(`${id} raw envelope retained`, (await s.innerText()).includes(envelope));
          await page.keyboard.press('Escape');
          await raw.focus();
          await page.keyboard.press('Space');
          c(`${id} raw Space closes`, (await raw.getAttribute('aria-expanded')) === 'false');
        }
        for (const id of ['failure', 'cancelled']) {
          c(
            `${id} no success document`,
            (await section(id).locator('.skill-content-preview').count()) === 0,
          );
          c(
            `${id} parameters and raw retained`,
            (await section(id).innerText()).includes('参数') &&
              (await section(id).innerText()).includes('<skill_content'),
          );
        }
        c(
          'error override detail',
          (await section('error-override').innerText()).includes('技能不存在'),
        );
        for (const id of ['malformed', 'plain']) {
          c(
            `${id} fallback no success preview`,
            (await section(id).locator('.skill-content-preview').count()) === 0,
          );
          c(`${id} fallback parameters`, (await section(id).innerText()).includes('参数'));
        }
        c('malformed raw preserved', (await section('malformed').innerText()).includes(malformed));
        c(
          'plain raw preserved',
          (await section('plain').innerText()).includes('旧版原始输出：frontend'),
        );
        c(
          'truncation notice visible',
          (await section('truncated').innerText()).includes('内容已截断'),
        );
        const long = section('long');
        c('long tail initially omitted', !(await long.innerText()).includes('LONG_CONTENT_END'));
        const expand = long.getByRole('button', { name: '展开技能全文', exact: true });
        await expand.focus();
        await page.keyboard.press('Enter');
        c('long expansion reveals tail', (await long.innerText()).includes('LONG_CONTENT_END'));
        await overflow('long expanded');
        await long.getByRole('button', { name: '收起技能全文', exact: true }).click();
        await overflow('Skill expanded');
        const skillShot = `${outputDir}/skill-tool-${mode}-${width}.png`;
        await page.screenshot({ path: skillShot, fullPage: true });
        screenshots.push(skillShot);
        for (const [id, total] of [
          ['list-401', 401],
          ['list-801', 801],
        ] as const) {
          await outer(id).click();
          const s = section(id),
            rows = s.locator('.list-directory-row');
          c(`${id} initial budget 400`, (await rows.count()) === 400);
          let target = 400;
          while (target < total) {
            const more = s.getByRole('button', { name: /加载更多/ });
            c(`${id} more available at ${target}`, (await more.count()) === 1);
            await more.focus();
            // 先切换到键盘输入模态，再检查 :focus-visible；鼠标点击后 focus()
            // 不要求浏览器展示键盘焦点环。
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            const focused = await more.evaluate((e) => ({
              active: document.activeElement === e,
              outline: getComputedStyle(e).outline,
              shadow: getComputedStyle(e).boxShadow,
            }));
            c(
              `${id} more focus at ${target}`,
              focused.active && (!focused.outline.includes(' 0px') || focused.shadow !== 'none'),
              JSON.stringify(focused),
            );
            await page.keyboard.press(target === 400 ? 'Enter' : 'Space');
            target = Math.min(target + 400, total);
            c(
              `${id} budget ${target}`,
              (await rows.count()) === target,
              `actual=${await rows.count()}`,
            );
          }
          c(
            `${id} no remaining pagination`,
            (await s.getByRole('button', { name: /加载更多/ }).count()) === 0,
          );
          c(
            `${id} final entry visible`,
            await s
              .getByText(id === 'list-401' ? 'entry-0400.ts' : 'final-tail.ts', { exact: true })
              .isVisible(),
          );
          if (id === 'list-801') {
            const nested = s.getByRole('button', { name: /nested/ });
            await nested.click();
            c(
              'nested collapse leaves tail',
              (await rows.count()) === 2 &&
                (await s.getByText('final-tail.ts', { exact: true }).isVisible()),
            );
            await nested.click();
            c('nested reopens all loaded rows', (await rows.count()) === 801);
          }
          await overflow(id);
          const shot = `${outputDir}/skill-tool-${id}-${mode}-${width}.png`;
          await s.screenshot({ path: shot });
          screenshots.push(shot);
          await outer(id).click();
        }
        await outer('list-empty').click();
        c(
          'known empty and unread distinguished',
          (await section('list-empty').innerText()).includes('空目录') &&
            (await section('list-empty').innerText()).includes('未展开'),
        );
        c(
          'empty directories noninteractive',
          (await section('list-empty').locator('div[data-kind="dir"]').count()) === 2,
        );
        await overflow('final');
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        themes.push(bg);
        c(
          'theme applied',
          (await page.locator('html').getAttribute('data-mode')) === mode &&
            bg !== 'rgba(0, 0, 0, 0)',
          bg,
        );
      } catch (e) {
        c('harness completes', false, String(e));
        const shot = `${outputDir}/skill-tool-error-${mode}-${width}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        screenshots.push(shot);
      } finally {
        c('no browser exceptions', exceptions.length === 0, exceptions.join('\n'));
        c('no console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
        await page.close();
      }
      console.log(
        `${prefix}: ${results.filter((r) => r.name.startsWith(prefix) && r.passed).length} passed; ${results.filter((r) => r.name.startsWith(prefix) && !r.passed).length} failed`,
      );
    }
} finally {
  await browser.close();
}
check('dark/light backgrounds differ', themes.length === 6 && themes[0] !== themes[3]);
const passed = results.filter((r) => r.passed).length,
  failed = results.length - passed;
await writeFile(
  `${outputDir}/skill-tool-results.json`,
  JSON.stringify(
    {
      chromium: browser.version(),
      passed,
      failed,
      results,
      diagnostics,
      screenshots,
      limitations: [
        'cancelled wire status requires props assertion',
        'No gateway or LLM exercised; actual ToolCallDisplay with deterministic fixtures',
        'Python Playwright unavailable; repository Bun Playwright used',
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed, failed, failures: results.filter((r) => !r.passed) }, null, 2),
);
process.exitCode = failed ? 1 : 0;
