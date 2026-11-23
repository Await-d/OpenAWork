/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/list-directory-verify.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rootPath, longName, longFile, malformedOutput } from './list-directory-fixtures.js';

const { chromium } = await import('playwright');
const outputDir = resolve('apps/web/harness/list-directory-artifacts');
await mkdir(outputDir, { recursive: true });
const results: { name: string; passed: boolean; detail?: string }[] = [];
const screenshots: string[] = [];
const themes: { mode: string; background: string; color: string }[] = [];
function check(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail });
}
const browser = await chromium.launch({ headless: true });
console.log(`Chromium ${browser.version()}`);
try {
  for (const mode of ['dark', 'light']) {
    for (const width of [375, 768, 1440]) {
      const prefix = `${mode}/${width}`;
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        colorScheme: mode === 'dark' ? 'dark' : 'light',
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:5173/harness/list-directory.html?mode=${mode}`, {
        waitUntil: 'networkidle',
        timeout: 120000,
      });
      await page.locator('[data-case="listing"] button[aria-expanded]').waitFor();
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth);
      check(`${prefix} collapsed overflow`, (await overflow()) <= width);
      for (const id of ['listing', 'empty', 'malformed', 'error']) {
        const disclosure = page.locator(`[data-case="${id}"] button[aria-expanded]`).first();
        if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
        check(
          `${prefix} ${id} expands`,
          (await disclosure.getAttribute('aria-expanded')) === 'true',
        );
      }
      const listing = page.locator('[data-case="listing"]');
      const tree = listing.getByRole('region', { name: '目录清单' });
      check(`${prefix} directory region`, (await tree.count()) === 1);
      check(
        `${prefix} root path`,
        (await tree.locator('.list-directory-root').innerText()) === rootPath,
      );
      const meta = await tree.locator('.list-directory-meta').innerText();
      check(`${prefix} returned counts`, meta.includes('3 个目录 · 4 个文件'), meta);
      check(`${prefix} visited count`, meta.includes('已访问 190 个条目'), meta);
      check(`${prefix} depth limit`, meta.includes('遍历深度 3 · 更深层内容未读取'), meta);
      check(
        `${prefix} seven initial rows`,
        (await tree.locator('.list-directory-row').count()) === 7,
      );
      check(
        `${prefix} empty directory is noninteractive`,
        (await tree.locator('div[data-kind="dir"]').filter({ hasText: 'empty-cache' }).count()) ===
          1,
      );
      const icons = await tree.locator('.list-directory-icon img').evaluateAll((images) =>
        images.map((element) => {
          const image = element as HTMLImageElement;
          return {
            source: image.getAttribute('src'),
            loaded: image.complete && image.naturalWidth > 0,
            width: image.getBoundingClientRect().width,
          };
        }),
      );
      check(
        `${prefix} all icons loaded`,
        icons.length === 7 && icons.every((icon) => icon.loaded && icon.width === 16),
        JSON.stringify(icons),
      );
      check(
        `${prefix} folder and file icon types`,
        icons.some((icon) => icon.source?.includes('folder')) &&
          icons.some((icon) => icon.source?.includes('react_ts')),
      );
      const source = tree.getByRole('button', { name: /src/ }).first();
      const initialIcon = await source.locator('img').getAttribute('src');
      await source.focus();
      await page.keyboard.press('Enter');
      check(
        `${prefix} Enter collapses directory`,
        (await source.getAttribute('aria-expanded')) === 'false',
      );
      check(
        `${prefix} collapsed children hidden`,
        (await tree.getByText('main.tsx', { exact: true }).count()) === 0 &&
          (await tree.locator('.list-directory-row').count()) === 2,
      );
      check(
        `${prefix} collapsed folder icon changes`,
        (await source.locator('img').getAttribute('src')) !== initialIcon,
      );
      await page.keyboard.press('Space');
      check(
        `${prefix} Space expands directory`,
        (await source.getAttribute('aria-expanded')) === 'true' &&
          (await tree.getByText('main.tsx', { exact: true }).isVisible()),
      );
      const nested = tree.getByRole('button', { name: new RegExp(longName) });
      await nested.click();
      check(
        `${prefix} nested directory collapses`,
        (await tree.getByText(longFile, { exact: true }).count()) === 0,
      );
      await nested.click();
      check(
        `${prefix} nested directory restores`,
        await tree.getByText(longFile, { exact: true }).isVisible(),
      );
      const empty = page.locator('[data-case="empty"]');
      check(`${prefix} empty counts`, (await empty.innerText()).includes('0 个目录 · 0 个文件'));
      check(`${prefix} empty message`, (await empty.innerText()).includes('未返回目录条目'));
      const malformed = page.locator('[data-case="malformed"]');
      check(
        `${prefix} malformed fallback notice`,
        (await malformed.innerText()).includes('目录输出格式不完整或无法识别'),
      );
      check(
        `${prefix} malformed raw data retained`,
        (await malformed.innerText()).includes(malformedOutput),
      );
      check(
        `${prefix} malformed no tree`,
        (await malformed.locator('.list-directory').count()) === 0,
      );
      const error = page.locator('[data-case="error"]');
      check(
        `${prefix} error text retained`,
        (await error.innerText()).includes('EACCES: permission denied listing private directory'),
      );
      check(
        `${prefix} error no success tree`,
        (await error.locator('.list-directory').count()) === 0,
      );
      const pageWidth = await overflow();
      check(
        `${prefix} expanded overflow`,
        pageWidth <= width,
        `scrollWidth=${pageWidth}, viewport=${width}`,
      );
      await source.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const ring = await source.evaluate((element) => ({
        visible: element.matches(':focus-visible'),
        outline: getComputedStyle(element).outline,
        shadow: getComputedStyle(element).boxShadow,
      }));
      check(
        `${prefix} keyboard focus ring`,
        ring.visible && !ring.outline.includes(' 0px') && ring.shadow !== 'none',
        JSON.stringify(ring),
      );
      const theme = await page.evaluate(() => ({
        mode: document.documentElement.dataset.mode ?? '',
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
      }));
      themes.push(theme);
      check(
        `${prefix} theme applied`,
        theme.mode === mode && theme.background !== 'rgba(0, 0, 0, 0)',
        JSON.stringify(theme),
      );
      const screenshot = `${outputDir}/list-directory-${mode}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      check(`${prefix} no browser exceptions`, errors.length === 0, errors.join('\n'));
      console.log(
        `${prefix}: ${results.filter((item) => item.name.startsWith(prefix) && item.passed).length} passed / ${results.filter((item) => item.name.startsWith(prefix) && !item.passed).length} failed; pageWidth=${pageWidth}; screenshot=${screenshot}`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
check('dark/light distinct theme backgrounds', themes[0]?.background !== themes[3]?.background);
const passed = results.filter((item) => item.passed).length;
const failed = results.length - passed;
await writeFile(
  `${outputDir}/list-directory-results.json`,
  JSON.stringify(
    { chromium: browser.version(), passed, failed, results, screenshots, themes },
    null,
    2,
  ),
);
console.log(`${passed} passed / ${failed} failed`);
for (const item of results.filter((result) => !result.passed))
  console.log(`FAIL ${item.name}: ${item.detail ?? ''}`);
process.exitCode = failed ? 1 : 0;
