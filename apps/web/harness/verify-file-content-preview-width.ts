/**
 * FileContentPreview 宽度验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分（真实排版 / 真实引擎）：
 *   1. 输出区在 `.tool-call-inline-section` 里必须铺满可用宽度——
 *      row flex + wrap 下短行预览会被「输出」标签挤成内容宽度（实测 1280 容器
 *      下只有 471px），长行预览又会换行铺满，宽度随内容长度漂移；
 *   2. 超长行的横向溢出必须归属代码块自身（单块横向滚动），不能是每行一个
 *      「隐形」滚动区（无滚动条、无省略号，剩余内容不可发现）；
 *   3. 横向滚动时行号栏必须吸附在可视区内（sticky），不能被滚出视野。
 *
 * 期望值全部从真实排版推导（见下方注释），不写死实现细节。
 *
 * 运行方式见同目录 `README.md`。
 *
 * ⚠️ 为什么 playwright 用动态导入 + NODE_PATH：
 * `apps/web` **不直接依赖** playwright（浏览器内核依赖只应存在于
 * `packages/browser-automation`），bun 对 workspace 包内的文件做严格依赖解析，
 * 裸名会直接报 `Cannot find package 'playwright'`。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-file-content-preview-width.ts',
  );
  process.exit(1);
}

import {
  FILE_CONTENT_PANE_WIDTHS,
  FILE_CONTENT_WIDTH_CASES,
} from './file-content-preview-width-fixtures.js';

const URL = 'http://127.0.0.1:5173/harness/file-content-preview-width.html';
/** 页面视口需容纳最宽容器（1280px）+ 页面边距。 */
const PAGE_VIEWPORT = { width: 1400, height: 1000 } as const;
/** 行号栏吸附位置的容差（px）：与未滚动时的自然位置比较。 */
const STICKY_TOLERANCE_PX = 1.5;

/** 含超长行的用例：期望代码块自身产生横向滚动。 */
const OVERFLOW_CASE_IDS = new Set(['long-line', 'wide-gutter', 'flags']);

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

interface CaseMeasurement {
  readonly id: string;
  readonly output: Box & { readonly clientWidth: number; readonly scrollWidth: number };
  readonly sectionFlexDirection: string;
  readonly label: Box;
  readonly preview: Box & { readonly clientWidth: number; readonly scrollWidth: number };
  readonly pre: Box & {
    readonly clientWidth: number;
    readonly scrollWidth: number;
    readonly overflowX: string;
  };
  readonly meta: { readonly clientWidth: number; readonly scrollWidth: number };
  readonly card: { readonly clientWidth: number; readonly scrollWidth: number };
  readonly pane: { readonly clientWidth: number; readonly scrollWidth: number };
  /** 单行文本里仍存在「自建横向滚动区」的行数（期望 0）。 */
  readonly perLineScrollRows: number;
}

