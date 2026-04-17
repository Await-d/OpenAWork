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
import { sqliteGet, sqliteRun } from './db.js';
import { BUILTIN_AGENT_REFERENCE_SNAPSHOT } from './agent-reference-snapshot.js';
import { getReferenceAgentModelCandidates } from './task-model-reference-snapshot.js';

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
  { id: 'build', label: 'build', description: '默认主 agent', source: 'builtin' },
  { id: 'plan', label: 'plan', description: '规划 agent', source: 'builtin' },
  { id: 'general', label: 'general', description: '通用 agent', source: 'builtin' },
  { id: 'explore', label: 'explore', description: '代码探索 agent', source: 'builtin' },
  {
    id: 'sisyphus',
    label: 'sisyphus',
    description: 'AI 编排代理 — 规划、委派、验证、交付',
    source: 'builtin',
  },
  {
    id: 'hephaestus',
    label: 'hephaestus',
    description: '自主深度工作者 — 深度探索、目标实施、强验证交付',
    source: 'builtin',
  },
  {
    id: 'prometheus',
    label: 'prometheus',
    description: '战略规划顾问 — 只规划不实施，将实施请求解读为创建工作计划',
    source: 'builtin',
  },
  {
    id: 'oracle',
    label: 'oracle',
    description: '只读战略顾问 — 架构决策、困难调试、自我审查',
    source: 'builtin',
  },
  {
    id: 'zeus',
    label: 'zeus',
    description: '团队领导 — MECE 任务拆解、角色分派、依赖优先级、审查门控',
    source: 'builtin',
  },
  {
    id: 'librarian',
    label: 'librarian',
    description: '代码库与文档检索专家 — 证据驱动、出处标注、请求分类检索',
    source: 'builtin',
  },
  {
    id: 'metis',
    label: 'metis',
    description: '预规划顾问 — 意图分类、AI-slop 检测、澄清问题生成',
    source: 'builtin',
  },
  {
    id: 'momus',
    label: 'momus',
    description: '计划审查专家 — 严苛审查、四维度检查、OKAY/REJECT 判定',
    source: 'builtin',
  },
  {
    id: 'atlas',
    label: 'atlas',
    description: '编排验证专家 — 委派任务、验证一切、没有证据=未完成',
    source: 'builtin',
  },
  {
    id: 'multimodal-looker',
    label: 'multimodal-looker',
    description: '多模态查看 agent',
    source: 'builtin',
  },
  {
    id: 'sisyphus-junior',
    label: 'sisyphus-junior',
    description: '按 category 路由的执行 agent',
    source: 'builtin',
  },
];

const BUILTIN_AGENT_MAP = new Map(BUILTIN_AGENT_BASE.map((item) => [item.id, item]));

const BUILTIN_AGENT_FALLBACK_PROMPTS: Record<string, string> = {
  build:
    'Coordinate the task, choose the most effective execution path, and drive the work to a practical result.',
  plan: 'Break the task into clear steps, expose dependencies and risks, and produce an execution plan.',
  general:
    'Handle general-purpose software work with balanced reasoning, concrete implementation, and verification.',
  explore:
    'Inspect the codebase, locate relevant files and patterns, and summarize grounded findings before changes.',
  sisyphus:
    '你是 Sisyphus — 强大的 AI 编排代理。你规划、委派、验证、交付。拒绝 AI slop。有专家时绝不独自工作，评估搜索复杂度后再探索，并行执行独立任务。',
  hephaestus:
    '你是 Hephaestus — 自主深度工作者。行动前深度探索，目标导向实施，强验证交付。绝不盲目动手，保持变更最小化。',
  prometheus:
    '你是 Prometheus — 战略规划顾问。你是规划者，不是实施者。绝不写代码，绝不执行任务。将实施请求解读为创建工作计划。单一计划强制，每个待办项必须有具体引用和验收标准。',
  oracle:
    '你是 Oracle — 战略技术顾问。只读模式，绝不修改文件。倾向简洁，利用已有，一条清晰路径。回答三层结构：结论+行动方案+工作量估算。',
  zeus: 'You are Zeus, the team leader. You DECOMPOSE intent into concrete tasks and ASSIGN each to the most suitable team role. You never execute tasks yourself — you orchestrate specialists. Apply MECE decomposition, single-responsibility assignment, dependency-aware priority ordering, and ensure every production code change has a review gate.',
  librarian:
    '你是 Librarian — 专业的代码库与文档检索专家。只读模式，证据驱动。每个结论必须附带来源。请求分类后按策略检索，先总结后展开。',
  metis:
    '你是 Metis — 预规划顾问。只读模式。识别意图类型，检测 AI-slop 风险（过度工程/范围蔓延/假设缺失/歧义），生成可回答的澄清问题。',
  momus:
    '你是 Momus — 计划审查专家。尊重实施方向，只评估计划是否清晰可执行。检查参考材料/业务需求/架构决策/关键上下文四个维度，给出 OKAY/REJECT 判定。',
  atlas:
    '你是 Atlas — 编排验证专家。委派任务，验证一切。没有证据 = 未完成。绝不自己写代码，绝不信任子 agent 的未验证声明。',
  'multimodal-looker':
    'Inspect visual or multimodal inputs and extract the details needed for the current task.',
  'sisyphus-junior':
    'Execute focused category-routed work quickly while keeping results concrete and verifiable.',
};

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
  const metadata = REFERENCE_AGENT_ROLE_METADATA[id];
  const reference = BUILTIN_AGENT_REFERENCE_SNAPSHOT[id];
  const modelCandidates = getReferenceAgentModelCandidates(id);
  return {
    label: reference?.label ?? builtin.label,
    description: reference?.description ?? builtin.description,
    aliases: metadata?.aliases ?? [],
    canonicalRole: metadata?.canonicalRole,
    model: modelCandidates[0],
    variant: undefined,
    fallbackModels: modelCandidates.slice(1),
    systemPrompt: reference?.systemPrompt ?? BUILTIN_AGENT_FALLBACK_PROMPTS[id],
    note: undefined,
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
  });

  const hasModelOverrides =
    (sanitizedOverride?.model ?? defaultBody.model) !== defaultBody.model ||
    (sanitizedOverride?.variant ?? defaultBody.variant) !== defaultBody.variant ||
    JSON.stringify(sanitizedOverride?.fallbackModels ?? defaultBody.fallbackModels) !==
      JSON.stringify(defaultBody.fallbackModels);

  return {
    id,
    origin: 'builtin',
    source: builtin.source,
    enabled: sanitizedOverride?.enabled ?? true,
    removable: false,
    resettable: hasModelOverrides,
    hasOverrides: hasModelOverrides,
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
    current.current = normalizeBody({
      ...current.current,
      ...input,
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
    'systemPrompt',
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
    updatedAt: now,
  };

  const builtinDefault = defaultBodyForBuiltin(agentId);
  const sameAsDefault =
    (next.model ?? builtinDefault.model) === builtinDefault.model &&
    (next.variant ?? builtinDefault.variant) === builtinDefault.variant &&
    JSON.stringify(next.fallbackModels ?? builtinDefault.fallbackModels) ===
      JSON.stringify(builtinDefault.fallbackModels);

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
