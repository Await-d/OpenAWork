import { randomUUID } from 'node:crypto';
import type {
  CapabilityDescriptor,
  CapabilitySource,
  CanonicalRoleDescriptor,
  CreateManagedAgentInput,
  ManagedAgentBody,
  ManagedAgentRecord,
  UpdateManagedAgentInput,
} from '@openAwork/shared';
import { REFERENCE_AGENT_ROLE_METADATA } from '@openAwork/shared';
import {
  getSystemBuiltinAgentDescriptor,
  listSystemBuiltinAgentDescriptors,
} from '@openAwork/resources/node';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { BUILTIN_AGENT_REFERENCE_SNAPSHOT } from './agent-reference-snapshot.js';
import { getReferenceAgentModelCandidates } from '../task/task-model-reference-snapshot.js';
import {
  getResourceAgentRoleMetadata,
  RESOURCE_BUILTIN_AGENT_MAP,
  RESOURCE_BUILTIN_AGENTS,
} from './resource-agent-catalog.js';

interface UserSettingRow {
  value: string;
}

interface StoredBuiltinOverride extends Partial<ManagedAgentBody> {
  enabled?: boolean;
  updatedAt?: string;
}

interface StoredCustomAgent {
  id: string;
  current: ManagedAgentBody;
  defaultBody: ManagedAgentBody;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredAgentCatalog {
  builtinOverrides: Record<string, StoredBuiltinOverride>;
  customAgents: Record<string, StoredCustomAgent>;
}

const SYSTEM_CREATED_AT = new Date(0).toISOString();

const BUILTIN_AGENT_BASE: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  source: Extract<CapabilitySource, 'builtin'>;
}> = [
  ...listSystemBuiltinAgentDescriptors().map((agent) => ({
    id: agent.id,
    label: agent.displayName,
    description: agent.description,
    source: 'builtin' as const,
  })),
  ...RESOURCE_BUILTIN_AGENTS.map((agent) => ({
    id: agent.id,
    label: agent.displayName,
    description: agent.description,
    source: 'builtin' as const,
  })),
];

const BUILTIN_AGENT_MAP = new Map(BUILTIN_AGENT_BASE.map((item) => [item.id, item]));

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeCanonicalRole(value: unknown): CanonicalRoleDescriptor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['coreRole'] !== 'string') {
    return undefined;
  }

  return {
    coreRole: record['coreRole'] as CanonicalRoleDescriptor['coreRole'],
    preset:
      typeof record['preset'] === 'string'
        ? (record['preset'] as CanonicalRoleDescriptor['preset'])
        : undefined,
    overlays: Array.isArray(record['overlays'])
      ? record['overlays'].filter(
          (item): item is 'writer' | 'multimodal' => item === 'writer' || item === 'multimodal',
        )
      : undefined,
    confidence:
      record['confidence'] === 'low' ||
      record['confidence'] === 'medium' ||
      record['confidence'] === 'high'
        ? record['confidence']
        : undefined,
  };
}

function normalizeBody(
  input: Partial<ManagedAgentBody> & Record<string, unknown>,
): ManagedAgentBody {
  return {
    label: normalizeOptionalText(input.label) ?? '未命名 Agent',
    description: normalizeOptionalText(input.description) ?? '',
    aliases: normalizeAliases(input.aliases),
    canonicalRole: normalizeCanonicalRole(input.canonicalRole),
    model: normalizeOptionalText(input.model),
    variant: normalizeOptionalText(input.variant),
    fallbackModels: normalizeModelList(input.fallbackModels),
    systemPrompt: normalizeOptionalText(input.systemPrompt),
    note: normalizeOptionalText(input.note),
  };
}

function parseLegacyPreferences(value: string | undefined): Record<string, StoredBuiltinOverride> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([agentId, raw]) => {
        if (!raw || typeof raw !== 'object') {
          return [];
        }
        const record = raw as Record<string, unknown>;
        const override: StoredBuiltinOverride = {
          label: normalizeOptionalText(record['displayNameOverride']),
          note: normalizeOptionalText(record['note']),
          enabled: record['hidden'] === true ? false : undefined,
          updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : undefined,
        };
        return isEmptyBuiltinOverride(override) ? [] : [[agentId, override] as const];
      }),
    );
  } catch {
    return {};
  }
}

