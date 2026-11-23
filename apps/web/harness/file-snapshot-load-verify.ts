/**
 * 「按需加载完整文件快照」真实浏览器取证。
 *
 * 运行（仓库根目录）：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/file-snapshot-load-verify.ts
 *
 * 断言：
 *  1. 截断条目在有会话上下文时出现「加载完整内容（省略 N 字符）」按钮；
 *  2. **页面加载后没有任何 file-changes 请求**（绝不自动加载）；
 *  3. 无会话上下文 / 完整条目都不出现加载入口；
 *  4. 点击 → 「加载中…」+ disabled → 完整数据生效（截断提示消失、+N/-M 变成全量）；
 *  5. 网关失败 → 错误文案 + 「重试」，按钮不停在 loading；
 *  6. 375 / 768 / 1440 三种宽度、dark + light 两个主题下均无横向溢出。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/file-snapshot-load-verify.ts',
  );
  process.exit(1);
}

const BASE = process.env.FILE_SNAPSHOT_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/file-snapshot-load-artifacts';
const VIEWPORTS = [375, 768, 1440] as const;
const MODES = ['dark', 'light'] as const;

const browser = await chromium.launch();
const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  results.push(`- ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

for (const mode of MODES) {
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto(`${BASE}/harness/file-snapshot-load.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-case="truncated-with-session"] .file-change-result', {
      state: 'attached',
      timeout: 60000,
    });
    await page.waitForTimeout(400);

    const tag = `${mode}/${width}`;
    results.push(`\n### ${tag}`);

    // ① 默认态：按钮存在、文案带省略字符数
    const withSession = page.locator('[data-case="truncated-with-session"]');
    const loadButton = withSession.locator('.file-change-result-load-btn');
    const buttonCount = await loadButton.count();
    check('截断条目出现加载按钮', buttonCount === 1, `count=${buttonCount}`);

    // ② 绝不自动加载
    const autoRequests = await page.evaluate(
      () =>
        (window as unknown as { __fileSnapshotHarness: { requests: string[] } })
          .__fileSnapshotHarness.requests.length,
    );
    check('页面加载后无任何 file-changes 请求', autoRequests === 0, `requests=${autoRequests}`);

    // ③ 无会话 / 完整条目都不给入口
    const noSessionButtons = await page
      .locator('[data-case="truncated-no-session"] .file-change-result-load-btn')
      .count();
    check('无会话上下文不渲染加载按钮', noSessionButtons === 0, `count=${noSessionButtons}`);
    const completeButtons = await page
      .locator('[data-case="complete"] .file-change-result-load-btn')
      .count();
    check('完整条目不渲染加载按钮', completeButtons === 0, `count=${completeButtons}`);
    const completePartial = await page
      .locator('[data-case="complete"] .file-change-result-partial')
      .count();
    check('完整条目无截断提示', completePartial === 0, `count=${completePartial}`);

    // 展开所有文件行：按钮与 diff 都在展开体内
    await page.evaluate(() => {
      document.querySelectorAll('details.file-change-result-file').forEach((node) => {
        (node as HTMLDetailsElement).open = true;
      });
    });
    await page.waitForTimeout(200);
    // 按钮在展开体内：`innerText` 对不可见元素返回空串，所以文案断言必须放在展开之后。
    const idleLabel = (await loadButton.innerText()).trim();
    check('按钮文案含省略字符数', /^加载完整内容（省略 \d+ 字符）$/.test(idleLabel), idleLabel);
    await page.screenshot({ path: `${OUT_DIR}/${mode}-${width}-idle.png`, fullPage: true });

    // ④ 点击 → loading → loaded
    const beforeAdd = (
      await withSession.locator('.file-change-result-add').first().innerText()
    ).trim();
    check('截断态初始增删统计为 +0（真实差异被截掉）', beforeAdd === '+0', beforeAdd);

    await loadButton.click();
    await page.waitForTimeout(40);
    const loadingLabel = (await loadButton.innerText()).trim();
    const loadingDisabled = await loadButton.isDisabled();
    check('点击后进入「加载中…」', loadingLabel === '加载中…', loadingLabel);
    check('加载中按钮 disabled', loadingDisabled, `disabled=${loadingDisabled}`);
    await page.screenshot({ path: `${OUT_DIR}/${mode}-${width}-loading.png`, fullPage: true });

    await page.waitForFunction(
      () => {
        const section = document.querySelector('[data-case="truncated-with-session"]');
        if (!section) return false;
        return section.querySelector('.file-change-result-partial') === null;
      },
      { timeout: 15000 },
    );
    await page.waitForTimeout(150);

    const loadedButtons = await loadButton.count();
    check('加载完成后按钮消失', loadedButtons === 0, `count=${loadedButtons}`);
    const loadedAdd = (
      await withSession.locator('.file-change-result-add').first().innerText()
    ).trim();
    const loadedDel = (
      await withSession.locator('.file-change-result-delete').first().innerText()
    ).trim();
    check('加载完成后 +N 来自完整数据', loadedAdd === '+1', loadedAdd);
    check('加载完成后 -M 来自完整数据', loadedDel === '−1', loadedDel);
    const partialGone = await withSession.locator('.file-change-result-partial').count();
    check('加载完成后截断提示消失', partialGone === 0, `count=${partialGone}`);
    const diffRendered = await withSession.locator('[data-diff-view-mode]').count();
    check('加载完成后 diff 重新渲染', diffRendered > 0, `count=${diffRendered}`);
    const rawKept = await withSession.locator('.file-change-result-raw').count();
    check('「原始结果」区块保留', rawKept === 1, `count=${rawKept}`);
    await page.screenshot({ path: `${OUT_DIR}/${mode}-${width}-loaded.png`, fullPage: true });

    const totalRequests = await page.evaluate(
      () =>
        (window as unknown as { __fileSnapshotHarness: { requests: string[] } })
          .__fileSnapshotHarness.requests.length,
    );
    check('点击只触发一次请求', totalRequests === 1, `requests=${totalRequests}`);

    // ⑤ 失败态
    const failSection = page.locator('[data-case="truncated-load-fails"]');
    const failButton = failSection.locator('.file-change-result-load-btn');
    await failButton.click();
    await page.waitForSelector(
      '[data-case="truncated-load-fails"] .file-change-result-load-error',
      {
        timeout: 15000,
      },
    );
    const errorText = (
      await failSection.locator('.file-change-result-load-error').innerText()
    ).trim();
    check('失败时给出错误文案', errorText.length > 0, errorText);
    const retryLabel = (await failButton.innerText()).trim();
    check('失败后按钮变为「重试」', retryLabel === '重试', retryLabel);
    const retryDisabled = await failButton.isDisabled();
    check('失败后按钮不停在 loading（可再次点击）', !retryDisabled, `disabled=${retryDisabled}`);
    await page.screenshot({ path: `${OUT_DIR}/${mode}-${width}-failed.png`, fullPage: true });

    // ⑥ 横向溢出（整页 + 每个 case 容器）
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const sections = Array.from(document.querySelectorAll('[data-case]')).map((node) => {
        const el = node as HTMLElement;
        return {
          id: el.dataset['case'] ?? '?',
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
        };
      });
      return {
        viewport: window.innerWidth,
        docScrollWidth: doc.scrollWidth,
        sections,
      };
    });
    check(
      '整页无横向溢出',
      overflow.docScrollWidth <= overflow.viewport + 1,
      `scrollWidth=${overflow.docScrollWidth} viewport=${overflow.viewport}`,
    );
    for (const section of overflow.sections) {
      check(
        `${section.id} 无横向溢出`,
        section.scrollWidth <= section.clientWidth + 1,
        `scrollWidth=${section.scrollWidth} clientWidth=${section.clientWidth}`,
      );
    }

    results.push(`- 页面异常: ${errors.length ? errors.join(' | ') : '无'}`);
    if (errors.length) failures += errors.length;

    await page.close();
  }
}

await browser.close();
console.log(results.join('\n'));
console.log(`\n总计失败断言/异常：${failures}`);
process.exit(failures === 0 ? 0 : 1);
