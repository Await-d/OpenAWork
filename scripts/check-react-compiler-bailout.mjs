#!/usr/bin/env node
/**
 * React Compiler 脱靶（bailout）监控
 *
 * ## 为什么需要它
 *
 * `apps/web` 已启用 React Compiler（见 `apps/web/vite.config.ts`），但编译器会对
 * 部分组件 / 自定义 Hook **静默放弃**优化：它不进产物、不报错、不中断构建。
 * 被放弃的函数拿不到自动 memoization —— 此时如果删掉手写 `useMemo` / `useCallback`，
 * 轻则性能回退，重则因 `useEffect` 依赖不稳定而触发无限渲染循环。
 *
 * 所以「React Compiler 已接管，可顺手清理手写 memo」这个判断，必须能**逐文件验证**。
 * 本脚本用与 Vite 一致的 babel 链路离线复算每个函数的编译结果，用于：
 *
 *   1. 判断某个文件是否已被编译器接管（决定手写 memo 能否清理）
 *   2. 跟踪脱靶率趋势（`--baseline` 与历史报表对比）
 *   3. 分类脱靶原因（可修 / 手写 memo 阻挡 / 编译器能力缺口）
 *
 * ## 用法
 *
 *   node scripts/check-react-compiler-bailout.mjs
 *   node scripts/check-react-compiler-bailout.mjs --json=compiler-report.json
 *   node scripts/check-react-compiler-bailout.mjs --baseline=compiler-report.json
 *   node scripts/check-react-compiler-bailout.mjs --max-bailout-rate=0.25
 *   node scripts/check-react-compiler-bailout.mjs --dir=packages/shared-ui/src
 *
 * 退出码：默认 0（纯报告）。给定 `--max-bailout-rate` 且超出阈值时为 1，可用于 CI 门禁。
 *
 * ## 已知偏离
 *
 * 本脚本遍历目录，因此会统计到**不在生产模块图内**的文件（死代码、未引用的目录）。
 * 真实构建口径的报表请用 `OPENAWORK_COMPILER_LOG=<path>` 跑一次 `vite build` 获取，
 * 那条链路只经过实际打包的文件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetTypeScript = require('@babel/preset-typescript');
const presetReact = require('@babel/preset-react');

/**
 * 编译器**必须**从 `apps/web` 解析，而不是从仓库根。
 *
 * 原因：本脚本的结论（某文件是否已被编译器接管）会被用来决定「手写 memo 能否删除」。
 * 如果这里的编译器版本与 `apps/web` 构建时实际使用的不一致，报表就会失真。
 * 从 `apps/web/package.json` 锚定解析可保证两者恒为同一份。
 */
const requireFromWeb = createRequire(path.join(REPO_ROOT, 'apps/web/package.json'));
const reactCompilerPlugin = requireFromWeb('babel-plugin-react-compiler');