/** 滚动到最右后行号栏的可见性（sticky 吸附）。 */
interface StickyMeasurement {
  readonly scrollable: boolean;
  readonly scrollLeft: number;
  readonly maxScrollLeft: number;
  readonly numberLeftBefore: number;
  readonly numberLeftAfter: number;
  readonly numberRightAfter: number;
  readonly preLeft: number;
  readonly preRight: number;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { ...PAGE_VIEWPORT } });
  page.on('pageerror', (error) => failures.push(`页面错误：${error.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-pane]', { timeout: 30_000 });
  await page.waitForTimeout(300);

  for (const paneWidth of FILE_CONTENT_PANE_WIDTHS) {
    const scope = page.locator(`[data-pane="${paneWidth}"]`);

    const measurements: CaseMeasurement[] = await scope.evaluate((section) => {
      const box = (el: Element | null): Box | null => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
        };
      };
      const sizes = (el: Element | null): { clientWidth: number; scrollWidth: number } =>
        el
          ? {
              clientWidth: (el as HTMLElement).clientWidth,
              scrollWidth: (el as HTMLElement).scrollWidth,
            }
          : { clientWidth: 0, scrollWidth: 0 };

      return Array.from(section.querySelectorAll('[data-case]')).flatMap((row) => {
        const card = row.querySelector('.chat-message-main');
        const output = row.querySelector('.tool-call-inline-output');
        const outSection =
          Array.from(row.querySelectorAll('.tool-call-inline-section')).at(-1) ?? null;
        const label = outSection?.querySelector('.tool-call-inline-section-label') ?? null;
        const preview = row.querySelector('.file-content-preview');
        const pre = row.querySelector('.file-content-pre');
        const meta = row.querySelector('.file-content-meta');
        if (!output || !outSection || !label || !preview || !pre || !meta || !card) return [];
        const texts = Array.from(row.querySelectorAll('.file-content-line-text'));
        const perLineScrollRows = texts.filter(
          (text) => text.scrollWidth > text.clientWidth + 0.5,
        ).length;
        return [
          {
            id: row.getAttribute('data-case') ?? '',
            output: { ...box(output)!, ...sizes(output) },
            sectionFlexDirection: getComputedStyle(outSection).flexDirection,
            label: box(label)!,
            preview: { ...box(preview)!, ...sizes(preview) },
            pre: {
              ...box(pre)!,
              ...sizes(pre),
              overflowX: getComputedStyle(pre).overflowX,
            },
            meta: sizes(meta),
            card: sizes(card),
            pane: sizes(section),
            perLineScrollRows,
          },
        ];
      });
    });

    for (const testCase of FILE_CONTENT_WIDTH_CASES) {
      const measured = measurements.find((m) => m.id === testCase.id);
      const scopeName = `[${paneWidth}/${testCase.id}]`;
      if (!measured) {
        check(`${scopeName} 用例已渲染`, false, '未找到测量数据');
        continue;
      }

      // 1) 「输出」标签独立成行（位于预览上方）：标签底边不得进入预览区。
      check(
        `${scopeName} 「输出」标签独立成行`,
        measured.label.bottom <= measured.preview.top + 0.5,
        `label.bottom=${measured.label.bottom.toFixed(1)} preview.top=${measured.preview.top.toFixed(1)} flex=${measured.sectionFlexDirection}`,
      );

      // 2) 预览铺满输出区可用宽度：宽度不再随内容长度漂移。
      check(
        `${scopeName} 预览铺满输出区宽度`,
        near(measured.preview.width, measured.output.width, 1),
        `preview=${measured.preview.width.toFixed(1)} output=${measured.output.width.toFixed(1)}`,
      );

      // 3) 输出区 / 卡片 / 容器均无横向溢出（宽度问题必须约束在自身内部）。
      check(
        `${scopeName} 输出区未横向溢出卡片`,
        measured.output.scrollWidth <= measured.output.clientWidth + 1,
        `output scroll=${measured.output.scrollWidth} client=${measured.output.clientWidth}`,
      );
      check(
        `${scopeName} 卡片未横向溢出`,
        measured.card.scrollWidth <= measured.card.clientWidth + 1,
        `card scroll=${measured.card.scrollWidth} client=${measured.card.clientWidth}`,
      );
      check(
        `${scopeName} 容器未横向溢出`,
        measured.pane.scrollWidth <= measured.pane.clientWidth + 1,
        `pane scroll=${measured.pane.scrollWidth} client=${measured.pane.clientWidth}`,
      );

      // 4) meta 行（路径 / 行号范围 / 标记）不横向溢出。
      check(
        `${scopeName} meta 行未横向溢出`,
        measured.meta.scrollWidth <= measured.meta.clientWidth + 1,
        `meta scroll=${measured.meta.scrollWidth} client=${measured.meta.clientWidth}`,
      );

      // 5) 超长行的横向溢出归属代码块自身；单行不得再自建隐形滚动区。
      if (OVERFLOW_CASE_IDS.has(testCase.id)) {
        check(
          `${scopeName} 超长行由代码块整体横向滚动`,
          measured.pre.scrollWidth > measured.pre.clientWidth + 40,
          `pre scroll=${measured.pre.scrollWidth} client=${measured.pre.clientWidth} overflowX=${measured.pre.overflowX}`,
        );
        check(
          `${scopeName} 无逐行隐形滚动区`,
          measured.perLineScrollRows === 0,
          `仍有 ${measured.perLineScrollRows} 行 scrollWidth > clientWidth`,
        );
      } else {
        check(
          `${scopeName} 短行内容不需要横向滚动`,
          measured.pre.scrollWidth <= measured.pre.clientWidth + 1,
          `pre scroll=${measured.pre.scrollWidth} client=${measured.pre.clientWidth}`,
        );
      }

      // 6) 横向滚动到最右后行号栏仍可见（sticky 吸附，不被滚出视野）。
      if (OVERFLOW_CASE_IDS.has(testCase.id)) {
        const sticky: StickyMeasurement = await scope
          .locator(`[data-case="${testCase.id}"]`)
          .evaluate((row) => {
            const pre = row.querySelector('.file-content-pre') as HTMLElement;
            // 断言对象是「用户横向滚动后正在看的那一行」——最宽行；
            // 其余行在滚到最右时本就应该移出视野（sticky 不能越过其包含块）。
            const lines = Array.from(row.querySelectorAll('.file-content-line')) as HTMLElement[];
            const widestLine = lines.reduce((a, b) =>
              a.getBoundingClientRect().width >= b.getBoundingClientRect().width ? a : b,
            );
            const number = widestLine.querySelector('.file-content-line-num') as HTMLElement;
            const preRect = pre.getBoundingClientRect();
            const before = number.getBoundingClientRect();
            pre.scrollLeft = pre.scrollWidth;
            const after = number.getBoundingClientRect();
            return {
              scrollable: pre.scrollWidth > pre.clientWidth,
              scrollLeft: pre.scrollLeft,
              maxScrollLeft: pre.scrollWidth - pre.clientWidth,
              numberLeftBefore: before.left,
              numberLeftAfter: after.left,
              numberRightAfter: after.right,
              preLeft: preRect.left,
              preRight: preRect.right,
            };
          });
        check(
          `${scopeName} 代码块可横向滚动到最右`,
          sticky.scrollable && near(sticky.scrollLeft, sticky.maxScrollLeft, 1),
          `scrollLeft=${sticky.scrollLeft} max=${sticky.maxScrollLeft}`,
        );
        check(
          `${scopeName} 行号栏横向滚动后仍吸附在可视区`,
          near(sticky.numberLeftAfter, sticky.numberLeftBefore, STICKY_TOLERANCE_PX) &&
            sticky.numberLeftAfter >= sticky.preLeft &&
            sticky.numberRightAfter <= sticky.preRight,
          `before=${sticky.numberLeftBefore.toFixed(1)} after=${sticky.numberLeftAfter.toFixed(1)} pre=[${sticky.preLeft.toFixed(1)},${sticky.preRight.toFixed(1)}]`,
        );
      }
    }

    // 截图前把横向滚动复位，保留未滚动时的真实版面。
    await scope.evaluate((section) => {
      for (const pre of section.querySelectorAll<HTMLElement>('.file-content-pre')) {
        pre.scrollLeft = 0;
      }
    });
    await scope.screenshot({ path: `/tmp/opencode/file-content-preview-width-${paneWidth}.png` });
  }

  const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(
    `页面不出现横向溢出（文档宽 ≤ ${PAGE_VIEWPORT.width}）`,
    docScrollWidth <= PAGE_VIEWPORT.width + 1,
    `scrollWidth=${docScrollWidth}`,
  );
} finally {
  await browser.close();
}

console.log(`\nFileContentPreview 宽度验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
