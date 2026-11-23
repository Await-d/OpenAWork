/**
 * 派工页面视觉与可及性验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：状态徽标的实际配色对比度（WCAG AA 4.5:1）、
 * 列表行与详情卡在 375px / 1440px 下是否横向溢出、暗色与亮色主题是否一致。
 *
 * 用法（需先在 45173 起预览服务：`bun run --filter @openAwork/web preview -- --port 45173`）：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-dispatch-visual.ts
 *
 * 网关请求全部用 page.route 模拟，不触达真实网关，也不会产生模型费用。
 */
import { chromium } from 'playwright';

const origin = process.env['OPENAWORK_DISPATCH_ORIGIN'] ?? 'http://127.0.0.1:45173';
const gateway = origin.replace(/:\d+$/, ':45174');

const entries = [
  { status: 'running', title: '季度合同要点梳理', total: 3, succeeded: 1 },
  { status: 'draft', title: '竞品发布会要点', total: 0, succeeded: 0 },
  { status: 'succeeded', title: '客服录音摘要', total: 2, succeeded: 2 },
  { status: 'partial', title: '招聘 JD 审阅', total: 3, succeeded: 2 },
  { status: 'interrupted', title: '老版本迁移说明', total: 2, succeeded: 0 },
] as const;

const detail = {
  id: 'batch-1',
  title: '季度合同要点梳理',
  status: 'running',
  total: 2,
  succeeded: 1,
  updatedAt: 1,
  request: '把这份季度合同拆成摘要和风险点两件事',
  excerpt: '第三条 付款周期为验收后 30 日内。',
  revision: 3,
  selection: { providerId: 'openai', modelId: 'gpt-4o' },
  draftItems: [],
  items: [
    {
      id: 'item-1',
      title: '合同摘要',
      objective: '用三句话概括核心条款',
      acceptance: '覆盖付款与违约',
      role: 'summarize',
      hasEarlierAttempts: true,
      attempts: [
        {
          id: 'a1',
          threadId: 't1',
          number: 1,
          kind: 'initial',
          status: 'succeeded',
          question: null,
          result: '合同约定验收后 30 日内付款。',
          error: null,
          stopRequested: false,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
    },
  ],
};

const browser = await chromium.launch({ headless: true });
let failures = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}${ok || extra === undefined ? '' : ` :: ${JSON.stringify(extra)}`}`,
  );
  if (!ok) failures += 1;
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [375, 1440]) {
    for (const target of ['list', 'detail'] as const) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        serviceWorkers: 'block',
      });
      await page.addInitScript(
        ({ theme, gateway }) => {
          localStorage.setItem('onboarded', '1');
          localStorage.setItem('telemetry_consent_shown', '1');
          localStorage.setItem('theme', theme);
          localStorage.setItem(
            'auth-store',
            JSON.stringify({
              state: {
                accessToken: 'visual-check',
                email: 'check@example.test',
                gatewayUrl: gateway,
              },
              version: 0,
            }),
          );
          if (theme === 'light') {
            document.addEventListener('DOMContentLoaded', () =>
              document.documentElement.classList.add('light'),
            );
          }
        },
        { theme, gateway },
      );
      await page.route('**/dispatch-assistant**', (route) => {
        const headers = {
          'access-control-allow-origin': origin,
          'access-control-allow-headers': 'authorization',
          'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const isDetail = new URL(route.request().url()).pathname !== '/dispatch-assistant';
        return route.fulfill({
          status: 200,
          headers,
          json: isDetail
            ? detail
            : {
                enabled: true,
                entries: entries.map((entry, index) => ({
                  id: `d${index}`,
                  updatedAt: 1,
                  ...entry,
                })),
                nextCursor: null,
              },
        });
      });

      await page.goto(`${origin}${target === 'detail' ? '/dispatches/batch-1' : '/dispatches'}`, {
        waitUntil: 'networkidle',
      });
      await page
        .locator(target === 'detail' ? '.dispatch-item' : '.dispatch-record')
        .first()
        .waitFor({
          timeout: 10_000,
        });

      const report = await page.evaluate(() => {
        const parse = (value: string) => {
          const m = value.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const parts = (m[1] ?? '')
            .split(/[,\s/]+/)
            .filter(Boolean)
            .map(Number);
          return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
        };
        type Rgba = NonNullable<ReturnType<typeof parse>>;
        const over = (fg: Rgba, bg: Rgba): Rgba => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
          a: 1,
        });
        const lum = (c: { r: number; g: number; b: number }) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const contrast = (
          a: { r: number; g: number; b: number },
          b: { r: number; g: number; b: number },
        ) => {
          const l1 = lum(a);
          const l2 = lum(b);
          return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
        };
        /** 沿祖先链把半透明背景逐层合成到第一个不透明底色上。 */
        const solidBackground = (el: Element | null) => {
          const layers: Rgba[] = [];
          let node = el;
          let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
          while (node) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c.a > 0) {
              layers.push(c);
              if (c.a >= 1) break;
            }
            node = node.parentElement;
          }
          for (const layer of layers.reverse()) base = over(layer, base);
          return base;
        };

        const samples: { label: string; ratio: number }[] = [];
        for (const badge of document.querySelectorAll('.dispatch-status')) {
          const cs = getComputedStyle(badge);
          const fg = parse(cs.color);
          const own = parse(cs.backgroundColor);
          if (!fg || !own) continue;
          const bg = over(own, solidBackground(badge.parentElement));
          samples.push({
            label: `badge「${badge.textContent?.trim() ?? ''}」`,
            ratio: contrast(fg, bg),
          });
        }
        for (const sel of ['.dispatch-record-progress', '.dispatch-meta', '.dispatch-hint']) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const fg = parse(getComputedStyle(el).color);
          if (!fg) continue;
          samples.push({ label: sel, ratio: contrast(fg, solidBackground(el)) });
        }

        const page = document.querySelector('.dispatch-page');
        return {
          samples,
          pageWidth: page?.scrollWidth ?? 0,
          viewport: window.innerWidth,
          hOverflow: (page?.scrollWidth ?? 0) > window.innerWidth + 1,
          controls: [...document.querySelectorAll('.dispatch-page button')].map((button) => ({
            label: button.textContent?.trim() ?? '',
            // WCAG 2.2 AA 目标尺寸 24px；派工页主操作按 32px 起算
            height: Math.round(button.getBoundingClientRect().height),
          })),
        };
      });

      const scope = `${theme}/${width}/${target}`;
      const lowContrast = report.samples.filter((sample) => sample.ratio < 4.5);
      check(`${scope} 文字对比度 >= 4.5`, lowContrast.length === 0, lowContrast);
      check(`${scope} 无横向溢出`, !report.hOverflow, {
        pageWidth: report.pageWidth,
        viewport: report.viewport,
      });
      const small = report.controls.filter((control) => control.height > 0 && control.height < 28);
      check(`${scope} 按钮高度 >= 28px`, small.length === 0, small);

      await page.close();
    }
  }
}

await browser.close();
if (failures > 0) {
  console.error(`\n${failures} 项视觉验收未通过`);
  process.exit(1);
}
console.log('\n派工页面视觉验收全部通过');
