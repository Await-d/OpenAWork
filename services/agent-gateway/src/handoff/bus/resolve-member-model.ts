/**
 * Phase 2 · 每层/每成员模型解析。
 *
 * 模板编辑器允许用户给每个成员槽位（FixedTeamMemberSlot）绑定 modelId/providerId。
 * 创建 session 时这些槽位被快照进根（reception）session 的
 * `metadata.teamDefinition.memberSlots`。运行时为某一层创建子 session 时，本模块
 * 负责从根 session 的快照里把该成员的模型解析出来，写进子 session 的 metadata
 * （`modelId` / `providerId`），交给 `resolveStreamModelRoute` 消费。
 *
 * 解析规则：
 *   - executor / reviewer：handoff payload 携带 `assignedMember.personaKey`，
 *     按 personaKey 精确匹配槽位（同层多 specialty 时区分到人）。
 *   - 其它层（reception/pm1/pm2）：按 layer 匹配该层第一个带模型绑定的槽位。
 *
 * 全部为「尽力而为」：解析不到模型时返回 undefined，运行时回退到原有的
 * 用户全局 active 选择，老会话与未配置模型的模板完全不受影响。
 */

import { upgradeLegacyExecutorToolsets } from '@openAwork/shared';
import { sqliteGet } from '../../infra/db.js';
import type { HandoffRoleLayer } from '../store/handoff-store.js';

export interface ResolvedMemberModel {
  modelId?: string;
  providerId?: string;
  variant?: string;
  /** 该成员是否启用思考模式（来自模板 slot 配置）。 */
  thinkingEnabled?: boolean;
  /** 思考强度等级（来自模板 slot 配置，仅 thinkingEnabled=true 时有意义）。 */
  reasoningEffort?: string;
}

interface SessionRow {
  metadata_json: string;
  team_parent_session_id: string | null;
}

