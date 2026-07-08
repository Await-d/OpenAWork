/**
 * apply-team-layer-tools · 团队层工具门控（stream.ts 与 stream-runtime.ts 共享）
 *
 * 背景：team 五层的 LLM 执行有两条入口——
 *   - reception 交互对话走 routes/stream.ts
 *   - pm1/pm2/executor/reviewer 后台执行走 routes/stream-runtime.ts（runSessionInBackground）
 * 早期只有 stream.ts 做了「toolset 白名单过滤 + 必备并入 + 内置指令注入」，导致后台
 * 执行的真正干活层拿不到 submit_artifact / dispatch_package / submit_patch 等内置指令，
 * SOUL 让它们调这些工具却命中「is not enabled」而无法工作。本模块把这套变换抽成单一
 * 来源，两条入口都调用它，保证行为一致。
 *
 * 变换内容（仅当 roleLayer ∈ 五层时生效）：
 *   1. toolset 白名单过滤：(层 allowedToolsetCategories ∩ 成员 metadata.toolsets) ∪ 层必备。
 *      MCP 扁平工具（mcp__*）由 filterToolsByAllowedSets 直通（已在上游按白名单授权）。
 *   2. 注入该层专属内置指令（route_to_orchestrate / submit_artifact / ...）。
 *   3. fail-closed：任何环节出错退回只读最小集，绝不放行完整工具集。
 */

import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';

const TEAM_LAYERS = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const;
type TeamLayer = (typeof TEAM_LAYERS)[number];

const READ_ONLY_FALLBACK = ['read'] as const;
const SAFE_FALLBACK_NAMES = new Set([
  'read',
  'list',
  'glob',
  'grep',
  'read_tool_output',
  'look_at',
  'repo_overview',
  'todoread',
  'todowrite',
  'subtodoread',
  'subtodowrite',
  'task_list',
  'task_get',
  'session_list',
  'session_read',
  'session_search',
  'session_info',
]);

export function isTeamRoleLayer(value: string | null | undefined): value is TeamLayer {
  return (
    value !== null && value !== undefined && (TEAM_LAYERS as readonly string[]).includes(value)
  );
}

/**
 * 对已 filterEnabledGatewayToolsForSession 过的工具列表施加团队层门控。
 * roleLayer 非五层时原样返回（普通 chat session 不门控）。
 */
export async function applyTeamLayerToolGate(input: {
  roleLayer: string | null | undefined;
  metadataJson: string;
  filteredTools: GatewayToolDefinition[];
}): Promise<GatewayToolDefinition[]> {
  const { roleLayer, metadataJson, filteredTools } = input;
  if (!isTeamRoleLayer(roleLayer)) return filteredTools;

  try {
    const { LAYER_CAPABILITIES } = await import('./layer-capabilities.js');
    // 幂等确保内置指令已注册（注册是 builtin-instructions-impl 顶层副作用，
    // 原本只在 handoff watcher 启动时 import；这里兜底，重复 import 由 ESM 缓存去重）。
    await import('./builtin-instructions-impl.js');
    const { getInstructionsForLayer, toToolDefinition } = await import('./builtin-instructions.js');
    const { filterToolsByAllowedSets, extractToolsetsFromMetadata } =
      await import('./toolset-gate.js');

    const caps = LAYER_CAPABILITIES[roleLayer];
    // 1. toolset 过滤：层白名单 ∩ 成员 toolsets，交集空退回层白名单，再并入层必备。
    const memberToolsets = extractToolsetsFromMetadata(metadataJson);
    let allowedSets = caps.allowedToolsetCategories as string[];
    if (memberToolsets && memberToolsets.length > 0 && !memberToolsets.includes('all')) {
      const layerSet = new Set(allowedSets);
      const intersect = memberToolsets.filter((t) => layerSet.has(t));
      if (intersect.length > 0) allowedSets = intersect;
    }
    const required = caps.requiredToolsetCategories as string[];
    if (required.length > 0) {
      const merged = new Set(allowedSets);
      for (const r of required) merged.add(r);
      allowedSets = Array.from(merged);
    }

    let gated =
      allowedSets.length > 0
        ? filterToolsByAllowedSets(filteredTools, allowedSets as never[])
        : filterToolsByAllowedSets(filteredTools, [...READ_ONLY_FALLBACK] as never[]);

    // 2. 注入该层内置指令。
    const layerInstructions = getInstructionsForLayer(roleLayer);
    if (layerInstructions.length > 0) {
      gated = [...gated, ...layerInstructions.map((inst) => toToolDefinition(inst))];
    }
    return gated;
  } catch (err) {
    console.warn(
      `[apply-team-layer-tools] 门控失败（fail-closed 退回只读）：${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      const { filterToolsByAllowedSets } = await import('./toolset-gate.js');
      return filterToolsByAllowedSets(filteredTools, [...READ_ONLY_FALLBACK] as never[]);
    } catch {
      return filteredTools.filter((tool) => SAFE_FALLBACK_NAMES.has(tool.function.name));
    }
  }
}

/**
 * 给团队指令栈追加两段动态内容（stream.ts 与 stream-runtime.ts 共享，保证一致）：
 *   1. roster-manifest：watcher 写入 metadata.teamRosterManifest 的实时编制清单。
 *   2. available-tools：本轮真正注入给模型的工具全名清单（含动态 MCP），让模型
 *      「看到什么用什么」，避免臆造未注入工具名或漏用已绑定 MCP。
 * roleLayer 非五层时只追加 roster（available-tools 仅对团队层有意义）。
 */
export function appendTeamDynamicInstructionBlocks(input: {
  stableBlock: string;
  roleLayer: string | null | undefined;
  teamRosterManifest: string | null | undefined;
  enabledToolNames: ReadonlySet<string>;
}): string {
  let stack = input.stableBlock;

  const manifest =
    typeof input.teamRosterManifest === 'string' ? input.teamRosterManifest.trim() : '';
  if (manifest.length > 0) {
    const block = `<team-instruction layer="roster-manifest">\n${manifest}\n</team-instruction>`;
    stack = stack ? `${stack}\n\n${block}` : block;
  }

  if (isTeamRoleLayer(input.roleLayer) && input.enabledToolNames.size > 0) {
    const sorted = Array.from(input.enabledToolNames).sort();
    const mcp = sorted.filter((n) => n.startsWith('mcp__'));
    const nonMcp = sorted.filter((n) => !n.startsWith('mcp__'));
    const lines = [
      '以下是你本轮**实际可调用**的工具全名清单（动态生成，以此为准；不要调用不在表中的工具名）：',
      ...nonMcp.map((n) => `- ${n}`),
    ];
    if (mcp.length > 0) {
      lines.push(
        '',
        '已为你绑定的 MCP 工具（按需调用，参数见各工具定义）：',
        ...mcp.map((n) => `- ${n}`),
      );
    }
    const block = `<team-instruction layer="available-tools">\n${lines.join('\n')}\n</team-instruction>`;
    stack = stack ? `${stack}\n\n${block}` : block;
  }

  return stack;
}
