/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-message-limits-browser.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = await import('playwright');
const base = process.env.MESSAGE_LIMITS_HARNESS_URL ?? 'http://127.0.0.1:5197';
const output = resolve('apps/web/harness/message-limits-browser-artifacts');
await mkdir(output, { recursive: true });
const checks: { name: string; passed: boolean; detail: unknown }[] = [];
const screenshots: string[] = [];
const requests: unknown[] = [];
const browserErrors: string[] = [];
const consoleErrors: string[] = [];
function check(name: string, passed: boolean, detail: unknown = null) {
  checks.push({ name, passed, detail });
}
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['dark', 'light']) {
    for (const width of [375, 768, 1440]) {
      const tag = `${mode}/${width}`;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', (error) => browserErrors.push(`${tag}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(`${tag}: ${message.text()}`);
      });
      let maxChars = 49152;
      let canEdit = true;
      let failSave = false;
      const puts: unknown[] = [];
      let reads = 0;
      await page.route('**/settings/message-limits', async (route) => {
        const request = route.request();
        if (request.method() === 'PUT') {
          const body = request.postDataJSON();
          puts.push(body);
          requests.push({
            tag,
            method: 'PUT',
            body,
            authorization: request.headers()['authorization'],
            status: failSave ? 500 : 200,
          });
          if (failSave) {
            await route.fulfill({
              status: 500,
              json: { error: 'fixture-save-failure', message: '模拟保存故障' },
            });
            return;
          }
          maxChars = body.maxChars;
        } else {
          reads += 1;
          requests.push({
            tag,
            method: request.method(),
            authorization: request.headers()['authorization'],
          });
        }
        await route.fulfill({
          json: { maxChars, minChars: 1024, hardMaxChars: 200000, defaultMaxChars: 32768, canEdit },
        });
      });
      const open = () =>
        page.goto(`${base}/harness/message-limits-browser.html?mode=${mode}`, {
          waitUntil: 'networkidle',
        });
      const input = page.getByRole('spinbutton', { name: '每条消息最多字符数' });
      const save = page.getByRole('button', { name: '保存字符上限', exact: true });
      const shot = async (state: string) => {
        const path = `${output}/${mode}-${width}-${state}.png`;
        await page.screenshot({ path, fullPage: true });
        screenshots.push(path);
      };
      await open();
      await input.waitFor();
      check(
        `${tag} initial GET and server value`,
        reads > 0 && (await input.inputValue()) === '49152',
        { reads },
      );
      check(`${tag} unchanged save disabled`, await save.isDisabled());
      const layout = await page.evaluate(() => {
        const section = document.querySelector('.message-limits')!;
        const controls = [...section.querySelectorAll('input,button')].map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent,
            x: rect.x,
            right: rect.right,
            y: rect.y,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        });
        const rect = section.getBoundingClientRect();
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          sectionWidth: section.clientWidth,
          sectionScrollWidth: section.scrollWidth,
          controls,
          section: { x: rect.x, right: rect.right },
          background: getComputedStyle(document.body).backgroundColor,
          color: getComputedStyle(section).color,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        };
      });
      check(
        `${tag} no horizontal overflow`,
        layout.pageWidth <= width && layout.sectionScrollWidth <= layout.sectionWidth,
        layout,
      );
      check(
        `${tag} controls fit and have useful size`,
        layout.controls.every(
          (r) =>
            r.x >= layout.section.x &&
            r.right <= layout.section.right &&
            r.height >= 32 &&
            r.width > 70,
        ),
        layout.controls,
      );
      check(
        `${tag} controls do not overlap`,
        layout.controls.every((a, i) =>
          layout.controls
            .slice(i + 1)
            .every((b) => a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y),
        ),
      );
      check(
        `${tag} real theme tokens resolved`,
        layout.background !== 'rgba(0, 0, 0, 0)' && layout.accent.length > 0,
        { background: layout.background, color: layout.color, accent: layout.accent },
      );
      await page.keyboard.press('Tab');
      const focus = await input.evaluate((el) => ({
        focused: el.matches(':focus-visible'),
        outline: getComputedStyle(el).outline,
        shadow: getComputedStyle(el).boxShadow,
      }));
      check(
        `${tag} keyboard focus visible`,
        focus.focused && focus.outline.includes('2px') && focus.shadow !== 'none',
        focus,
      );
      await shot('initial');
      await input.fill('65536');
      await save.click();
      await page.getByText('消息字符上限已保存。', { exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
      check(
        `${tag} valid PUT body 65536`,
        JSON.stringify(puts[0]) === '{"maxChars":65536}',
        puts[0],
      );
      check(
        `${tag} save reflected and clean`,
        (await input.inputValue()) === '65536' && (await save.isDisabled()),
      );
      for (const invalid of ['1023', '200001']) {
        await input.fill(invalid);
        await page.getByRole('alert').waitFor();
        const count = puts.length;
        check(
          `${tag} ${invalid} prevents save`,
          (await save.isDisabled()) && (await input.getAttribute('aria-invalid')) === 'true',
        );
        await input.press('Enter');
        await page.waitForLoadState('networkidle');
        check(`${tag} ${invalid} Enter sends no PUT`, puts.length === count);
      }
      await shot('invalid');
      await page.getByRole('button', { name: '恢复默认值' }).click();
      check(
        `${tag} restore is unsaved draft`,
        (await input.inputValue()) === '32768' &&
          puts.length === 1 &&
          maxChars === 65536 &&
          (await save.isEnabled()),
      );
      await save.click();
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() =>
        document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
      );
      check(
        `${tag} explicit default save PUT`,
        JSON.stringify(puts[1]) === '{"maxChars":32768}' && maxChars === 32768,
        puts[1],
      );
      failSave = true;
      await input.fill('77777');
      await save.click();
      await page.getByText(/保存失败/).waitFor();
      check(
        `${tag} failed save preserves editable draft`,
        (await input.inputValue()) === '77777' && (await save.isEnabled()) && maxChars === 32768,
      );
      await shot('save-error');
      canEdit = false;
      failSave = false;
      await open();
      await page.getByText('当前账号仅可查看，请联系管理员修改。').waitFor();
      check(
        `${tag} read-only has disabled input and no actions`,
        (await input.isDisabled()) &&
          (await save.count()) === 0 &&
          (await page.getByRole('button', { name: '恢复默认值' }).count()) === 0,
      );
      check(
        `${tag} read-only no overflow`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      );
      await shot('readonly');
      await page.close();
      console.log(
        `${tag}: ${checks.filter((c) => c.name.startsWith(tag) && c.passed).length} passed`,
      );
    }
  }
} catch (error) {
  check('execution completed', false, error instanceof Error ? error.stack : String(error));
} finally {
  await browser.close();
  check('no browser exceptions', browserErrors.length === 0, browserErrors);
  const expectedConsoleErrors = consoleErrors.filter((error) =>
    error.includes('500 (Internal Server Error)'),
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (error) => !error.includes('500 (Internal Server Error)'),
  );
  check(
    'no unexpected console errors',
    unexpectedConsoleErrors.length === 0,
    unexpectedConsoleErrors,
  );
  const report = {
    testType:
      'Chromium actual component + real auth store/hook/client + Playwright mocked HTTP; not real gateway integration',
    base,
    chromium: browser.version(),
    checks,
    requests,
    screenshots,
    browserErrors,
    expectedConsoleErrors,
    unexpectedConsoleErrors,
    summary: {
      passed: checks.filter((c) => c.passed).length,
      failed: checks.filter((c) => !c.passed).length,
    },
  };
  await writeFile(`${output}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed) process.exitCode = 1;
}