interface RosterSlotLike {
  layer?: unknown;
  personaKey?: unknown;
  modelId?: unknown;
  providerId?: unknown;
  variant?: unknown;
  thinkingEnabled?: unknown;
  reasoningEffort?: unknown;
  specialty?: unknown;
  displayName?: unknown;
  systemPrompt?: unknown;
  skillIds?: unknown;
  mcpServerIds?: unknown;
  toolsets?: unknown;
  toolsetsCustomized?: unknown;
  routingKeywords?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从某个 session 向上走 team_parent_session_id 找到根 session 的 metadata。
 * 设上限 16 层防御环 / 异常深度。
 */
function loadRootSessionMetadata(sessionId: string): Record<string, unknown> | null {
  let currentId: string | null = sessionId;
  let guard = 0;
  let lastMetadata: Record<string, unknown> | null = null;
  while (currentId && guard < 16) {
    const row: SessionRow | undefined = sqliteGet<SessionRow>(
      `SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? LIMIT 1`,
      [currentId],
    );
    if (!row) break;
    try {
      const parsed = JSON.parse(row.metadata_json || '{}') as unknown;
      if (isRecord(parsed)) lastMetadata = parsed;
    } catch {
      // ignore malformed metadata, keep walking up
    }
    if (!row.team_parent_session_id) break;
    currentId = row.team_parent_session_id;
    guard += 1;
  }
  return lastMetadata;
}

function readMemberSlots(metadata: Record<string, unknown> | null): RosterSlotLike[] {
  if (!metadata) return [];
  const teamDefinition = metadata['teamDefinition'];
  if (!isRecord(teamDefinition)) return [];
  const memberSlots = teamDefinition['memberSlots'];
  return Array.isArray(memberSlots) ? (memberSlots as RosterSlotLike[]) : [];
}

function hasMemberModelOverrides(slot: RosterSlotLike | undefined): boolean {
  if (!slot) return false;
  const modelId = typeof slot.modelId === 'string' ? slot.modelId.trim() : '';
  const providerId = typeof slot.providerId === 'string' ? slot.providerId.trim() : '';
  const variant = typeof slot.variant === 'string' ? slot.variant.trim() : '';
  const thinkingEnabled =
    typeof slot.thinkingEnabled === 'boolean' ? slot.thinkingEnabled : undefined;
  const reasoningEffort =
    typeof slot.reasoningEffort === 'string' ? slot.reasoningEffort.trim() : '';
  return (
    modelId.length > 0 ||
    providerId.length > 0 ||
    variant.length > 0 ||
    thinkingEnabled !== undefined ||
    reasoningEffort.length > 0
  );
}

function toResolvedModel(slot: RosterSlotLike | undefined): ResolvedMemberModel | undefined {
  if (!hasMemberModelOverrides(slot) || !slot) return undefined;
  const modelId = typeof slot.modelId === 'string' ? slot.modelId.trim() : '';
  const thinkingEnabled =
    typeof slot.thinkingEnabled === 'boolean' ? slot.thinkingEnabled : undefined;
  const reasoningEffort =
    typeof slot.reasoningEffort === 'string' && slot.reasoningEffort.trim().length > 0
      ? slot.reasoningEffort.trim()
      : undefined;
  return {
    ...(modelId.length > 0 ? { modelId } : {}),
    ...(typeof slot.providerId === 'string' && slot.providerId.trim().length > 0
      ? { providerId: slot.providerId.trim() }
      : {}),
    ...(typeof slot.variant === 'string' && slot.variant.trim().length > 0
      ? { variant: slot.variant.trim() }
      : {}),
    ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function readRootSessionModel(
  metadata: Record<string, unknown> | null,
): ResolvedMemberModel | undefined {
  if (!metadata) return undefined;
  const modelId = typeof metadata['modelId'] === 'string' ? metadata['modelId'].trim() : '';
  const providerId =
    typeof metadata['providerId'] === 'string' ? metadata['providerId'].trim() : '';
  if (modelId.length === 0 || providerId.length === 0) return undefined;
  const variant = typeof metadata['variant'] === 'string' ? metadata['variant'].trim() : '';
  const thinkingEnabled =
    typeof metadata['thinkingEnabled'] === 'boolean' ? metadata['thinkingEnabled'] : undefined;
  const reasoningEffort =
    typeof metadata['reasoningEffort'] === 'string' && metadata['reasoningEffort'].trim().length > 0
      ? metadata['reasoningEffort'].trim()
      : undefined;
  return {
    modelId,
    providerId,
    ...(variant.length > 0 ? { variant } : {}),
    ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/**
 * 解析某次 handoff 目标层成员的模型绑定。
 *
 * @param fromSessionId handoff 发起方 session（用于向上回溯到根 session 快照）
 * @param toRoleLayer   handoff 目标层
 * @param payload       handoff payload（executor/reviewer 含 assignedMember.personaKey）
 */
export function resolveMemberModelForHandoff(input: {
  fromSessionId: string;
  toRoleLayer: HandoffRoleLayer;
  payload: unknown;
}): ResolvedMemberModel | undefined {
  const metadata = loadRootSessionMetadata(input.fromSessionId);
  const slots = readMemberSlots(metadata);
  if (slots.length === 0) return undefined;

  // executor / reviewer：优先按 assignedMember.personaKey 精确匹配。
  const assignedMember = isRecord(input.payload) ? input.payload['assignedMember'] : undefined;
  const personaKey =
    isRecord(assignedMember) && typeof assignedMember['personaKey'] === 'string'
      ? assignedMember['personaKey']
      : undefined;
  if (personaKey) {
    const byPersona = slots.find((slot) => slot.personaKey === personaKey);
    const resolved = toResolvedModel(byPersona);
    if (resolved) return resolved;
  }

  // 兜底：按 layer 匹配该层第一个带模型绑定的槽位。
  const byLayer = slots.find(
    (slot) => slot.layer === input.toRoleLayer && hasMemberModelOverrides(slot),
  );
  return toResolvedModel(byLayer) ?? readRootSessionModel(metadata);
}

/**
 * 解析某次 handoff 目标成员的自定义人物提示词（specialty='custom' 的 systemPrompt）。
 *
 * 按 assignedMember.personaKey 精确匹配；非自定义成员或无 systemPrompt 时返回
 * undefined（运行时按原有 7 层 system prompt 拼装，不注入额外人设）。
 */
export function resolveMemberSystemPrompt(input: {
  fromSessionId: string;
  payload: unknown;
}): { displayName: string; systemPrompt: string } | undefined {
  const metadata = loadRootSessionMetadata(input.fromSessionId);
  const slots = readMemberSlots(metadata);
  if (slots.length === 0) return undefined;

  const assignedMember = isRecord(input.payload) ? input.payload['assignedMember'] : undefined;
  const personaKey =
    isRecord(assignedMember) && typeof assignedMember['personaKey'] === 'string'
      ? assignedMember['personaKey']
      : undefined;
  if (!personaKey) return undefined;

  const slot = slots.find((s) => s.personaKey === personaKey);
  if (!slot) return undefined;
  const systemPrompt = typeof slot.systemPrompt === 'string' ? slot.systemPrompt.trim() : '';
  if (systemPrompt.length === 0) return undefined;
  const displayName =
    typeof slot.displayName === 'string' && slot.displayName.trim().length > 0
      ? slot.displayName.trim()
      : '自定义角色';
  return { displayName, systemPrompt };
}

/**
 * 把已解析的成员模型合并进 metadataJson 字符串（写入子 session 时用）。
 * 不覆盖调用方已显式设置的 modelId/providerId。
 */
export function mergeMemberModelIntoMetadata(
  metadataJson: string | undefined,
  model: ResolvedMemberModel | undefined,
): string | undefined {
  if (!model) return metadataJson;
  let metadata: Record<string, unknown> = {};
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (isRecord(parsed)) metadata = parsed;
    } catch {
      metadata = {};
    }
  }
  if (
    model.modelId &&
    (typeof metadata['modelId'] !== 'string' || metadata['modelId'].length === 0)
  ) {
    metadata['modelId'] = model.modelId;
  }
  if (
    model.providerId &&
    (typeof metadata['providerId'] !== 'string' || metadata['providerId'].length === 0)
  ) {
    metadata['providerId'] = model.providerId;
  }
  if (
    model.variant &&
    (typeof metadata['variant'] !== 'string' || metadata['variant'].length === 0)
  ) {
    metadata['variant'] = model.variant;
  }
  // 思考模式：仅当模板 slot 显式配置了 thinkingEnabled 时写入，
  // 不覆盖已存在的值（子 session 可能有自己独立的覆盖）。
  if (model.thinkingEnabled !== undefined && typeof metadata['thinkingEnabled'] !== 'boolean') {
    metadata['thinkingEnabled'] = model.thinkingEnabled;
  }
  if (
    model.reasoningEffort &&
    (typeof metadata['reasoningEffort'] !== 'string' || metadata['reasoningEffort'].length === 0)
  ) {
    metadata['reasoningEffort'] = model.reasoningEffort;
  }
  return JSON.stringify(metadata);
}

/**
 * 把自定义角色的人物提示词写入子 session metadata 的 delegatedSystemPrompt。
 * resolveStreamModelRoute 会优先采用它作为本次运行的 system prompt。
 * 不覆盖已存在的值。
 */
export function mergeDelegatedSystemPromptIntoMetadata(
  metadataJson: string | undefined,
  systemPrompt: string | undefined,
): string | undefined {
  if (!systemPrompt || systemPrompt.trim().length === 0) return metadataJson;
  let metadata: Record<string, unknown> = {};
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (isRecord(parsed)) metadata = parsed;
    } catch {
      metadata = {};
    }
  }
  if (
    typeof metadata['delegatedSystemPrompt'] !== 'string' ||
    metadata['delegatedSystemPrompt'].length === 0
  ) {
    metadata['delegatedSystemPrompt'] = systemPrompt.trim();
  }
  return JSON.stringify(metadata);
}

const ROSTER_MANIFEST_LAYER_ORDER: HandoffRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

const ROSTER_MANIFEST_LAYER_LABELS: Record<string, string> = {
  reception: '接待层',
  pm1: 'PM1 规划层',
  pm2: 'PM2 管控层',
  executor: '执行层',
  reviewer: '评审层',
};

/**
 * 构建「团队编制清单」动态提示词片段。
 *
 * 把根 session 快照里的**实时花名册**（含用户自定义角色）按层渲染成一段文本，
 * 让正在运行的成员知道：当前团队里有哪些角色、各自擅长什么、自己处在哪一层、
 * 上下游是谁。这就是「上下关联处的提示词动态注入」——不写死角色，而是按当前
 * roster 动态生成，自定义角色加进来后立即出现在清单里被上下游感知。
 *
 * 返回 null 表示花名册为空（无可注入内容）。
 */
export function buildTeamRosterManifest(input: {
  fromSessionId: string;
  currentLayer: HandoffRoleLayer;
  currentPersonaKey?: string;
}): string | null {
  const metadata = loadRootSessionMetadata(input.fromSessionId);
  const slots = readMemberSlots(metadata);
  if (slots.length === 0) return null;

  const byLayer = new Map<string, RosterSlotLike[]>();
  for (const slot of slots) {
    const layer = typeof slot.layer === 'string' ? slot.layer : '';
    if (!layer) continue;
    const list = byLayer.get(layer) ?? [];
    list.push(slot);
    byLayer.set(layer, list);
  }

  const lines: string[] = [];
  for (const layer of ROSTER_MANIFEST_LAYER_ORDER) {
    const members = byLayer.get(layer);
    if (!members || members.length === 0) continue;
    const label = ROSTER_MANIFEST_LAYER_LABELS[layer] ?? layer;
    const isCurrentLayer = layer === input.currentLayer;
    lines.push(`## ${label}${isCurrentLayer ? '（你所在的层）' : ''}`);
    for (const m of members) {
      const name =
        typeof m.displayName === 'string' && m.displayName.trim().length > 0
          ? m.displayName.trim()
          : typeof m.specialty === 'string'
            ? m.specialty
            : '成员';
      const isSelf =
        input.currentPersonaKey &&
        typeof m.personaKey === 'string' &&
        m.personaKey === input.currentPersonaKey;
      const kws = Array.isArray(m.routingKeywords)
        ? m.routingKeywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        : [];
      const isCustom = m.specialty === 'custom';
      const tags: string[] = [];
      if (isSelf) tags.push('← 你');
      if (isCustom) tags.push('自定义');
      if (kws.length > 0) tags.push(`擅长：${kws.slice(0, 6).join(' / ')}`);
      lines.push(`- ${name}${tags.length > 0 ? `（${tags.join('；')}）` : ''}`);
    }
  }
  if (lines.length === 0) return null;

  const flow =
    '协作链路：接待 → PM1 规划 → PM2 管控 → 执行 / 评审（跨层只能经 handoff，不能直连）。';
  return [
    '【团队编制清单（动态）】',
    '以下是当前团队的实时角色编制（含自定义角色）。理解你在团队中的位置、上下游有谁、各成员擅长什么，据此协作与交付。',
    flow,
    '',
    ...lines,
  ].join('\n');
}

/**
 * 把「团队编制清单」写入子 session metadata 的 teamRosterManifest 字段。
 * 运行时（stream.ts）把它作为一段动态上下文注入 system prompt。不覆盖已存在值。
 */
export function mergeTeamRosterManifestIntoMetadata(
  metadataJson: string | undefined,
  manifest: string | null,
): string | undefined {
  if (!manifest || manifest.trim().length === 0) return metadataJson;
  let metadata: Record<string, unknown> = {};
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (isRecord(parsed)) metadata = parsed;
    } catch {
      metadata = {};
    }
  }
  if (
    typeof metadata['teamRosterManifest'] !== 'string' ||
    metadata['teamRosterManifest'].length === 0
  ) {
    metadata['teamRosterManifest'] = manifest.trim();
  }
  return JSON.stringify(metadata);
}