function parseStoredCatalog(value: string | undefined): StoredAgentCatalog {
  if (!value) {
    return { builtinOverrides: {}, customAgents: {} };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const builtinOverrides = Object.fromEntries(
      Object.entries((parsed['builtinOverrides'] as Record<string, unknown>) ?? {}).flatMap(
        ([agentId, raw]) => {
          if (!raw || typeof raw !== 'object') {
            return [];
          }
          const record = raw as Record<string, unknown>;
          const override: StoredBuiltinOverride = {
            label: normalizeOptionalText(record['label']),
            description: normalizeOptionalText(record['description']),
            aliases: normalizeAliases(record['aliases']),
            canonicalRole: normalizeCanonicalRole(record['canonicalRole']),
            model: normalizeOptionalText(record['model']),
            variant: normalizeOptionalText(record['variant']),
            fallbackModels: normalizeModelList(record['fallbackModels']),
            systemPrompt: normalizeOptionalText(record['systemPrompt']),
            note: normalizeOptionalText(record['note']),
            enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : undefined,
            updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : undefined,
          };
          return isEmptyBuiltinOverride(override) ? [] : [[agentId, override] as const];
        },
      ),
    );

    const customAgents = Object.fromEntries(
      Object.entries((parsed['customAgents'] as Record<string, unknown>) ?? {}).flatMap(
        ([agentId, raw]) => {
          if (!raw || typeof raw !== 'object') {
            return [];
          }
          const record = raw as Record<string, unknown>;
          const current = normalizeBody((record['current'] as Record<string, unknown>) ?? {});
          const defaultBody = normalizeBody(
            (record['defaultBody'] as Record<string, unknown>) ?? current,
          );
          return [
            [
              agentId,
              {
                id: agentId,
                current,
                defaultBody,
                enabled: record['enabled'] !== false,
                createdAt:
                  typeof record['createdAt'] === 'string'
                    ? record['createdAt']
                    : new Date().toISOString(),
                updatedAt:
                  typeof record['updatedAt'] === 'string'
                    ? record['updatedAt']
                    : new Date().toISOString(),
              } satisfies StoredCustomAgent,
            ] as const,
          ];
        },
      ),
    );

    return { builtinOverrides, customAgents };
  } catch {
    return { builtinOverrides: {}, customAgents: {} };
  }
}

function isEmptyBuiltinOverride(override: StoredBuiltinOverride): boolean {
  return (
    !override.label &&
    !override.description &&
    !override.aliases?.length &&
    !override.canonicalRole &&
    !override.model &&
    !override.variant &&
    !override.fallbackModels?.length &&
    !override.systemPrompt &&
    !override.note &&
    override.enabled === undefined
  );
}

function loadStoredCatalog(userId: string): StoredAgentCatalog {
  const catalogRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_catalog'`,
    [userId],
  );
  const legacyRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_preferences'`,
    [userId],
  );

  const catalog = parseStoredCatalog(catalogRow?.value);
  const legacyOverrides = parseLegacyPreferences(legacyRow?.value);
  for (const [agentId, override] of Object.entries(legacyOverrides)) {
    catalog.builtinOverrides[agentId] ??= override;
  }
  return catalog;
}

function persistStoredCatalog(userId: string, catalog: StoredAgentCatalog) {
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     VALUES (?, 'agent_catalog', ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(catalog)],
  );
}

