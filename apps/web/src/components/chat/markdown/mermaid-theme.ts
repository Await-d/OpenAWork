import {
  FALLBACK_CHART_PALETTE,
  formatCssColor,
  mixColors,
  pickReadableColor,
  resolveColor,
  type MarkdownThemeTokens,
  type RgbaColor,
} from './theme-tokens.js';

/**
 * 由应用主题 token 生成 Mermaid 的 `themeVariables` / `themeCSS`。
 *
 * 为什么不直接用 mermaid 内置的 dark / default 主题：
 * 应用有 8 套主题风格 × 明暗模式，而 mermaid 只有「默认」和「深色」两档，
 * 于是 aurora 的靛蓝界面里会冒出一张紫色流程图、sakura 的粉调界面里
 * 会冒出一张蓝灰流程图。这里改成用主题变量派生出整套图表色板，
 * 让图形与所在主题属于同一套配色语言。
 *
 * 关键约束（读取 mermaid 源码确认过）：
 * - `theme: 'base'` 时用户传入的 themeVariables 会在内置推导之后被**重新覆盖**，
 *   因此这里给的值就是最终值，不会又被 darken/lighten 改掉；
 * - themeVariables 会被 khroma 做颜色运算，只能给 hex / rgb() / rgba()
 *   这类可解析的绝对颜色，不能给 `var(--x)` 或 `color-mix(...)`；
 * - `themeCSS` 会被拼在图表自身样式之后，同等特异性即可覆盖。
 */

export interface MermaidThemeConfig {
  /** 供 mermaid 内部推导其余派生色使用。 */
  darkMode: boolean;
  themeVariables: Record<string, string>;
  themeCSS: string;
}

/** 与正文一致的字体栈（与应用内其他等宽/正文字体保持一致）。 */
export const MERMAID_FONT_STACK =
  '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/** 大色块（思维导图分支、象限图）在画布底色上的混入比例。 */
const AREA_MIX = { dark: 0.38, light: 0.24 } as const;
/** 中小色块（饼图扇区、git 提交点、旅程图）在画布底色上的混入比例。 */
const CHIP_MIX = { dark: 0.56, light: 0.36 } as const;