/**
 * 解析某次 handoff 目标成员的初始能力绑定（skills / mcp servers）。
 * 按 assignedMember.personaKey 精确匹配；无则按 layer 取第一个带绑定的槽位。
 */
export function resolveMemberCapabilities(input: {
  fromSessionId: string;
  toRoleLayer: HandoffRoleLayer;
  payload: unknown;
}): { skillIds: string[]; mcpServerIds: string[]; toolsets: string[] } {
  const metadata = loadRootSessionMetadata(input.fromSessionId);
  const slots = readMemberSlots(metadata);
  if (slots.length === 0) return { skillIds: [], mcpServerIds: [], toolsets: [] };

  const assignedMember = isRecord(input.payload) ? input.payload['assignedMember'] : undefined;
  const personaKey =
    isRecord(assignedMember) && typeof assignedMember['personaKey'] === 'string'
      ? assignedMember['personaKey']
      : undefined;

  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

  let slot: RosterSlotLike | undefined;
  if (personaKey) {
    slot = slots.find((s) => s.personaKey === personaKey);
  }
  if (!slot) {
    slot = slots.find(
      (s) =>
        s.layer === input.toRoleLayer &&
        (Array.isArray(s.skillIds) || Array.isArray(s.mcpServerIds) || Array.isArray(s.toolsets)),
    );
  }
  if (!slot) return { skillIds: [], mcpServerIds: [], toolsets: [] };
  const toolsets = toStrArr(slot.toolsets);
  return {
    skillIds: toStrArr(slot.skillIds),
    mcpServerIds: toStrArr(slot.mcpServerIds),
    toolsets: upgradeLegacyExecutorToolsets({
      layer: slot.layer,
      specialty: slot.specialty,
      personaKey: slot.personaKey,
      toolsets,
      toolsetsCustomized: slot.toolsetsCustomized,
    }),
  };
}