/** 统计手写 memo 调用点。`(?<![.\w])` 用于排除 `useMemo` / `React.memo` 的重复计数。 */
const MEMO_SITE_PATTERN = /\buseMemo\(|\buseCallback\(|React\.memo\(|(?<![.\w])memo\(/g;

/**
 * 脱靶原因分类。
 *
 * - `code`           : 代码违反 Rules of React —— **可修**，修完编译器才能真正接管
 * - `memo-blocked`   : 手写 memo 反而让编译器放弃 —— **删掉手写 memo 即可解锁**
 * - `suppressed`     : eslint-disable 注释挡住了编译器 —— 需要显式放行
 * - `compiler-limit` : 编译器当前的能力缺口 —— 改代码无用，只能等版本升级
 * - `unknown`        : 未归类，需人工判断
 */
const CODE_VIOLATION_REASONS = new Set([
  'Cannot access refs during render',
  'This value cannot be modified',
  'Cannot reassign variables declared outside of the component/hook',
  'Cannot reassign variable after render completes',
  'Cannot access variable before it is declared',
  'Hooks must always be called in a consistent order, and may not be called conditionally. See the Rules of Hooks (https://react.dev/warnings/invalid-hook-call-warning)',
]);

const CATEGORY_LABELS = {
  code: '代码违规（可修）',
  'memo-blocked': '手写 memo 阻挡（删即解锁）',
  suppressed: '被 eslint-disable 抑制',
  'compiler-limit': '编译器能力缺口（改代码无用）',
  unknown: '未归类',
};

/**
 * 编译器自身能力缺口的可识别前缀。
 *
 * 这些原因与使用者代码无关（要么是编译器尚未支持的语法，要么是编译过程中已知的
 * 降级），因此**无法通过改代码消除**，只能等待升级或整体改写。
 *
 * 刻意不把「未识别原因」默认归入此类：新出现的未知原因应落在 `unknown` 并被人为
 * 归类，而不是被静默当成「编译器限制」而放过。
 */
const COMPILER_LIMIT_PREFIXES = [
  '(BuildHIR::',
  '[FindContextIdentifiers]',
  'Unexpected terminal',
  'Support value blocks',
  'Expected all references to a variable',
];

function categorizeBailout(reason) {
  if (CODE_VIOLATION_REASONS.has(reason)) return 'code';
  if (reason.includes('React ESLint rules were disabled')) return 'suppressed';
  if (reason.includes('Existing memoization could not be preserved')) return 'memo-blocked';
  if (COMPILER_LIMIT_PREFIXES.some((prefix) => reason.startsWith(prefix))) {
    return 'compiler-limit';
  }
  return 'unknown';
}

const isTestFile = (file) => /\.(test|spec)\.|__tests__|__mocks__/.test(file);

function parseArgs(argv) {
  const options = {
    dir: 'apps/web/src',
    json: null,
    baseline: null,
    maxBailoutRate: null,
    top: 15,
  };
  for (const arg of argv) {
    const [key, value] = arg.split('=');
    switch (key) {
      case '--dir':
        options.dir = value;
        break;
      case '--json':
        options.json = value;
        break;
      case '--baseline':
        options.baseline = value;
        break;
      case '--top':
        options.top = Number(value);
        break;
      case '--max-bailout-rate':
        options.maxBailoutRate = Number(value);
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 三种脱靶事件的字段位置不同，不能一把梭读 `detail`：
 * - CompileError   : `detail.reason`（detail 为 CompilerErrorDetail | CompilerDiagnostic）
 * - CompileSkip    : `reason`（顶层）
 * - PipelineError  : `data`（顶层）
 */
function describeBailout(event) {
  switch (event.kind) {
    case 'CompileError':
      return event.detail?.reason ?? '未知编译错误';
    case 'CompileSkip':
      return event.reason ?? '未知跳过原因';
    case 'PipelineError':
      return `PipelineError: ${event.data ?? ''}`;
    default:
      return `未知事件类型：${event.kind}`;
  }
}

/** 用与 Vite 相同的插件顺序（plugins 先于 presets）复算单个文件的编译结果。 */
function compileFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  const events = [];
  let parseError = null;

  try {
    babel.transformSync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      presets: [
        [presetTypeScript, { isTSX: true, allExtensions: true }],
        [presetReact, { runtime: 'automatic' }],
      ],
      plugins: [
        [
          reactCompilerPlugin,
          {
            target: '19',
            logger: { logEvent: (_filename, event) => events.push(event) },
          },
        ],
      ],
    });
  } catch (error) {
    parseError = error.message.split('\n')[0];
  }

  const compiled = events.filter((event) => event.kind === 'CompileSuccess');
  const bailouts = events.filter(
    (event) =>
      event.kind === 'CompileError' ||
      event.kind === 'PipelineError' ||
      event.kind === 'CompileSkip',
  );

  return {
    code,
    memoSites: (code.match(MEMO_SITE_PATTERN) ?? []).length,
    compiled: compiled.length,
    // memoValues 在 CompileSuccessEvent 的顶层（不在 detail 下）
    memoizedValues: compiled.reduce((sum, event) => sum + (event.memoValues ?? 0), 0),
    bailouts: bailouts.map((event) => ({
      kind: event.kind,
      reason: describeBailout(event),
      line: event.fnLoc?.start?.line ?? null,
    })),
    parseError,
  };
}

function analyze(dir) {
  const files = collectSourceFiles(dir);

  const entries = files.map((file) => {
    const result = compileFile(file);
    return {
      file: path.relative(REPO_ROOT, file),
      test: isTestFile(file),
      memoSites: result.memoSites,
      compiled: result.compiled,
      memoizedValues: result.memoizedValues,
      bailoutCount: result.bailouts.length,
      parseError: result.parseError,
      bailouts: result.bailouts.map((bailout) => ({
        ...bailout,
        category: categorizeBailout(bailout.reason),
      })),
    };
  });

  const source = entries.filter((entry) => !entry.test);
  const total = (list, key) => list.reduce((sum, entry) => sum + entry[key], 0);

  const reasons = new Map();
  const categories = new Map();
  for (const entry of source) {
    for (const bailout of entry.bailouts) {
      reasons.set(bailout.reason, (reasons.get(bailout.reason) ?? 0) + 1);
      categories.set(bailout.category, (categories.get(bailout.category) ?? 0) + 1);
    }
  }

  const bailoutTotal = total(source, 'bailoutCount');
  const compiledTotal = total(source, 'compiled');

  return {
    generatedAt: new Date().toISOString(),
    dir: path.relative(REPO_ROOT, path.resolve(REPO_ROOT, dir)),
    totals: {
      filesScanned: entries.length,
      sourceFiles: source.length,
      testFiles: entries.length - source.length,
      memo: {
        sites: total(source, 'memoSites'),
        inFullyCompiledFiles: total(
          source.filter((entry) => entry.bailoutCount === 0 && entry.compiled > 0),
          'memoSites',
        ),
        inBailoutFiles: total(
          source.filter((entry) => entry.bailoutCount > 0),
          'memoSites',
        ),
        inUncompiledFiles: total(
          source.filter((entry) => entry.bailoutCount === 0 && entry.compiled === 0),
          'memoSites',
        ),
      },
      functions: {
        compiled: compiledTotal,
        bailout: bailoutTotal,
        bailoutRate:
          compiledTotal + bailoutTotal === 0 ? 0 : bailoutTotal / (compiledTotal + bailoutTotal),
      },
      memoizedValues: total(source, 'memoizedValues'),
    },
    categories: Object.fromEntries([...categories].sort((a, b) => b[1] - a[1])),
    reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
    files: source
      .filter((entry) => entry.bailoutCount > 0 || entry.memoSites > 0)
      .map((entry) => ({
        file: entry.file,
        memoSites: entry.memoSites,
        compiled: entry.compiled,
        memoizedValues: entry.memoizedValues,
        bailoutCount: entry.bailoutCount,
        parseError: entry.parseError,
        categories: [...new Set(entry.bailouts.map((bailout) => bailout.category))],
      })),
    bailoutDetail: source
      .filter((entry) => entry.bailoutCount > 0)
      .map((entry) => ({ file: entry.file, bailouts: entry.bailouts })),
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(value, width) {
  return String(value).padStart(width);
}

function printReport(report, options) {
  const { totals, categories, reasons } = report;

  console.log(`===== React Compiler 脱靶监控 · ${report.dir} =====`);
  console.log(`生成时间            : ${report.generatedAt}`);
  console.log(
    `源文件 / 测试文件    : ${totals.sourceFiles} / ${totals.testFiles}（测试文件不计入统计）`,
  );
  console.log('');
  console.log('--- 编译覆盖 ---');
  console.log(
    `编译成功函数        : ${totals.functions.compiled}` +
      `（注入 ${totals.memoizedValues} 个 memo 值，即编译器已自动完成的 memoization）`,
  );
  console.log(`脱靶函数            : ${totals.functions.bailout}`);
  console.log(`脱靶率              : ${percent(totals.functions.bailoutRate)}`);
  console.log('');
  console.log('--- 脱靶原因分类 ---');
  for (const [category, count] of Object.entries(categories)) {
    console.log(`  ${pad(count, 5)}  ${CATEGORY_LABELS[category] ?? category}`);
  }
  console.log('');
  console.log('--- 手写 memo 调用点（决定能否清理的关键）---');
  console.log(`  总计                        : ${totals.memo.sites}`);
  console.log(
    `  位于「文件全绿」中          : ${totals.memo.inFullyCompiledFiles}  <= 编译器已接管，可评估清理`,
  );
  console.log(`  位于「文件内有脱靶」中      : ${totals.memo.inBailoutFiles}  <= 不能盲删`);
  console.log(`  位于「无组件/Hook」文件中   : ${totals.memo.inUncompiledFiles}`);
  console.log('');
  console.log('--- 脱靶原因 Top 20 ---');
  for (const [reason, count] of Object.entries(reasons).slice(0, 20)) {
    console.log(`  ${pad(count, 5)}  [${categorizeBailout(reason)}] ${reason}`);
  }
  console.log('');
  console.log(`--- 手写 memo 最多的 ${options.top} 个文件（含编译状态）---`);
  const hottest = [...report.files].sort((a, b) => b.memoSites - a.memoSites).slice(0, options.top);
  for (const entry of hottest) {
    const status =
      entry.bailoutCount === 0 && entry.compiled > 0
        ? '已接管'
        : entry.compiled === 0
          ? '未编译'
          : '部分接管';
    console.log(
      `  ${pad(entry.memoSites, 4)} memo | ${pad(entry.compiled, 3)} ok ${pad(entry.bailoutCount, 3)} 脱靶 | ${status} | ${entry.file}`,
    );
  }
}

function printBaselineDiff(report, baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    console.log(`\n[基线对比] 跳过：找不到 ${baselinePath}`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const before = baseline.totals.functions;
  const after = report.totals.functions;
  const delta = (next, prev) => (next - prev >= 0 ? `+${next - prev}` : `${next - prev}`);

  console.log(`\n--- 与基线对比（${baseline.generatedAt}）---`);
  console.log(
    `  脱靶函数 : ${before.bailout} -> ${after.bailout}  (${delta(after.bailout, before.bailout)})`,
  );
  console.log(
    `  编译函数 : ${before.compiled} -> ${after.compiled}  (${delta(after.compiled, before.compiled)})`,
  );
  console.log(
    `  脱靶率   : ${percent(before.bailoutRate)} -> ${percent(after.bailoutRate)}` +
      `  (${delta(Number((after.bailoutRate * 100).toFixed(1)), Number((before.bailoutRate * 100).toFixed(1)))} pp)`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dir = path.resolve(REPO_ROOT, options.dir);

  if (!fs.existsSync(dir)) {
    throw new Error(`目录不存在：${dir}`);
  }

  const report = analyze(dir);
  printReport(report, options);

  if (options.baseline) {
    printBaselineDiff(report, path.resolve(REPO_ROOT, options.baseline));
  }

  if (options.json) {
    const out = path.resolve(REPO_ROOT, options.json);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n报表已写入 ${path.relative(REPO_ROOT, out)}`);
  }

  if (options.maxBailoutRate !== null) {
    const rate = report.totals.functions.bailoutRate;
    if (rate > options.maxBailoutRate) {
      console.error(`\n脱靶率 ${percent(rate)} 超过阈值 ${percent(options.maxBailoutRate)}`);
      process.exitCode = 1;
    }
  }
}

main();