export function buildMermaidTheme(tokens: MarkdownThemeTokens): MermaidThemeConfig {
  const isDark = tokens.mode === 'dark';

  const bgBase = resolveColor(tokens.bgBase, '#0b1020');
  const canvas = resolveColor(tokens.bgRaised, '#0f1428');
  const bgOverlay = resolveColor(tokens.bgOverlay, '#141a33');
  const bgSurface = resolveColor(tokens.bgSurface, '#1a2140');
  const bgElevated = resolveColor(tokens.bgElevated, '#212a4d');

  const fgStrong = resolveColor(tokens.fgStrong, '#f2f4ff');
  const fgDefault = resolveColor(tokens.fgDefault, '#c3c9e8');
  const fgMuted = resolveColor(tokens.fgMuted, '#8b93bd');
  const fgSubtle = resolveColor(tokens.fgSubtle, '#5c6490');
  const fgOnAccent = resolveColor(tokens.fgOnAccent, '#0b1020');

  const accent = resolveColor(tokens.accent, '#7c8cff');
  const accentHover = resolveColor(tokens.accentHover, '#9aa6ff');
  const accentBorder = resolveColor(tokens.accentBorder, 'rgba(124, 140, 255, 0.4)');
  const contrast = resolveColor(tokens.contrast, '#a06bff');
  const contrastBorder = resolveColor(tokens.contrastBorder, 'rgba(160, 107, 255, 0.4)');
  const complement = resolveColor(tokens.complement, '#ff6f9c');
  const aux = resolveColor(tokens.aux, '#3aa0ff');

  const borderSubtle = resolveColor(tokens.borderSubtle, 'rgba(255, 255, 255, 0.06)');
  const borderDefault = resolveColor(tokens.borderDefault, 'rgba(255, 255, 255, 0.1)');
  const borderStrong = resolveColor(tokens.borderStrong, 'rgba(255, 255, 255, 0.24)');

  // 节点 / 连线基础色：统一从画布底色向强调色混，保证与所在主题同源。
  const nodeFill = mixColors(bgElevated, accent, isDark ? 0.34 : 0.22);
  const nodeBorder = mixColors(bgElevated, accent, isDark ? 0.72 : 0.55);
  const nodeText = pickReadableColor(nodeFill, fgStrong, bgBase);

  const altFill = mixColors(bgElevated, contrast, isDark ? 0.34 : 0.22);
  const altBorder = mixColors(bgElevated, contrast, isDark ? 0.7 : 0.52);
  const altText = pickReadableColor(altFill, fgStrong, bgBase);

  const tertiaryFill = mixColors(bgSurface, aux, isDark ? 0.24 : 0.16);
  const tertiaryBorder = mixColors(bgSurface, aux, isDark ? 0.58 : 0.42);

  const noteFill = mixColors(bgSurface, aux, isDark ? 0.3 : 0.2);
  const noteBorder = mixColors(bgSurface, aux, isDark ? 0.62 : 0.46);

  const lineColor = mixColors(canvas, fgMuted, isDark ? 0.72 : 0.58);
  const edgeLabelBg = mixColors(canvas, bgSurface, 0.55);
  const clusterBkg = mixColors(canvas, bgOverlay, 0.72);
  const sectionFill = mixColors(canvas, accent, isDark ? 0.16 : 0.1);
  const sectionFill2 = mixColors(canvas, contrast, isDark ? 0.16 : 0.1);

  const chartColors = readChartPalette(tokens);
  const areaPalette = chartColors.map((color) =>
    mixColors(canvas, color, isDark ? AREA_MIX.dark : AREA_MIX.light),
  );
  const chipPalette = chartColors.map((color) =>
    mixColors(canvas, color, isDark ? CHIP_MIX.dark : CHIP_MIX.light),
  );

  // 思维导图 / 看板的分支色板固定 12 档：8 个主题图表色 + 4 个与对比色再混出的补充色。
  const branchPalette = buildBranchPalette(areaPalette, contrast, isDark);
  const branchLabels = branchPalette.map((fill) => pickReadableColor(fill, fgStrong, bgBase));

  const color = (value: RgbaColor): string => formatCssColor(value);

  const themeVariables: Record<string, string> = {
    darkMode: isDark ? 'true' : 'false',
    background: color(canvas),
    fontFamily: MERMAID_FONT_STACK,
    fontSize: '13px',

    // ── 通用节点 ──────────────────────────────────────────
    primaryColor: color(nodeFill),
    primaryTextColor: color(nodeText),
    primaryBorderColor: color(nodeBorder),
    secondaryColor: color(altFill),
    secondaryTextColor: color(altText),
    secondaryBorderColor: color(altBorder),
    tertiaryColor: color(tertiaryFill),
    tertiaryTextColor: color(fgDefault),
    tertiaryBorderColor: color(tertiaryBorder),

    mainBkg: color(nodeFill),
    nodeBkg: color(nodeFill),
    nodeBorder: color(nodeBorder),
    nodeTextColor: color(nodeText),
    textColor: color(fgDefault),
    titleColor: color(fgStrong),
    lineColor: color(lineColor),
    defaultLinkColor: color(lineColor),
    arrowheadColor: color(lineColor),
    edgeLabelBackground: color(edgeLabelBg),
    border2: color(borderDefault),
    flowContainerStroke: color(accentBorder),
    clusterBkg: color(clusterBkg),
    clusterBorder: color(borderDefault),

    // ── 时序图 ────────────────────────────────────────────
    actorBkg: color(nodeFill),
    actorBorder: color(nodeBorder),
    actorTextColor: color(nodeText),
    actorLineColor: color(lineColor),
    signalColor: color(fgDefault),
    signalTextColor: color(fgDefault),
    labelBoxBkgColor: color(tertiaryFill),
    labelBoxBorderColor: color(tertiaryBorder),
    labelTextColor: color(fgDefault),
    loopTextColor: color(fgDefault),
    activationBkgColor: color(altFill),
    activationBorderColor: color(altBorder),
    sequenceNumberColor: color(nodeText),
    noteBkgColor: color(noteFill),
    noteTextColor: color(fgStrong),
    noteBorderColor: color(noteBorder),

    // ── 状态图 ────────────────────────────────────────────
    stateBkg: color(nodeFill),
    stateLabelColor: color(nodeText),
    labelBackgroundColor: color(edgeLabelBg),
    transitionColor: color(lineColor),
    transitionLabelColor: color(fgMuted),
    compositeBackground: color(clusterBkg),
    altBackground: color(tertiaryFill),
    compositeTitleBackground: color(bgSurface),
    compositeBorder: color(borderDefault),
    innerEndBackground: color(fgSubtle),
    specialStateColor: color(accent),
    errorBkgColor: color(complement),
    errorTextColor: color(fgStrong),

    // ── 甘特图 ────────────────────────────────────────────
    sectionBkgColor: color(sectionFill),
    sectionBkgColor2: color(sectionFill2),
    altSectionBkgColor: color(canvas),
    excludeBkgColor: color(bgOverlay),
    gridColor: color(borderSubtle),
    vertLineColor: color(borderSubtle),
    taskBkgColor: color(accent),
    taskBorderColor: color(accentHover),
    taskTextColor: color(fgOnAccent),
    taskTextLightColor: color(fgStrong),
    taskTextDarkColor: color(fgOnAccent),
    taskTextOutsideColor: color(fgDefault),
    taskTextClickableColor: color(accent),
    activeTaskBkgColor: color(contrast),
    activeTaskBorderColor: color(contrastBorder),
    doneTaskBkgColor: color(bgSurface),
    doneTaskBorderColor: color(borderStrong),
    doneTaskTextColor: color(fgMuted),
    critBkgColor: color(complement),
    critBorderColor: color(complement),
    todayLineColor: color(complement),
    rowOdd: color(bgOverlay),
    rowEven: color(canvas),
    personBorder: color(borderDefault),
    personBkg: color(nodeFill),

    // ── 类图 / ER 图 ───────────────────────────────────────
    classText: color(fgDefault),
    attributeBackgroundColorOdd: color(bgOverlay),
    attributeBackgroundColorEven: color(canvas),
    relationColor: color(lineColor),
    relationLabelBackground: color(edgeLabelBg),
    relationLabelColor: color(fgMuted),

    // ── 需求图 ────────────────────────────────────────────
    requirementBackground: color(nodeFill),
    requirementBorderColor: color(nodeBorder),
    requirementTextColor: color(nodeText),
    requirementBorderSize: '1',

    // ── 饼图 / 集合图 ──────────────────────────────────────
    pieTitleTextColor: color(fgStrong),
    pieSectionTextColor: color(fgStrong),
    pieLegendTextColor: color(fgDefault),
    pieStrokeColor: color(bgBase),
    pieOuterStrokeColor: color(borderDefault),
    pieOpacity: '1',
    vennTitleTextColor: color(fgStrong),
    vennSetTextColor: color(fgDefault),
    cynefin: color(areaPalette[0] ?? accent),
    radar: color(areaPalette[2] ?? aux),

    // ── 旅程图 ────────────────────────────────────────────
    fillType0: color(chipPalette[0] ?? accent),
    fillType1: color(chipPalette[1] ?? contrast),
    fillType2: color(chipPalette[2] ?? aux),
    fillType3: color(chipPalette[3] ?? complement),
    fillType4: color(chipPalette[4] ?? accent),
    fillType5: color(chipPalette[5] ?? contrast),
    fillType6: color(chipPalette[6] ?? aux),
    fillType7: color(chipPalette[7] ?? complement),

    // ── 象限图 ────────────────────────────────────────────
    quadrant1Fill: color(mixColors(canvas, chartColors[0] ?? accent, isDark ? 0.22 : 0.14)),
    quadrant2Fill: color(mixColors(canvas, chartColors[1] ?? contrast, isDark ? 0.22 : 0.14)),
    quadrant3Fill: color(mixColors(canvas, chartColors[2] ?? aux, isDark ? 0.22 : 0.14)),
    quadrant4Fill: color(mixColors(canvas, chartColors[3] ?? complement, isDark ? 0.22 : 0.14)),
    quadrant1TextFill: color(fgDefault),
    quadrant2TextFill: color(fgDefault),
    quadrant3TextFill: color(fgDefault),
    quadrant4TextFill: color(fgDefault),
    quadrantPointFill: color(accent),
    quadrantPointTextFill: color(fgStrong),
    quadrantXAxisTextFill: color(fgMuted),
    quadrantYAxisTextFill: color(fgMuted),
    quadrantInternalBorderStrokeFill: color(borderDefault),
    quadrantExternalBorderStrokeFill: color(borderStrong),
    quadrantTitleFill: color(fgStrong),

    // ── Git 图 ────────────────────────────────────────────
    branchLabelColor: color(fgDefault),
    tagLabelColor: color(fgDefault),
    tagLabelBackground: color(bgSurface),
    tagLabelBorder: color(borderDefault),
    commitLabelColor: color(fgMuted),
    commitLabelBackground: color(bgOverlay),

    // ── 架构图 ────────────────────────────────────────────
    archEdgeColor: color(lineColor),
    archEdgeArrowColor: color(lineColor),
    archGroupBorderColor: color(borderDefault),
    archGroupBorderWidth: '1px',

    // ── 分支色阶（思维导图 / 看板）────────────────────────
    scaleLabelColor: color(fgStrong),
  };

  for (let index = 0; index < 12; index += 1) {
    themeVariables[`cScale${index}`] = color(branchPalette[index] ?? nodeFill);
    themeVariables[`cScaleLabel${index}`] = color(branchLabels[index] ?? fgStrong);
  }

  const pieKeys = ['pie1', 'pie2', 'pie3', 'pie4', 'pie5', 'pie6', 'pie7', 'pie8'];
  pieKeys.forEach((key, index) => {
    themeVariables[key] = color(chipPalette[index] ?? accent);
  });

  const gitKeys = ['git0', 'git1', 'git2', 'git3', 'git4', 'git5', 'git6', 'git7'];
  gitKeys.forEach((key, index) => {
    themeVariables[key] = color(chipPalette[index] ?? accent);
    themeVariables[`gitBranchLabel${index}`] = color(branchLabels[index] ?? fgStrong);
    themeVariables[`gitInv${index}`] = color(
      pickReadableColor(chipPalette[index] ?? accent, fgStrong, bgBase),
    );
  });

  return {
    darkMode: isDark,
    themeVariables,
    themeCSS: buildThemeCss(edgeLabelBg, borderDefault),
  };
}