/**
 * 把成员的初始能力（skills / mcp / toolsets）写入子 session metadata：
 *   - skillIds → metadata.requestedSkills（运行时已识别）
 *   - mcpServerIds → metadata.requestedMcpServers（MCP 白名单，运行时按它过滤）
 *   - toolsets → metadata.toolsets（工具类别白名单，stream 与层级白名单取交集）
 * 不覆盖已存在的值；空数组不写。
 */
export function mergeMemberCapabilitiesIntoMetadata(
  metadataJson: string | undefined,
  caps: { skillIds: string[]; mcpServerIds: string[]; toolsets: string[] } | undefined,
): string | undefined {
  if (
    !caps ||
    (caps.skillIds.length === 0 && caps.mcpServerIds.length === 0 && caps.toolsets.length === 0)
  ) {
    return metadataJson;
  }
  let metadata: Record<string, unknown> = {};
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (isRecord(parsed)) metadata = parsed;
    } catch {
      metadata = {};
    }
  }
  if (caps.skillIds.length > 0 && !Array.isArray(metadata['requestedSkills'])) {
    metadata['requestedSkills'] = [...caps.skillIds];
  }
  if (caps.mcpServerIds.length > 0 && !Array.isArray(metadata['requestedMcpServers'])) {
    metadata['requestedMcpServers'] = [...caps.mcpServerIds];
  }
  if (caps.toolsets.length > 0 && !Array.isArray(metadata['toolsets'])) {
    metadata['toolsets'] = [...caps.toolsets];
  }
  return JSON.stringify(metadata);
}

/**
 * 按 session（向上回溯到根快照）+ layer 解析该层成员的模型绑定。
 *
 * 供 reception/pm1/pm2 等「在某个 session 内直接运行、不经 handoff payload」的
 * 路径使用：这些层每层通常只有一名成员，按 layer 取第一个带模型绑定的槽位即可。
 */
export function resolveMemberModelForSessionLayer(input: {
  sessionId: string;
  layer: HandoffRoleLayer;
}): ResolvedMemberModel | undefined {
  const metadata = loadRootSessionMetadata(input.sessionId);
  const slots = readMemberSlots(metadata);
  if (slots.length === 0) return undefined;
  const byLayer = slots.find((slot) => slot.layer === input.layer && hasMemberModelOverrides(slot));
  return toResolvedModel(byLayer) ?? readRootSessionModel(metadata);
}
