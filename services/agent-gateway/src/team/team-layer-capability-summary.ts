/**
 * 260531-team-page · team-layer-capability-summary
 *
 * 把分散在 `layer-capabilities.ts`（代码级硬约束护栏）与 `role-adapter.ts`
 * （默认 toolset / agent 实现）的"每层能力"聚合成**单一只读视图**，供前端
 * 「角色能力卡」渲染。
 *
 * 关键语义（回答"工具/skill 是固定还是动态"）：
 *   - allowedToolsetCategories：该层**能力天花板**（固定护栏，运行时强制，
 *     违反抛 LayerCapabilityViolationError）。
 *   - defaultToolsets：role-adapter 给该层的**默认启用**工具集（天花板内的
 *     默认值，可被团队模板 per-member 覆盖）。
 *   - canHandoffTo / canWriteArtifactPhases / allowedBuiltinInstructions：
 *     同为固定护栏，描述该层在单向链中的位置与可写产物。
 *
 * 即：天花板固定、天花板内的具体启用项动态可配。前端据此展示"哪些是锁死的、
 * 哪些是默认 + 可在模板/设置里调整的"。
 */

import { LAYER_CAPABILITIES } from '../handoff/capability/layer-capabilities.js';
import type { HandoffRoleLayer } from '../handoff/store/handoff-store.js';
import { listAdapters } from '../handoff/workflow/role-adapter.js';

/** 前端展示用的层级顺序（含 user，但 user 无独立角色能力）。 */
const LAYER_ORDER: readonly HandoffRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

/** layer → role-adapter key（与 role-adapter.ts 内置 adapter 对齐）。 */
const LAYER_ADAPTER_KEY: Partial<Record<HandoffRoleLayer, string>> = {
  reception: 'reception-default',
  pm1: 'pm1-default',
  pm2: 'pm2-default',
  executor: 'executor-default',
  reviewer: 'reviewer-default',
};

export interface ToolsetCategoryInfo {
  id: string;
  label: string;
  /** 一句话说明该类别覆盖的工具。 */
  description: string;
  /** 是否在该层默认启用（defaultToolsets 命中）。 */
  defaultEnabled: boolean;
}

export interface LayerCapabilitySummary {
  layer: HandoffRoleLayer;
  /** role-adapter 显示名（如「执行（默认）」）。 */
  adapterDisplayName: string | null;
  /** agent 实现标识（agent-catalog id）。 */
  agentImplKey: string | null;
  /** 该层能力天花板内的全部工具类别（含默认启用标记）。 */
  toolsetCategories: ToolsetCategoryInfo[];
  /** 单向链：该层可派发到的下游层。 */
  canHandoffTo: HandoffRoleLayer[];
  /** 该层可写的产物 phase。 */
  canWriteArtifactPhases: string[];
  /** 该层 LLM 可调用的内置指令。 */
  allowedBuiltinInstructions: string[];
  /** 是否为终端层（不能再 handoff）。 */
  terminal: boolean;
}

const TOOLSET_CATEGORY_META: Record<string, { label: string; description: string }> = {
  read: { label: '读取', description: '文件读取 / grep / glob / codegraph 发现缓存' },
  write: { label: '写入', description: '文件写入 / edit / apply_patch' },
  shell: { label: '命令行', description: 'bash / 终端执行' },
  web: { label: '联网', description: 'web_search / fetch' },
  lsp: { label: 'LSP', description: 'LSP 语义查询（定义 / 引用 / 重命名）' },
  test: { label: '测试', description: '测试执行' },
  review: { label: '审查', description: '代码审查工具' },
  all: { label: '全部', description: '不限制（仅特殊层）' },
};

function toolsetInfo(id: string, defaultEnabled: boolean): ToolsetCategoryInfo {
  const meta = TOOLSET_CATEGORY_META[id] ?? { label: id, description: '' };
  return { id, label: meta.label, description: meta.description, defaultEnabled };
}

/**
 * 构建全部 5 层（reception → reviewer）的能力摘要。纯函数，无 IO。
 */
export function buildLayerCapabilitySummaries(): LayerCapabilitySummary[] {
  const adapters = listAdapters();
  return LAYER_ORDER.map((layer) => buildOne(layer, adapters));
}

/** 单层能力摘要；不支持的层（user）返回 null。 */
export function buildLayerCapabilitySummary(
  layer: HandoffRoleLayer,
): LayerCapabilitySummary | null {
  if (!LAYER_ORDER.includes(layer)) return null;
  return buildOne(layer, listAdapters());
}

function buildOne(
  layer: HandoffRoleLayer,
  adapters: ReturnType<typeof listAdapters>,
): LayerCapabilitySummary {
  const caps = LAYER_CAPABILITIES[layer];
  const adapterKey = LAYER_ADAPTER_KEY[layer];
  const adapter = adapterKey ? (adapters.find((a) => a.key === adapterKey) ?? null) : null;

  // role-adapter.resolve 不依赖 context 的工具/agent 字段，这里给一个最小 stub。
  const resolution = adapter
    ? adapter.resolve({
        userId: '__preview__',
        teamWorkspaceId: null,
        workflowId: null,
        upstreamSummary: '',
      })
    : null;

  const defaultToolsets = new Set<string>(resolution?.defaultToolsets ?? []);

  const toolsetCategories = caps.allowedToolsetCategories.map((id) =>
    toolsetInfo(id, defaultToolsets.has(id)),
  );

  return {
    layer,
    adapterDisplayName: adapter?.displayName ?? null,
    agentImplKey: resolution?.agentImplKey ?? null,
    toolsetCategories,
    canHandoffTo: [...caps.canHandoffTo],
    canWriteArtifactPhases: [...caps.canWriteArtifactPhases],
    allowedBuiltinInstructions: [...caps.allowedBuiltinInstructions],
    terminal: caps.canHandoffTo.length === 0,
  };
}
