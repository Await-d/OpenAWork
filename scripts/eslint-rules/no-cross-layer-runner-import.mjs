/**
 * 自定义 ESLint 规则：no-cross-layer-runner-import
 *
 * 用途（L1.4 跨层禁止直连的静态护栏）：
 *   团队五层架构（a/b/c/d/e-g）的层间通信必须只走「handoff 协议 + 反向消息通道 +
 *   substate + 事件总线」这套受控通道，**严禁**某一层的 runner 直接 import 另一层的
 *   runner 来绕过协议。详见：
 *     - docs/architecture/team-architecture-l1-baseline.md §L1.4
 *     - docs/architecture/team-architecture-l1-3-streaming-handoff-spec.md
 *
 * 不变量：
 *   `services/agent-gateway/src/handoff/runner/` 下的 runner 文件之间，禁止跨「层」
 *   直接 import（含静态 `import ... from` 与动态 `await import()`）。
 *
 * 受控通道（允许，不受本规则限制）：
 *   - `../store/handoff-store`（createHandoff / complete / fail —— 派发协议）
 *   - `../store/inbound-store`（submitInboundMessage —— 反向消息通道）
 *   - `../store/substate-store`（setSubstate —— 子状态机）
 *   - `../bus/team-events-bus`（publishHandoffEvent / publishTeamEvent —— 事件）
 *
 * 受控编排例外（白名单文件，允许引用其它层 runner）：
 *   - `watcher.ts`：守护进程，claim handoff 后按 toRoleLayer 分发，并协调质量评审。
 *   - `pm1-runner.ts`：承载 `createPhaseCAwareRunner` 分发器，按 toRoleLayer 选择 runner。
 *   - `scheduler.ts`：纯任务调度，不感知层语义。
 *
 * 同层组合（允许）：
 *   - `pm1-runner` ↔ `artifact-chain`（同属 c 层）
 *   - `reception-orchestrator` ↔ `reception-router`（同属 b 层）
 *
 * 设计要点：
 *   - 规则按「文件 → 所属层」与「被引用模块 → 所属层」做判定，跨层即报错。
 *   - 同时覆盖静态 import 与动态 import()，因为分发器正是用动态 import 加载下游层，
 *     这恰恰是最容易被无意复制扩散的绕过点。
 *   - 白名单是「编排器」而非「业务层」，新增白名单应走架构 review（L1.4 §escape hatch）。
 */

/** runner 文件名（不含扩展名）→ 所属运行层。 */
const RUNNER_LAYER = {
  'reception-orchestrator': 'reception',
  'reception-router': 'reception',
  'pm1-runner': 'pm1',
  'artifact-chain': 'pm1',
  'pm2-runner': 'pm2',
  'pm2-quality-review-reconciler': 'pm2',
};

/**
 * 允许跨层引用其它 runner 的「编排器」白名单（文件名，不含扩展名）。
 * 这些文件是受控编排点，不是业务层 runner。
 */
const ORCHESTRATOR_ALLOWLIST = new Set(['watcher', 'pm1-runner', 'scheduler']);

/** 从 import 路径里抽出 runner 模块名（仅当它指向同目录下的 runner 文件时）。 */
function resolveRunnerModuleName(importPath) {
  if (typeof importPath !== 'string') return null;
  // 仅关心相对同目录引用：'./xxx.js' / './xxx'
  const match = /^\.\/([A-Za-z0-9_-]+)(?:\.js)?$/.exec(importPath);
  if (!match) return null;
  const name = match[1];
  return Object.prototype.hasOwnProperty.call(RUNNER_LAYER, name) ? name : null;
}

/** 从当前文件绝对路径抽出 runner 文件名（不含扩展名）。 */
function resolveCurrentRunnerName(filename) {
  if (typeof filename !== 'string') return null;
  const normalized = filename.replace(/\\/g, '/');
  const match = /\/handoff\/runner\/([A-Za-z0-9_-]+)\.ts$/.exec(normalized);
  return match ? match[1] : null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '禁止团队五层架构的 runner 跨层直接 import 另一层的 runner（必须走 handoff / inbound / substate / 事件总线受控通道）。',
    },
    schema: [],
    messages: {
      crossLayer:
        '跨层直连违规：`{{from}}`（{{fromLayer}} 层）不得直接 import `{{to}}`（{{toLayer}} 层）。层间通信必须走 handoff-store / inbound-store / substate-store / team-events-bus 受控通道。详见 team-architecture-l1-baseline.md §L1.4。',
    },
  },
  create(context) {
    const filename =
      typeof context.getFilename === 'function' ? context.getFilename() : context.filename;
    const currentName = resolveCurrentRunnerName(filename);
    // 不在 handoff/runner 下的文件直接放行
    if (!currentName) return {};
    const currentLayer = RUNNER_LAYER[currentName];
    // 当前文件不是已知 runner（如 watcher / scheduler）→ 不施加「来源层」约束
    const isOrchestrator = ORCHESTRATOR_ALLOWLIST.has(currentName);

    function check(node, importPath) {
      const targetName = resolveRunnerModuleName(importPath);
      if (!targetName) return;
      const targetLayer = RUNNER_LAYER[targetName];
      // 同层引用始终允许（如 pm1-runner ↔ artifact-chain）
      if (currentLayer && targetLayer === currentLayer) return;
      // 受控编排器允许跨层引用下游 runner（watcher / pm1-runner 分发器 / scheduler）
      if (isOrchestrator) return;
      context.report({
        node,
        messageId: 'crossLayer',
        data: {
          from: currentName,
          fromLayer: currentLayer ?? 'unknown',
          to: targetName,
          toLayer: targetLayer,
        },
      });
    }

    return {
      // 静态：import ... from './pm2-runner.js'
      ImportDeclaration(node) {
        check(node, node.source && node.source.value);
      },
      // 静态：export ... from './pm2-runner.js'
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      // 动态：await import('./pm2-runner.js')
      ImportExpression(node) {
        if (node.source && node.source.type === 'Literal') {
          check(node, node.source.value);
        }
      },
      // require 形式（防御性；项目为纯 ESM，正常不会出现）
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal'
        ) {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};

export default {
  rules: {
    'no-cross-layer-runner-import': rule,
  },
};
