// @ts-check
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactCompiler from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * apps/web 专属 ESLint 配置 —— 独立于仓库根的 `eslint.config.js`。
 *
 * ## 为什么不直接加进根配置
 *
 * 根 `eslint.config.js` 的 ignores 里显式排除了 `apps/web/**`（阶段性策略，
 * 见 `AGENTS.md`「禁止事项」）。把 apps/web 并入根配置会一次性启用整套 TS
 * 规则集，等于「web lint 全量重启」，风险和工作量都远超本次目标。
 *
 * 本文件因此**只启用 React Compiler 相关规则**：它的作用不是风格检查，而是
 * 拦住会让组件退出编译器优化的反模式——这类问题在构建期是静默发生的，
 * 不会报错、不会中断构建，只会让组件失去自动 memoization。
 *
 * ## 能力边界（实测结论，不要假设它更全）
 *
 * 1. **口径不同**：规则只上报严重级为 `InvalidReact` / `InvalidJS` 的诊断。
 *    实测同一份代码，规则只报 25 处，而构建期有 390 个函数脱靶——编译器自身
 *    的能力缺口（try/catch 语块等）规则并不上报。
 *
 * 2. **版本不同代**：本插件捆绑的编译器与构建链路实际使用的
 *    `babel-plugin-react-compiler@1.0.0` 不是同一代，诊断严重级取值体系都不同
 *    （前者 `InvalidReact` / `InvalidJS`，后者 `Error` / `Warning` / `Hint` / `Off`）。
 *    该插件目前只有 `19.1.0-rc.2` 这一个可用版本，没有与编译器 1.0.0 对齐的稳定版。
 *
 * 3. **存在已知盲区**：规则**无法发现**「ref 按名字推断」这一类。
 *    实测 `ref={props.anchorRef}` 这种纯传递写法会让构建期组件整体脱靶
 *    （报 Cannot access refs during render），而规则一行都不报——即使按规则选项
 *    把 `environment.enableTreatRefLikeIdentifiersAsRefs` 显式设为 `true` 也无变化。
 *    该类只能靠 `bun run check:react-compiler` 发现。
 *
 * 所以：**判定某文件能否清理手写 memo，只以运行时报表为准**。
 *
 * ## 棘轮策略
 *
 * 存量违规文件列在 `LEGACY_VIOLATIONS` 中并降级为 `warn`：保持可见（改动时
 * 能顺手清理），但不阻塞提交（否则 25 个高频编辑文件会立刻卡住所有人的 commit）。
 * 其余文件一律 `error`。修好某个文件后请把它从清单里删掉（注释掉并注明原因）。
 *
 * 重新生成清单：
 *   bun run --filter @openAwork/web lint -- --format=json -o /tmp/lint.json
 * 然后取 `messages` 非空的源文件（排除测试文件）。
 *
 * 用法：`bun run --filter @openAwork/web lint`
 */

/**
 * 存量违规清单（棘轮豁免）——**2026-10-14 已清空**。
 *
 * 设计意图（保留备查）：把当时尚未修复的文件列在这里并降级为 `warn`——保持可见
 * （改动时能顺手清理），但不阻塞提交（否则会立刻卡住所有人的 commit）。每一条都是
 * **真实待还的技术债**，不是误报：要么违反了 Rules of React（改写 props / 参数、
 * 渲染期读写 ref、条件调用 Hook 等），要么用 `eslint-disable react-hooks/*` 注释把
 * 编译器整体挡在门外。
 *
 * 重新生成清单：
 *   bun run --filter @openAwork/web lint -- --format=json -o /tmp/lint.json
 * 然后取 `messages` 非空的源文件（排除测试文件）。
 *
 * 本次清空的方式：原 16 个文件的违规全是「改写 props / 参数派生值的 ref 写入」与
 * 「从 props / 返回值的 ref 取出元素后写 DOM」，统一按「写入收敛到模块函数」修掉
 * （`src/utils/ref/ref-current.ts`、`src/utils/dom/scroll.ts`；同源先例见
 * `src/pages/chat-page/conversation/render/use-chat-render-data.ts` 的
 * `writeHistoricalEntryCache`）。棘轮块随之移除，新违规一律按 `error` 拦截。
 *
 * 若将来又攒下需要分批偿还的存量违规，恢复「`LEGACY_VIOLATIONS` 数组 + 一个
 * `files: LEGACY_VIOLATIONS` 且规则降级为 `warn` 的配置块」即可（注意 ESLint 的
 * `files` 不允许为空数组，空清单时该块必须整体删掉）。
 *
 * 历史记录（更早批次已修复的条目）：
 * - `src/pages/team/runtime/tabs/overview/OverviewTab.tsx` —— 条件调用 Hook（已改为
 *   「外层只做分支路由 + OverviewTabContent 承载全部 hook」）
 * - `src/pages/team/runtime/shell/sidebar/use-team-file-preview.ts` —— 已补全 deps
 * - `src/pages/team/runtime/tabs/tasks/ArtifactMarkers.tsx` —— 已改为 matchAll
 * - `src/App.tsx` / `src/hooks/editor/useFileEditor.ts` /
 *   `src/pages/chat-page/conversation/use-chat-conversation-state.ts` /
 *   `src/pages/sessions-page/SessionsPage.tsx` /
 *   `src/pages/team/conversation/extras/TeamMultiLayerFeed.tsx` /
 *   `src/pages/team/conversation/extras/use-team-init-checklist.ts` /
 *   `src/pages/team/conversation/use-team-conversation-state-providers.ts` /
 *   `src/pages/team/views/TeamTemplatesPage.tsx` —— 2026-10-14 批次移出
 */

const APP_SOURCES = ['src/**/*.{ts,tsx}'];

export default [
  {
    files: APP_SOURCES,
    // 测试文件不纳入：它们不参与打包，性能无关，且测试脚手架里改写外部变量
    // 属于常见写法——纳入只会制造难以消除的噪音。实测这一步可从 30 处降到 25 处。
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      // 关掉「未使用的 eslint-disable 注释」上报。
      //
      // 本配置只启用了 react-compiler 一条规则，而源码里存在针对
      // `react-hooks/exhaustive-deps`、`no-console` 等规则的 disable 注释。
      // 在「这些规则根本没被启用」的前提下，ESLint 会判定注释未被使用并逐条告警——
      // 这是本配置的产物，不是代码缺陷，留着只会淹没真正的信号。
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      'react-compiler': reactCompiler,
      // 以下两个插件**不启用任何规则**，只做「规则名登记」。
      //
      // 源码里的 disable 注释引用了 `react-hooks/exhaustive-deps` 与
      // `@typescript-eslint/no-use-before-define`。若对应插件未注册，ESLint 会对
      // 每条注释报 `Definition for rule ... was not found`。登记后注释可被正常
      // 解析——而 react-compiler 规则恰好会针对**这些被抑制的注释**给出提示
      // （历史上这类注释会让组件整体退出编译器优化，如 ChatPage.tsx；
      // 2026-10-14 已按 apps/web/AGENTS.md 的做法清掉 9 处）。
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      'react-compiler/react-compiler': 'error',
    },
  },
];