function defaultBodyForBuiltin(id: string): ManagedAgentBody {
  const builtin = BUILTIN_AGENT_MAP.get(id);
  if (!builtin) {
    throw new Error(`Unknown builtin agent: ${id}`);
  }
  const resourceAgent = RESOURCE_BUILTIN_AGENT_MAP.get(id);
  const resourceMetadata = getResourceAgentRoleMetadata(id);
  const systemAgent = getSystemBuiltinAgentDescriptor(id);
  const metadata = REFERENCE_AGENT_ROLE_METADATA[id];
  const reference = BUILTIN_AGENT_REFERENCE_SNAPSHOT[id];
  const modelCandidates = getReferenceAgentModelCandidates(id);
  return {
    label:
      systemAgent?.displayName ?? reference?.label ?? resourceAgent?.displayName ?? builtin.label,
    description:
      systemAgent?.description ??
      reference?.description ??
      resourceAgent?.description ??
      builtin.description,
    aliases: metadata?.aliases
      ? [...metadata.aliases]
      : resourceMetadata?.aliases
        ? [...resourceMetadata.aliases]
        : [],
    canonicalRole: metadata?.canonicalRole ?? resourceMetadata?.canonicalRole,
    model: modelCandidates[0],
    variant: undefined,
    fallbackModels: modelCandidates.slice(1),
    systemPrompt:
      systemAgent?.systemPrompt ?? reference?.systemPrompt ?? resourceAgent?.systemPrompt,
    color: systemAgent?.color ?? reference?.color,
    note: resourceAgent ? `参考资源 agent: ${resourceAgent.path}` : undefined,
  };
}

function buildBuiltinAgentRecord(id: string, override?: StoredBuiltinOverride): ManagedAgentRecord {
  const builtin = BUILTIN_AGENT_MAP.get(id);
  if (!builtin) {
    throw new Error(`Unknown builtin agent: ${id}`);
  }
  const sanitizedOverride = override
    ? {
        model: override.model,
        variant: override.variant,
        fallbackModels: override.fallbackModels,
        systemPrompt: override.systemPrompt,
        updatedAt: override.updatedAt,
        enabled: override.enabled,
      }
    : undefined;
  const defaultBody = defaultBodyForBuiltin(id);
  const currentBody = normalizeBody({
    ...defaultBody,
    model: sanitizedOverride?.model ?? defaultBody.model,
    variant: sanitizedOverride?.variant ?? defaultBody.variant,
    fallbackModels: sanitizedOverride?.fallbackModels ?? defaultBody.fallbackModels,
    systemPrompt: sanitizedOverride?.systemPrompt ?? defaultBody.systemPrompt,
  });

  const hasOverrides =
    (sanitizedOverride?.model ?? defaultBody.model) !== defaultBody.model ||
    (sanitizedOverride?.variant ?? defaultBody.variant) !== defaultBody.variant ||
    JSON.stringify(sanitizedOverride?.fallbackModels ?? defaultBody.fallbackModels) !==
      JSON.stringify(defaultBody.fallbackModels) ||
    sanitizedOverride?.systemPrompt !== undefined;

  return {
    id,
    origin: 'builtin',
    source: builtin.source,
    enabled: sanitizedOverride?.enabled ?? true,
    removable: false,
    resettable: hasOverrides,
    hasOverrides,
    promptMetadata: {
      defaultText: defaultBody.systemPrompt ?? undefined,
      hasPromptOverride: currentBody.systemPrompt !== defaultBody.systemPrompt,
    },
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: sanitizedOverride?.updatedAt ?? SYSTEM_CREATED_AT,
    ...currentBody,
  };
}

function buildCustomAgentRecord(agent: StoredCustomAgent): ManagedAgentRecord {
  return {
    id: agent.id,
    origin: 'custom',
    source: 'custom',
    enabled: agent.enabled,
    removable: true,
    resettable:
      agent.enabled !== true || JSON.stringify(agent.current) !== JSON.stringify(agent.defaultBody),
    hasOverrides:
      JSON.stringify(agent.current) !== JSON.stringify(agent.defaultBody) || agent.enabled !== true,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    ...agent.current,
  };
}

function sortManagedAgents(agents: ManagedAgentRecord[]): ManagedAgentRecord[] {
  return [...agents].sort((left, right) => {
    const originDelta = Number(left.origin === 'builtin') - Number(right.origin === 'builtin');
    if (originDelta !== 0) {
      return -originDelta;
    }
    return left.label.localeCompare(right.label, 'zh-CN');
  });
}

