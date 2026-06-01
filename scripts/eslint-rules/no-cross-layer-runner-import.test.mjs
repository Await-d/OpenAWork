/**
 * no-cross-layer-runner-import 规则的自测（ESLint 9 RuleTester / flat config）。
 *
 * 运行：node scripts/eslint-rules/no-cross-layer-runner-import.test.mjs
 * 退出码 0 = 全部通过；非 0 = 失败（可接入 CI）。
 *
 * 覆盖：
 *   - 跨层静态 import → 报错（c 层 import d 层 runner）
 *   - 跨层动态 import() → 报错（最易被复制扩散的绕过点）
 *   - 跨层 export ... from → 报错
 *   - 同层 import → 放行（pm1-runner ↔ artifact-chain）
 *   - 受控编排器例外 → 放行（watcher / pm1-runner 分发器）
 *   - 受控通道 import → 放行（handoff-store / inbound-store / substate-store / 事件总线）
 *   - 非 runner 路径 → 放行
 */

import { RuleTester } from 'eslint';
import plugin from './no-cross-layer-runner-import.mjs';

const rule = plugin.rules['no-cross-layer-runner-import'];

const RUNNER_DIR = '/repo/services/agent-gateway/src/handoff/runner';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-cross-layer-runner-import', rule, {
  valid: [
    // 同层：pm1-runner（c）import artifact-chain（c）
    {
      filename: `${RUNNER_DIR}/pm1-runner.ts`,
      code: `import { runArtifactChain } from './artifact-chain.js';`,
    },
    // 同层：reception-orchestrator（b）import reception-router（b）
    {
      filename: `${RUNNER_DIR}/reception-orchestrator.ts`,
      code: `import { routeByRules } from './reception-router.js';`,
    },
    // 受控编排器例外：watcher 可引用 pm2 层的 reconciler
    {
      filename: `${RUNNER_DIR}/watcher.ts`,
      code: `import { reconcilePm2QualityReview } from './pm2-quality-review-reconciler.js';`,
    },
    // 受控编排器例外：pm1-runner 分发器动态加载 pm2-runner（createPhaseCAwareRunner）
    {
      filename: `${RUNNER_DIR}/pm1-runner.ts`,
      code: `async function f(){ const { createPm2Runner } = await import('./pm2-runner.js'); return createPm2Runner; }`,
    },
    // 受控通道：任意 runner 走 store/bus（这些不是同目录 runner，路径不匹配 './xxx'）
    {
      filename: `${RUNNER_DIR}/artifact-chain.ts`,
      code: `import { createHandoff } from '../store/handoff-store.js';\nimport { submitInboundMessage } from '../store/inbound-store.js';\nimport { setSubstate } from '../store/substate-store.js';\nimport { publishHandoffEvent } from '../bus/team-events-bus.js';`,
    },
    // 非 runner 路径：完全放行
    {
      filename: `/repo/services/agent-gateway/src/routes/team.ts`,
      code: `import { x } from './pm2-runner.js';`,
    },
  ],
  invalid: [
    // 跨层静态 import：artifact-chain（c）import pm2-runner（d）
    {
      filename: `${RUNNER_DIR}/artifact-chain.ts`,
      code: `import { createPm2Runner } from './pm2-runner.js';`,
      errors: [{ messageId: 'crossLayer' }],
    },
    // 跨层动态 import()：reception-orchestrator（b）import pm2-runner（d）
    {
      filename: `${RUNNER_DIR}/reception-orchestrator.ts`,
      code: `async function f(){ await import('./pm2-runner.js'); }`,
      errors: [{ messageId: 'crossLayer' }],
    },
    // 跨层 export ... from：pm2-runner（d）re-export reception-router（b）
    {
      filename: `${RUNNER_DIR}/pm2-runner.ts`,
      code: `export { routeByRules } from './reception-router.js';`,
      errors: [{ messageId: 'crossLayer' }],
    },
    // 跨层静态 import：reception-router（b）import artifact-chain（c）
    {
      filename: `${RUNNER_DIR}/reception-router.ts`,
      code: `import { runArtifactChain } from './artifact-chain.js';`,
      errors: [{ messageId: 'crossLayer' }],
    },
  ],
});

console.log('no-cross-layer-runner-import: all RuleTester cases passed');
