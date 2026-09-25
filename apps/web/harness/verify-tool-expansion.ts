/**
 * 工具卡「点击展开」可视化验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：展开面板的真实计算样式（背景 / 边框）、Bash 命令是否被
 * 截断、批量子行是否有可展开线索、嵌套卡是否重复 header、以及窄视口下的横向溢出。
 *
 * 断言按**目标态**编写：修复前运行会红（基线证据），修复后转绿。
 * 运行方式见同目录 `README.md`。
 *
 * ⚠️ 为什么 playwright 用动态导入 + NODE_PATH：
 * `apps/web` **不直接依赖** playwright（浏览器内核依赖只应存在于 `packages/browser-automation`），
 * 而 bun 对 workspace 包内的文件做严格依赖解析，裸名会直接报 `Cannot find package 'playwright'`；
 * 相对路径穿越 `node_modules` 同样被 bun 拒绝（绝对路径才放行，但那不可提交）。
 * 因此运行命令需指向该 workspace 的 node_modules —— 见下方 catch 分支与 README。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-tool-expansion.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/tool-expansion.html';
const VIEWPORTS = [375, 768, 1280];
const SHOT_SUFFIX = process.env.HARNESS_SHOT_SUFFIX ?? '';

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || color === '';
}

/** 结构类型：只用到 Playwright Locator 的这两个方法（避免静态导入 playwright 类型）。 */
interface ClickableLocator {
  click(): Promise<void>;
  getAttribute(name: string): Promise<string | null>;
}