export function listManagedAgentsForUser(userId: string): ManagedAgentRecord[] {
  const catalog = loadStoredCatalog(userId);
  const builtinAgents = BUILTIN_AGENT_BASE.map((agent) =>
    buildBuiltinAgentRecord(agent.id, catalog.builtinOverrides[agent.id]),
  );
  const customAgents = Object.values(catalog.customAgents).map(buildCustomAgentRecord);
  return sortManagedAgents([...builtinAgents, ...customAgents]);
}

export function listEnabledAgentCapabilitiesForUser(userId: string): CapabilityDescriptor[] {
  return listManagedAgentsForUser(userId)
    .filter((agent) => agent.enabled)
    .map<CapabilityDescriptor>((agent) => ({
      id: agent.id,
      kind: 'agent',
      label: agent.label,
      description: agent.description,
      source: agent.source,
      callable: false,
      enabled: true,
      canonicalRole: agent.canonicalRole,
      aliases: agent.aliases,
    }));
}

function slugifyAgentId(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || `agent-${randomUUID().slice(0, 8)}`;
}

function generateCustomAgentId(label: string, catalog: StoredAgentCatalog): string {
  const baseId = slugifyAgentId(label);
  let candidate = baseId;
  let index = 1;
  while (BUILTIN_AGENT_MAP.has(candidate) || catalog.customAgents[candidate]) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createManagedAgentForUser(
  userId: string,
  input: CreateManagedAgentInput,
): ManagedAgentRecord {
  const catalog = loadStoredCatalog(userId);
  const body = normalizeBody(input as CreateManagedAgentInput & Record<string, unknown>);
  if (!body.systemPrompt) {
    throw new Error('Custom agent systemPrompt is required');
  }
  const now = new Date().toISOString();
  const id = normalizeOptionalText(input.id) ?? generateCustomAgentId(body.label, catalog);
  if (BUILTIN_AGENT_MAP.has(id) || catalog.customAgents[id]) {
    throw new Error(`Agent ${id} already exists`);
  }

  catalog.customAgents[id] = {
    id,
    current: body,
    defaultBody: body,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  persistStoredCatalog(userId, catalog);
  return buildCustomAgentRecord(catalog.customAgents[id]);
}

export function updateManagedAgentForUser(
  userId: string,
  agentId: string,
  input: UpdateManagedAgentInput,
): ManagedAgentRecord {
  const catalog = loadStoredCatalog(userId);
  const now = new Date().toISOString();

  if (catalog.customAgents[agentId]) {
    const current = catalog.customAgents[agentId];
    // 自定义 Agent 必须始终带提示词：`null` 属内置覆盖的「清除」语义，对自定义 Agent
    // 无意义（视为未提供，保留现值），避免 `normalizeBody` 把提示词清空。
    const { systemPrompt: customSystemPrompt, ...restInput } = input;
    current.current = normalizeBody({
      ...current.current,
      ...restInput,
      systemPrompt:
        customSystemPrompt === undefined || customSystemPrompt === null
          ? current.current.systemPrompt
          : customSystemPrompt,
      aliases: input.aliases ?? current.current.aliases,
      canonicalRole: input.canonicalRole ?? current.current.canonicalRole,
    });
    current.enabled = input.enabled ?? current.enabled;
    current.updatedAt = now;
    persistStoredCatalog(userId, catalog);
    return buildCustomAgentRecord(current);
  }

  if (!BUILTIN_AGENT_MAP.has(agentId)) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const current = catalog.builtinOverrides[agentId] ?? {};
  const forbiddenFields = [
    'label',
    'description',
    'aliases',
    'canonicalRole',
    'note',
    'enabled',
  ].filter((field) => field in input);

  if (forbiddenFields.length > 0) {
    throw new Error('Builtin agents only allow model configuration updates');
  }

  const next: StoredBuiltinOverride = {
    model: input.model !== undefined ? normalizeOptionalText(input.model) : current.model,
    variant: input.variant !== undefined ? normalizeOptionalText(input.variant) : current.variant,
    fallbackModels:
      input.fallbackModels !== undefined
        ? normalizeModelList(input.fallbackModels)
        : current.fallbackModels,
    systemPrompt:
      input.systemPrompt === undefined
        ? current.systemPrompt
        : (normalizeOptionalText(input.systemPrompt) ?? undefined),
    updatedAt: now,
  };

  const builtinDefault = defaultBodyForBuiltin(agentId);
  const nextSystemPrompt = next.systemPrompt ?? undefined;
  const defaultSystemPrompt = builtinDefault.systemPrompt ?? undefined;

  // 覆盖记录只保留**与默认不同的字段**。任何「等于默认值」的字段只要落库，等上游升级
  // 默认值之后都会变成陈旧值，把该 Agent 静默钉在旧配置上（用户并没有要固定它）。
  // 注意 `sameAsDefault` 要求四个字段全等于默认才删整条记录，所以「改了模型但提示词
  // 等于默认」这类组合不会被它兜住，必须逐字段归一。四个字段同理：
  if (nextSystemPrompt === defaultSystemPrompt) {
    delete next.systemPrompt;
  }
  if ((next.model ?? builtinDefault.model) === builtinDefault.model) {
    delete next.model;
  }
  if ((next.variant ?? builtinDefault.variant) === builtinDefault.variant) {
    delete next.variant;
  }
  // 两侧都按 `?? []` 归一，避免「默认无回退链（undefined）」与「提交空数组（[]）」
  // 被 JSON 序列化判成不同值而落库。
  if (
    JSON.stringify(next.fallbackModels ?? []) ===
    JSON.stringify(builtinDefault.fallbackModels ?? [])
  ) {
    delete next.fallbackModels;
  }

  const sameAsDefault =
    (next.model ?? builtinDefault.model) === builtinDefault.model &&
    (next.variant ?? builtinDefault.variant) === builtinDefault.variant &&
    JSON.stringify(next.fallbackModels ?? builtinDefault.fallbackModels) ===
      JSON.stringify(builtinDefault.fallbackModels) &&
    nextSystemPrompt === defaultSystemPrompt;

  if (sameAsDefault) {
    delete catalog.builtinOverrides[agentId];
  } else {
    catalog.builtinOverrides[agentId] = next;
  }
  persistStoredCatalog(userId, catalog);
  return buildBuiltinAgentRecord(agentId, catalog.builtinOverrides[agentId]);
}

export function removeManagedAgentForUser(userId: string, agentId: string): void {
  const catalog = loadStoredCatalog(userId);
  if (catalog.customAgents[agentId]) {
    delete catalog.customAgents[agentId];
    persistStoredCatalog(userId, catalog);
    return;
  }
  throw new Error(`Builtin agent ${agentId} cannot be removed`);
}

export function resetManagedAgentForUser(userId: string, agentId: string): ManagedAgentRecord {
  const catalog = loadStoredCatalog(userId);
  if (catalog.customAgents[agentId]) {
    const current = catalog.customAgents[agentId];
    current.current = current.defaultBody;
    current.enabled = true;
    current.updatedAt = new Date().toISOString();
    persistStoredCatalog(userId, catalog);
    return buildCustomAgentRecord(current);
  }
  if (BUILTIN_AGENT_MAP.has(agentId)) {
    delete catalog.builtinOverrides[agentId];
    persistStoredCatalog(userId, catalog);
    return buildBuiltinAgentRecord(agentId);
  }
  throw new Error(`Agent ${agentId} not found`);
}

export function resetAllManagedAgentsForUser(userId: string): ManagedAgentRecord[] {
  const catalog = loadStoredCatalog(userId);
  catalog.builtinOverrides = {};
  for (const customAgent of Object.values(catalog.customAgents)) {
    customAgent.current = customAgent.defaultBody;
    customAgent.enabled = true;
    customAgent.updatedAt = new Date().toISOString();
  }
  persistStoredCatalog(userId, catalog);
  return listManagedAgentsForUser(userId);
}