/** 读取主题 8 色图表色板，缺失项用兜底色补足。 */
function readChartPalette(tokens: MarkdownThemeTokens): RgbaColor[] {
  return FALLBACK_CHART_PALETTE.map((fallback, index) =>
    resolveColor(tokens.chart[index] ?? fallback, fallback),
  );
}

/**
 * 12 档分支色：前 8 档沿用主题图表色，后 4 档在图表色上再叠一层对比色，
 * 避免 12 个分支出现明显重复。
 */
function buildBranchPalette(
  areaPalette: RgbaColor[],
  contrast: RgbaColor,
  isDark: boolean,
): RgbaColor[] {
  const palette: RgbaColor[] = [...areaPalette];

  for (let index = 0; index < 4; index += 1) {
    const source = areaPalette[index] ?? contrast;
    const shifted = mixColors(source, contrast, 0.32);
    // 深色主题下略微提亮，保证第 9 ~ 12 档与前面的色块仍有区分度。
    palette.push(isDark ? mixColors(shifted, contrast, 0.12) : mixColors(shifted, contrast, 0.2));
  }

  while (palette.length < 12) {
    palette.push(areaPalette[palette.length % areaPalette.length] ?? contrast);
  }

  return palette.slice(0, 12);
}

/**
 * 图表结构上的细节打磨。这里只做「外观微调」，颜色一律交给 themeVariables，
 * 避免两套着色逻辑互相打架。
 */
function buildThemeCss(edgeLabelBg: RgbaColor, border: RgbaColor): string {
  return [
    `.node rect, .node polygon, .node circle, .node ellipse { rx: 6px; ry: 6px; }`,
    `.cluster rect { rx: 9px; ry: 9px; }`,
    `.cluster-label, .cluster-label span { font-weight: 600; }`,
    `.edgeLabel rect { rx: 5px; ry: 5px; fill: ${formatCssColor(edgeLabelBg)}; stroke: ${formatCssColor(border)}; }`,
    `.nodeLabel, .edgeLabel, .nodeLabel p, .edgeLabel p { line-height: 1.45; }`,
    `.edgePath .path, .flowchart-link { stroke-linecap: round; }`,
    `.mindmap-node > * { stroke-width: 1.5px; }`,
    `text, tspan { text-rendering: geometricPrecision; }`,
  ].join('\n');
}