/** 文件编辑默认展开（对齐参考实现），点击前先判断 aria-expanded，避免把展开态点回去。 */
async function ensureExpanded(header: ClickableLocator): Promise<void> {
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click();
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1000 });
    // 每个视口都重新加载：展开状态会被点击切换，重载保证三类卡片都是「初始折叠 → 点击展开」路径。
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-case="bash"] [data-tool-status]', { timeout: 30_000 });

    // ── Bash：展开后命令完整可读 + 展开面板有背景 ─────────────────────────
    const bashCase = page.locator('[data-case="bash"]');
    await ensureExpanded(bashCase.locator('.tool-call-block-header').first());
    await bashCase.locator('[data-tool-card-bash-terminal]').first().waitFor({ timeout: 5_000 });

    const bash = await bashCase.evaluate((section) => {
      const body = section.querySelector<HTMLElement>('.tool-call-block-body');
      const block = section.querySelector<HTMLElement>('[data-tool-card-bash-block]');
      const command = section.querySelector<HTMLElement>('[data-tool-card-bash-command]');
      const copy = section.querySelector<HTMLElement>('[data-tool-card-bash-copy]');
      const params = section.querySelector('.tool-call-block-params');
      const style = block ? getComputedStyle(block) : null;
      return {
        bodyBackground: body ? getComputedStyle(body).backgroundColor : '',
        blockExists: block !== null,
        blockBackground: style?.backgroundColor ?? '',
        blockBorderWidth: style?.borderTopWidth ?? '',
        hasPrompt: section.querySelector('[data-tool-card-bash-prompt]') !== null,
        commandExists: command !== null,
        commandText: command?.textContent ?? '',
        commandWhiteSpace: command ? getComputedStyle(command).whiteSpace : '',
        copyOpacity: copy ? getComputedStyle(copy).opacity : '',
        hasParams: params !== null,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] bash 终端块自体承载内容（边框 + 底色），展开体不叠面板`,
      bash.blockExists &&
        !isTransparent(bash.blockBackground) &&
        bash.blockBorderWidth !== '0px' &&
        isTransparent(bash.bodyBackground),
      JSON.stringify({
        blockBg: bash.blockBackground,
        border: bash.blockBorderWidth,
        bodyBg: bash.bodyBackground,
      }),
    );
    check(
      `[${width}] bash 展开态命令完整显示（多行不截断）`,
      bash.commandExists &&
        bash.commandText.includes('grep -n "error TS"') &&
        bash.commandWhiteSpace === 'pre-wrap',
      JSON.stringify({
        exists: bash.commandExists,
        whiteSpace: bash.commandWhiteSpace,
        text: bash.commandText.slice(0, 80),
      }),
    );
    check(`[${width}] bash 终端提示符（$）在命令前`, bash.hasPrompt);
    check(`[${width}] bash 入参不再展示（对齐参考实现）`, !bash.hasParams);
    check(
      `[${width}] bash 复制按钮默认隐藏（悬停 / 聚焦才显示）`,
      bash.copyOpacity === '0',
      `opacity=${bash.copyOpacity}`,
    );
    await bashCase.locator('[data-tool-card-bash-block]').first().hover();
    const copyVisible = await page
      .waitForFunction(
        () => {
          const button = document.querySelector('[data-tool-card-bash-copy]');
          return button !== null && getComputedStyle(button).opacity === '1';
        },
        undefined,
        { timeout: 2_000 },
      )
      .then(() => true)
      .catch(() => false);
    check(`[${width}] bash 悬停后复制按钮可见`, copyVisible);
    await bashCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-bash.png`,
    });

    // ── 文件编辑：默认展开（无需点击）→ 文件卡头 + diff 直接可见 ────────
    const editCase = page.locator('[data-case="edit"]');
    const editHeaderExpanded = await editCase
      .locator('.tool-call-block-header')
      .first()
      .getAttribute('aria-expanded');
    check(
      `[${width}] 文件编辑默认展开（不点击即可看到变更）`,
      editHeaderExpanded === 'true',
      `aria-expanded=${editHeaderExpanded}`,
    );
    await editCase.locator('.tool-call-block-diff').first().waitFor({ timeout: 5_000 });

    const edit = await editCase.evaluate((section) => {
      const rows = section.querySelectorAll('.tool-call-block-diff pre');
      const header = section.querySelector<HTMLElement>('.tool-call-file-header');
      const anchor = section.querySelector<HTMLElement>(
        '.tool-call-block-diff [data-diff-row="added"]',
      );
      const exactTexts = Array.from(section.querySelectorAll('.tool-call-block-diff div')).map(
        (el) => (el.textContent ?? '').trim(),
      );
      const params = section.querySelector('.tool-call-block-params');
      return {
        rowCount: rows.length,
        anchorBackground: anchor ? getComputedStyle(anchor).backgroundColor : '',
        hasColumnHeader: exactTexts.includes('内容') || exactTexts.includes('旧'),
        highlightTokenCount: section.querySelectorAll('.tool-call-block-diff [class*="hljs-"]')
          .length,
        fileIconCount: header?.querySelectorAll('svg, img').length ?? 0,
        fileName: header?.querySelector('.tool-call-file-name')?.textContent ?? '',
        fileDir: header?.querySelector('.tool-call-file-dir')?.textContent ?? '',
        fileStats: header?.querySelector('.tool-call-file-stats')?.textContent ?? '',
        hasParams: params !== null,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] 文件编辑变更行自带底色（无列头 / 无逐行描边）`,
      !isTransparent(edit.anchorBackground) && !edit.hasColumnHeader,
      JSON.stringify({ anchorBg: edit.anchorBackground, hasColumnHeader: edit.hasColumnHeader }),
    );
    check(`[${width}] 文件编辑 diff 行已渲染`, edit.rowCount > 0, `rows=${edit.rowCount}`);
    check(
      `[${width}] 文件编辑 diff 带语法高亮（hljs token）`,
      edit.highlightTokenCount > 0,
      `tokens=${edit.highlightTokenCount}`,
    );
    check(`[${width}] 文件编辑入参不再展示（对齐参考实现）`, !edit.hasParams);
    check(
      `[${width}] 文件卡头：图标 + 目录 + 文件名 + 增删统计`,
      edit.fileIconCount > 0 &&
        edit.fileName === 'conversation-layout-state.ts' &&
        edit.fileDir.includes('apps/web') &&
        edit.fileStats.includes('+3'),
      JSON.stringify({
        icon: edit.fileIconCount,
        dir: edit.fileDir,
        name: edit.fileName,
        stats: edit.fileStats,
      }),
    );
    await editCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-edit.png`,
    });

    // ── 补丁（unified diff）：hunk 分隔条 + 逐行高亮 ────────────────────────
    const patchCase = page.locator('[data-case="patch"]');
    const patchExpanded = await patchCase
      .locator('.tool-call-block-header')
      .first()
      .getAttribute('aria-expanded');
    check(`[${width}] 补丁默认展开（fileEdit 类别）`, patchExpanded === 'true');
    await patchCase.locator('.tool-call-block-diff').first().waitFor({ timeout: 5_000 });

    const patch = await patchCase.evaluate((section) => {
      const diff = section.querySelector('.tool-call-block-diff');
      const separators = Array.from(diff?.querySelectorAll('[data-diff-row="hunk"]') ?? []).map(
        (el) => (el.textContent ?? '').trim(),
      );
      const params = section.querySelector('.tool-call-block-params');
      return {
        separators,
        hasRawHunkHeader: separators.some((text) => text.startsWith('@@')),
        highlightTokenCount: diff?.querySelectorAll('[class*="hljs-"]').length ?? 0,
        hasParams: params !== null,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] 补丁 hunk 分隔条折叠为「N 行未变更」`,
      patch.separators.length === 2 &&
        !patch.hasRawHunkHeader &&
        patch.separators[0]?.includes('第 1 行起') &&
        patch.separators[1]?.includes('行未变更'),
      JSON.stringify(patch.separators),
    );
    check(
      `[${width}] 补丁逐行语法高亮`,
      patch.highlightTokenCount > 0,
      `tokens=${patch.highlightTokenCount}`,
    );
    check(`[${width}] 补丁不展示入参`, !patch.hasParams);
    await patchCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-patch.png`,
    });

    // ── 新建文件（write）：全量新增 + 统计 + 高亮 ──────────────────────────
    const writeCase = page.locator('[data-case="write"]');
    const writeExpanded = await writeCase
      .locator('.tool-call-block-header')
      .first()
      .getAttribute('aria-expanded');
    check(`[${width}] 新建文件默认展开（fileEdit 类别）`, writeExpanded === 'true');
    await writeCase.locator('.tool-call-block-diff').first().waitFor({ timeout: 5_000 });

    const write = await writeCase.evaluate((section) => {
      const stats = section.querySelector('.tool-call-file-stats')?.textContent ?? '';
      return {
        added: section.querySelectorAll('[data-diff-row="added"]').length,
        removed: section.querySelectorAll('[data-diff-row="removed"]').length,
        highlightTokenCount: section.querySelectorAll('.tool-call-block-diff [class*="hljs-"]')
          .length,
        stats,
        hasParams: section.querySelector('.tool-call-block-params') !== null,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] 新建文件 = 全量新增（无删除行）+ 增删统计 + 语法高亮`,
      write.added > 0 &&
        write.removed === 0 &&
        write.stats.includes('+') &&
        !write.stats.includes('-') &&
        write.highlightTokenCount > 0 &&
        !write.hasParams,
      JSON.stringify(write),
    );
    await writeCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-write.png`,
    });

    // ── split diff：并排两侧语法高亮 ────────────────────────────────────────
    const splitCase = page.locator('[data-case="split-diff"]');
    await splitCase.locator('[data-diff-row]').first().waitFor({ timeout: 5_000 });

    const split = await splitCase.evaluate((section) => ({
      tokenCount: section.querySelectorAll('span[class*="hljs-"]').length,
      keywordCount: section.querySelectorAll('[class*="hljs-keyword"]').length,
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
    }));
    check(
      `[${width}] split diff 并排两侧语法高亮`,
      split.tokenCount > 0 && split.keywordCount > 0,
      JSON.stringify(split),
    );
    await splitCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-split.png`,
    });

    // ── 查看文件（read）：摘要带路径 + 行范围；展开只有预览、无参数区 ────────
    const readCase = page.locator('[data-case="read"]');
    const readSummary =
      (await readCase.locator('.tool-call-inline-summary').first().textContent()) ?? '';
    check(
      `[${width}] read 摘要带路径 + 读取行区间`,
      readSummary.includes('ChatConversationView.tsx:12-17'),
      readSummary,
    );

    await readCase.locator('.tool-call-inline').first().click();
    await readCase.locator('.file-content-preview').first().waitFor({ timeout: 5_000 });

    const read = await readCase.evaluate((section) => {
      const labels = Array.from(section.querySelectorAll('.tool-call-inline-section-label')).map(
        (el) => (el.textContent ?? '').trim(),
      );
      return {
        path: section.querySelector('.file-content-path')?.textContent ?? '',
        range: section.querySelector('.file-content-range')?.textContent ?? '',
        hasParamsSection: labels.includes('参数'),
        hasOutputLabel: labels.includes('输出'),
        lineCount: section.querySelectorAll('.file-content-line').length,
        highlightTokenCount: section.querySelectorAll('.file-content-pre [class*="hljs-"]').length,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] read 展开 = 路径 + 预览（无参数区 / 无「输出」字眼）`,
      !read.hasParamsSection &&
        !read.hasOutputLabel &&
        read.path.includes('ChatConversationView.tsx') &&
        read.lineCount > 0,
      JSON.stringify(read),
    );
    check(
      `[${width}] read 预览带语法高亮（hljs token）`,
      read.highlightTokenCount > 0,
      `tokens=${read.highlightTokenCount}`,
    );
    check(
      `[${width}] read 预览展示「起–止 / 总行数」`,
      read.range.includes('12–17') && read.range.includes('1090'),
      read.range,
    );
    const readExpandedSummary =
      (await readCase.locator('.tool-call-inline-summary').first().textContent()) ?? '';
    check(
      `[${width}] read 展开后路径只在预览 meta 里（摘要不重复）`,
      readExpandedSummary.includes('已查看了文件') &&
        !readExpandedSummary.includes('ChatConversationView.tsx'),
      readExpandedSummary,
    );
    await readCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-read.png`,
    });

    // ── 长文件 read：展开态行数上限 + 「显示全部」放开 ──────────────────────
    const readLongCase = page.locator('[data-case="read-long"]');
    await readLongCase.locator('.tool-call-inline').first().click();
    await readLongCase.locator('.file-content-preview').first().waitFor({ timeout: 5_000 });

    const readLong = await readLongCase.evaluate((section) => ({
      renderedLines: section.querySelectorAll('.file-content-line').length,
      toggleText: section.querySelector('.tool-output-toggle')?.textContent ?? '',
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
    }));
    check(
      `[${width}] 长文件 read 默认只渲染 300 行 + 「显示全部」入口`,
      readLong.renderedLines === 300 && readLong.toggleText.includes('显示全部'),
      JSON.stringify(readLong),
    );

    await readLongCase.locator('.tool-output-toggle').first().click();
    const readLongAll = await readLongCase.evaluate((section) => ({
      renderedLines: section.querySelectorAll('.file-content-line').length,
      toggleText: section.querySelector('.tool-output-toggle')?.textContent ?? '',
    }));
    check(
      `[${width}] 长文件 read 点击后放开全部行（可再收起）`,
      readLongAll.renderedLines === 400 && readLongAll.toggleText.includes('收起'),
      JSON.stringify(readLongAll),
    );
    await readLongCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-read-long.png`,
    });

    // ── 目录类工具：list（对象 / 存储 JSON 字符串）──────────────────────────
    const dirMeasurements: Array<
      [string, { sectionClientWidth: number; sectionScrollWidth: number }]
    > = [];
    for (const caseId of ['list-dir', 'list-dir-stored'] as const) {
      const dirCase = page.locator(`[data-case="${caseId}"]`);
      await ensureExpanded(dirCase.locator('.tool-call-block-header').first());
      await dirCase.locator('.tool-call-tree').first().waitFor({ timeout: 5_000 });

      const tree = await dirCase.evaluate((section) => ({
        rowCount: section.querySelectorAll('.tool-call-tree-row').length,
        dirRows: section.querySelectorAll('.tool-call-tree-row[data-kind="dir"]').length,
        hasParamsSection: section.querySelector('.tool-call-block-params') !== null,
        hasRawJson: (section.querySelector('.tool-call-block-body')?.textContent ?? '').includes(
          '"nodes"',
        ),
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      }));
      check(
        `[${width}] ${caseId} 渲染目录树（而非原始 JSON 文本）`,
        tree.rowCount > 0 && tree.dirRows > 0 && !tree.hasRawJson,
        JSON.stringify(tree),
      );
      dirMeasurements.push([caseId, tree]);
      await dirCase.screenshot({
        path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-${caseId}.png`,
      });
    }

    // ── read 命中目录：应显示目录清单语义，而不是「文件 N 行」 ─────────────
    const dirReadCase = page.locator('[data-case="dir-read"]');
    const dirReadSummary =
      (await dirReadCase.locator('.tool-call-inline-summary').first().textContent()) ?? '';
    check(
      `[${width}] read 命中目录的摘要不带行区间`,
      dirReadSummary.includes('src') && !dirReadSummary.includes(':1-4'),
      dirReadSummary,
    );

    await dirReadCase.locator('.tool-call-inline').first().click();
    await dirReadCase.locator('.file-content-preview').first().waitFor({ timeout: 5_000 });

    const dirRead = await dirReadCase.evaluate((section) => ({
      text: (section.querySelector('.file-content-pre')?.textContent ?? '').slice(0, 60),
      range: section.querySelector('.file-content-range')?.textContent ?? '',
      listingMarked: section.querySelector('[data-directory-listing="true"]') !== null,
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
    }));
    check(
      `[${width}] read 命中目录：标注为目录清单（当前形态见截图）`,
      dirRead.listingMarked,
      JSON.stringify(dirRead),
    );
    await dirReadCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-dir-read.png`,
    });

    // ── 创建目录：中文动作 + 路径；无参数区 ─────────────────────────────────
    const createDirCase = page.locator('[data-case="create-dir"]');
    const createDirTitle =
      (await createDirCase.locator('.tool-call-block-title').first().textContent()) ?? '';
    check(
      `[${width}] 创建目录摘要带路径`,
      createDirTitle.includes('已创建了目录') && createDirTitle.includes('tmp/fixtures'),
      createDirTitle,
    );
    await ensureExpanded(createDirCase.locator('.tool-call-block-header').first());
    await createDirCase.locator('.tool-call-confirm').first().waitFor({ timeout: 5_000 });

    const createDir = await createDirCase.evaluate((section) => ({
      confirmText: section.querySelector('.tool-call-confirm-text')?.textContent ?? '',
      hasParams: section.querySelector('.tool-call-block-params') !== null,
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
    }));
    check(
      `[${width}] 创建目录确认行 = 中文动作 + 路径（不透传英文工具名 / 无参数区）`,
      createDir.confirmText.includes('已创建了目录') &&
        createDir.confirmText.includes('tmp/fixtures') &&
        !createDir.confirmText.includes('workspace_create_directory') &&
        !createDir.hasParams,
      JSON.stringify(createDir),
    );
    await createDirCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-create-dir.png`,
    });

    // ── 提问（askuserquestion）：问答对，无分区标签 ──────────────────────────
    const askCase = page.locator('[data-case="ask"]');
    const askSummary =
      (await askCase.locator('.tool-call-inline-summary').first().textContent()) ?? '';
    check(
      `[${width}] 提问摘要 = 已向用户提问（N 题）`,
      askSummary.includes('已向用户提问') && askSummary.includes('2 题'),
      askSummary,
    );

    await askCase.locator('.tool-call-inline').first().click();
    await askCase.locator('.question-answers').first().waitFor({ timeout: 5_000 });

    const ask = await askCase.evaluate((section) => ({
      labels: Array.from(section.querySelectorAll('.tool-call-inline-section-label')).map((el) =>
        (el.textContent ?? '').trim(),
      ),
      questionCount: section.querySelectorAll('.question-answer-q').length,
      chipCount: section.querySelectorAll('.question-answer-chip').length,
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
    }));
    check(
      `[${width}] 提问展开 = 问答对（无分区标签）`,
      ask.labels.length === 0 && ask.questionCount === 2 && ask.chipCount >= 2,
      JSON.stringify(ask),
    );
    await askCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-ask.png`,
    });

    // ── 批量调用：子行有可展开线索 + 展开子行有面板 + 嵌套卡不重复 header ──
    const batchCase = page.locator('[data-case="batch"]');
    const chevrons = await batchCase.locator('.tool-call-batch-child-chevron').evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return { display: style.display, width: el.getBoundingClientRect().width };
      }),
    );
    check(
      `[${width}] 批量子行有可见的展开线索（chevron）`,
      chevrons.length > 0 && chevrons.every((c) => c.display !== 'none' && c.width > 0),
      JSON.stringify(chevrons),
    );

    await batchCase.locator('.tool-call-batch-child-row').first().click();
    await batchCase.locator('.tool-call-batch-child-detail').first().waitFor({ timeout: 5_000 });

    const batch = await batchCase.evaluate((section) => {
      const detail = section.querySelector<HTMLElement>('.tool-call-batch-child-detail');
      const nestedBlock = detail?.querySelector<HTMLElement>('[data-tool-card-bash-block]');
      return {
        detailPaddingLeft: detail ? getComputedStyle(detail).paddingLeft : '',
        detailBackground: detail ? getComputedStyle(detail).backgroundColor : '',
        nestedBlockBackground: nestedBlock ? getComputedStyle(nestedBlock).backgroundColor : '',
        nestedHeaders: detail?.querySelectorAll('.tool-call-block-header').length ?? -1,
        nestedInlineRows: detail?.querySelectorAll('.tool-call-inline').length ?? -1,
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] 批量子行展开只做缩进，内容块自带表面`,
      batch.detailPaddingLeft === '12px' &&
        isTransparent(batch.detailBackground) &&
        !isTransparent(batch.nestedBlockBackground),
      JSON.stringify({
        paddingLeft: batch.detailPaddingLeft,
        detailBg: batch.detailBackground,
        nestedBg: batch.nestedBlockBackground,
      }),
    );
    check(
      `[${width}] 批量子行展开不再重复嵌套卡 header`,
      batch.nestedHeaders === 0,
      `nestedHeaders=${batch.nestedHeaders}`,
    );
    await batchCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-batch.png`,
    });

    // ── Bash 执行中：等待态 + 光标 + 完整命令 ──────────────────────────────
    const runningCase = page.locator('[data-case="bash-running"]');
    await ensureExpanded(runningCase.locator('.tool-call-block-header').first());
    await runningCase
      .locator('[data-tool-card-terminal-running]')
      .first()
      .waitFor({ timeout: 5_000 });

    const runningState = await runningCase.evaluate((section) => {
      const waitRow = section.querySelector<HTMLElement>('[data-tool-card-terminal-running]');
      const cursor = section.querySelector<HTMLElement>('[data-tool-card-terminal-cursor]');
      const command = section.querySelector<HTMLElement>('[data-tool-card-bash-command]');
      return {
        waitText: waitRow?.textContent ?? '',
        cursorWidth: cursor?.getBoundingClientRect().width ?? 0,
        commandText: command?.textContent ?? '',
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] bash 执行中显示等待态 + 闪烁光标`,
      runningState.waitText.includes('等待输出') && runningState.cursorWidth > 0,
      JSON.stringify(runningState),
    );
    check(
      `[${width}] bash 执行中仍显示完整命令`,
      runningState.commandText.includes('bun run --filter @openAwork/web build'),
      runningState.commandText,
    );
    await runningCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-bash-running.png`,
    });

    // ── 单条 bash 实时输出：live 输出渲染 + 自动贴底 ────────────────────────
    const bashLiveCase = page.locator('[data-case="bash-live"]');
    await ensureExpanded(bashLiveCase.locator('.tool-call-block-header').first());
    await bashLiveCase
      .locator('[data-tool-card-terminal-output-panel]')
      .first()
      .waitFor({ timeout: 5_000 });

    const bashLive = await bashLiveCase.evaluate((section) => {
      const panel = section.querySelector<HTMLElement>('[data-tool-card-terminal-output-panel]');
      const terminal = section.querySelector<HTMLElement>('[data-tool-card-bash-terminal]');
      const params = section.querySelector('.tool-call-block-params');
      return {
        scrollTop: panel?.scrollTop ?? -1,
        scrollHeight: panel?.scrollHeight ?? -1,
        clientHeight: panel?.clientHeight ?? -1,
        terminalRunning: terminal?.getAttribute('data-terminal-running') ?? '',
        hasParams: params !== null,
        hasLiveCursor: section.querySelector('[data-tool-card-terminal-live-cursor]') !== null,
        text: (panel?.textContent ?? '').slice(-48),
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] 单条 bash 实时输出自动贴底（真实时 stdout）`,
      bashLive.terminalRunning === 'true' &&
        bashLive.scrollHeight > bashLive.clientHeight &&
        bashLive.scrollTop + bashLive.clientHeight >= bashLive.scrollHeight - 2,
      JSON.stringify({
        running: bashLive.terminalRunning,
        scrollTop: bashLive.scrollTop,
        scrollHeight: bashLive.scrollHeight,
        clientHeight: bashLive.clientHeight,
      }),
    );
    check(`[${width}] 单条 bash 实时输出不展示入参`, !bashLive.hasParams);
    check(`[${width}] bash 运行中带终端块光标（跟在最后一行输出后）`, bashLive.hasLiveCursor);
    await bashLiveCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-bash-live.png`,
    });

    // ── batch 子行实时输出：运行中徽标 + 自动贴底 ──────────────────────────
    const liveCase = page.locator('[data-case="batch-live"]');
    await liveCase.locator('.tool-call-batch-child-row').first().click();
    await liveCase
      .locator('[data-tool-card-terminal-output-panel]')
      .first()
      .waitFor({ timeout: 5_000 });

    const live = await liveCase.evaluate((section) => {
      const panel = section.querySelector<HTMLElement>('[data-tool-card-terminal-output-panel]');
      const terminal = section.querySelector<HTMLElement>('[data-tool-card-bash-terminal]');
      return {
        scrollTop: panel?.scrollTop ?? -1,
        scrollHeight: panel?.scrollHeight ?? -1,
        clientHeight: panel?.clientHeight ?? -1,
        terminalRunning: terminal?.getAttribute('data-terminal-running') ?? '',
        tail: (panel?.textContent ?? '').slice(-48),
        sectionScrollWidth: section.scrollWidth,
        sectionClientWidth: section.clientWidth,
      };
    });
    check(
      `[${width}] batch 子行实时输出自动贴底（终端观感）`,
      live.scrollHeight > live.clientHeight &&
        live.scrollTop + live.clientHeight >= live.scrollHeight - 2,
      JSON.stringify({
        scrollTop: live.scrollTop,
        scrollHeight: live.scrollHeight,
        clientHeight: live.clientHeight,
      }),
    );
    check(
      `[${width}] batch 子行实时输出处于运行中（data-terminal-running）`,
      live.terminalRunning === 'true',
      `data-terminal-running=${live.terminalRunning}`,
    );
    await liveCase.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-batch-live.png`,
    });

    // ── 横向溢出（各类卡片所在容器都不得溢出）────────────────────────────
    const overflowCases: Array<
      [string, { sectionClientWidth: number; sectionScrollWidth: number }]
    > = [
      ['bash', bash],
      ['edit', edit],
      ['patch', patch],
      ['write', write],
      ['split-diff', split],
      ['read', read],
      ['read-long', readLong],
      ['batch', batch],
      ['bash-running', runningState],
      ['bash-live', bashLive],
      ['batch-live', live],
      ...dirMeasurements,
      ['dir-read', dirRead],
      ['create-dir', createDir],
      ['ask', ask],
    ];
    for (const [caseId, measured] of overflowCases) {
      check(
        `[${width}] ${caseId} 卡片无横向溢出`,
        measured.sectionScrollWidth <= measured.sectionClientWidth + 1,
        `scrollWidth=${measured.sectionScrollWidth} clientWidth=${measured.sectionClientWidth}`,
      );
    }

    const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      `[${width}] 页面无横向溢出`,
      docScrollWidth <= width + 1,
      `scrollWidth=${docScrollWidth}`,
    );

    await page.screenshot({
      path: `/tmp/opencode/tool-expansion${SHOT_SUFFIX}-${width}-full.png`,
      fullPage: true,
    });
  }
} finally {
  await browser.close();
}

console.log(`\n工具卡展开可视化验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
