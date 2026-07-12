import { useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ChannelDescriptorTool,
  ChannelMemberAclPermissionPatchDraft,
  ChannelMemberAclRuleDraft,
  ChannelPermissionsEntry,
} from './channel-subscription-settings.types.js';

type ToolMode = 'inherit' | 'custom' | 'none';
type PermissionMode = 'inherit' | 'allow' | 'deny';
type ReadablePathMode = 'inherit' | 'custom';
type PermissionModeKey = Exclude<
  keyof EditableMemberAclRule['permissionModes'],
  'readablePathPrefixes'
>;

interface EditableMemberAclRule {
  platformUserId: string;
  senderName: string;
  workspaceId: string;
  userId: string;
  toolMode: ToolMode;
  toolAllowlist: string[];
  permissionModes: {
    allowReadHome: PermissionMode;
    allowWriteOutside: PermissionMode;
    allowShell: PermissionMode;
    allowSubAgents: PermissionMode;
    readablePathPrefixes: ReadablePathMode;
  };
  readablePathPrefixes: string[];
}

interface ParsedMemberAclDocument {
  format: 'array' | 'versioned';
  rules: EditableMemberAclRule[];
}

const DEFAULT_REPLY_TOOL_KEY = 'PluginReplyMessage';
const PERMISSION_MODE_OPTIONS: Array<{ key: PermissionMode; label: string }> = [
  { key: 'inherit', label: '跟随通道' },
  { key: 'allow', label: '允许' },
  { key: 'deny', label: '禁用' },
];
const TOOL_MODE_OPTIONS: Array<{ key: ToolMode; label: string }> = [
  { key: 'inherit', label: '跟随通道' },
  { key: 'custom', label: '仅允许下列工具' },
  { key: 'none', label: '禁用全部' },
];
const READABLE_PATH_MODE_OPTIONS: Array<{ key: ReadablePathMode; label: string }> = [
  { key: 'inherit', label: '跟随通道' },
  { key: 'custom', label: '仅允许这些路径' },
];
const BOOLEAN_PERMISSION_FIELDS: Array<{
  key: PermissionModeKey;
  title: string;
  description: string;
}> = [
  {
    key: 'allowReadHome',
    title: '读取 Home',
    description: '控制是否继承通道级的 Home 目录读取能力。',
  },
  {
    key: 'allowWriteOutside',
    title: '工作区外写入',
    description: '控制是否继承通道级的跨工作区写入能力。',
  },
  {
    key: 'allowShell',
    title: 'Shell',
    description: '控制是否允许命中的成员触发命令行与脚本工具。',
  },
  {
    key: 'allowSubAgents',
    title: '子代理',
    description: '控制是否允许命中的成员继续派生子任务。',
  },
];

interface ChannelMemberAclEditorProps {
  value: string;
  onChange: (value: string) => void;
  toolOptions: readonly ChannelDescriptorTool[];
  basePermissions: ChannelPermissionsEntry;
}

interface ToolCatalogEntry extends ChannelDescriptorTool {
  source: 'descriptor' | 'acl';
}

const MEMBER_ACL_RULE_KEYS = new Set([
  'platformUserId',
  'senderName',
  'workspaceId',
  'userId',
  'toolAllowlist',
  'permissions',
]);
const MEMBER_ACL_PERMISSION_KEYS = new Set([
  'allowReadHome',
  'readablePathPrefixes',
  'allowWriteOutside',
  'allowShell',
  'allowSubAgents',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}包含不支持的字段：${key}`);
    }
  }
}

function normalizeStringList(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function parseOptionalStringField(
  value: Record<string, unknown>,
  key: 'senderName' | 'workspaceId' | 'userId',
): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string') {
    throw new Error(`字段 ${key} 必须是字符串。`);
  }
  return field;
}

function parseToolAllowlistField(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('toolAllowlist 必须是字符串数组。');
  }
  return normalizeStringList(value);
}

function parsePermissionsField(value: unknown): ChannelMemberAclPermissionPatchDraft | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('permissions 必须是对象。');
  }

  assertAllowedKeys(value, MEMBER_ACL_PERMISSION_KEYS, 'permissions');

  const permissions: ChannelMemberAclPermissionPatchDraft = {};
  for (const key of BOOLEAN_PERMISSION_FIELDS) {
    const fieldValue = value[key.key];
    if (fieldValue === undefined) {
      continue;
    }
    if (typeof fieldValue !== 'boolean') {
      throw new Error(`permissions.${key.key} 必须是布尔值。`);
    }
    permissions[key.key] = fieldValue;
  }

  const readablePathPrefixes = value['readablePathPrefixes'];
  if (readablePathPrefixes !== undefined) {
    if (
      !Array.isArray(readablePathPrefixes) ||
      readablePathPrefixes.some((item) => typeof item !== 'string')
    ) {
      throw new Error('permissions.readablePathPrefixes 必须是字符串数组。');
    }
    permissions.readablePathPrefixes = normalizeStringList(readablePathPrefixes);
  }

  return permissions;
}

function parseRuleDraft(value: unknown): ChannelMemberAclRuleDraft {
  if (!isRecord(value)) {
    throw new Error('每条成员 ACL 规则都必须是对象。');
  }

  assertAllowedKeys(value, MEMBER_ACL_RULE_KEYS, '成员 ACL 规则');

  const platformUserId = value['platformUserId'];
  if (platformUserId !== undefined && typeof platformUserId !== 'string') {
    throw new Error('platformUserId 必须是字符串。');
  }

  const senderName = parseOptionalStringField(value, 'senderName');
  const workspaceId = parseOptionalStringField(value, 'workspaceId');
  const userId = parseOptionalStringField(value, 'userId');
  const toolAllowlist = parseToolAllowlistField(value['toolAllowlist']);
  const permissions = parsePermissionsField(value['permissions']);

  return {
    platformUserId: typeof platformUserId === 'string' ? platformUserId : '',
    ...(senderName ? { senderName } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(userId ? { userId } : {}),
    ...(toolAllowlist !== undefined ? { toolAllowlist } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

function parsePermissionMode(value: unknown): PermissionMode {
  if (value === true) {
    return 'allow';
  }
  if (value === false) {
    return 'deny';
  }
  return 'inherit';
}

function parseToolMode(toolAllowlist: readonly string[] | null | undefined): ToolMode {
  if (toolAllowlist === undefined || toolAllowlist === null) {
    return 'inherit';
  }
  return toolAllowlist.length > 0 ? 'custom' : 'none';
}

function parseEditableRule(rule: ChannelMemberAclRuleDraft): EditableMemberAclRule {
  const permissions = rule.permissions;
  const rawToolAllowlist = Array.isArray(rule.toolAllowlist) ? rule.toolAllowlist : [];
  return {
    platformUserId: rule.platformUserId ?? '',
    senderName: rule.senderName ?? '',
    workspaceId: rule.workspaceId ?? '',
    userId: rule.userId ?? '',
    toolMode: parseToolMode(rule.toolAllowlist),
    toolAllowlist: normalizeStringList(rawToolAllowlist),
    permissionModes: {
      allowReadHome: parsePermissionMode(permissions?.allowReadHome),
      allowWriteOutside: parsePermissionMode(permissions?.allowWriteOutside),
      allowShell: parsePermissionMode(permissions?.allowShell),
      allowSubAgents: parsePermissionMode(permissions?.allowSubAgents),
      readablePathPrefixes:
        permissions && Array.isArray(permissions.readablePathPrefixes) ? 'custom' : 'inherit',
    },
    readablePathPrefixes: normalizeStringList(permissions?.readablePathPrefixes ?? []),
  };
}

function serializePermissionMode(mode: PermissionMode): boolean | undefined {
  if (mode === 'allow') {
    return true;
  }
  if (mode === 'deny') {
    return false;
  }
  return undefined;
}

function serializeEditableRule(rule: EditableMemberAclRule): ChannelMemberAclRuleDraft {
  const permissions: ChannelMemberAclPermissionPatchDraft = {};
  for (const field of BOOLEAN_PERMISSION_FIELDS) {
    const value = serializePermissionMode(rule.permissionModes[field.key]);
    if (value !== undefined) {
      switch (field.key) {
        case 'allowReadHome':
          permissions.allowReadHome = value;
          break;
        case 'allowWriteOutside':
          permissions.allowWriteOutside = value;
          break;
        case 'allowShell':
          permissions.allowShell = value;
          break;
        case 'allowSubAgents':
          permissions.allowSubAgents = value;
          break;
      }
    }
  }

  if (rule.permissionModes.readablePathPrefixes === 'custom') {
    permissions.readablePathPrefixes = normalizeStringList(rule.readablePathPrefixes);
  }

  const payload: ChannelMemberAclRuleDraft = {
    platformUserId: rule.platformUserId.trim(),
  };

  if (rule.senderName.trim()) {
    payload.senderName = rule.senderName.trim();
  }
  if (rule.workspaceId.trim()) {
    payload.workspaceId = rule.workspaceId.trim();
  }
  if (rule.userId.trim()) {
    payload.userId = rule.userId.trim();
  }

  if (rule.toolMode === 'custom') {
    payload.toolAllowlist = normalizeStringList(rule.toolAllowlist);
  } else if (rule.toolMode === 'none') {
    payload.toolAllowlist = [];
  }

  if (Object.keys(permissions).length > 0) {
    payload.permissions = permissions;
  }

  return payload;
}

function createEmptyRule(): EditableMemberAclRule {
  return {
    platformUserId: '',
    senderName: '',
    workspaceId: '',
    userId: '',
    toolMode: 'custom',
    toolAllowlist: [DEFAULT_REPLY_TOOL_KEY],
    permissionModes: {
      allowReadHome: 'inherit',
      allowWriteOutside: 'inherit',
      allowShell: 'inherit',
      allowSubAgents: 'inherit',
      readablePathPrefixes: 'inherit',
    },
    readablePathPrefixes: [],
  };
}

function serializeMemberAclDocument(document: ParsedMemberAclDocument): string {
  const rules = document.rules.map((rule) => serializeEditableRule(rule));
  if (rules.length === 0) {
    return '';
  }
  const payload =
    document.format === 'versioned'
      ? {
          version: 1 as const,
          rules,
        }
      : rules;
  return JSON.stringify(payload, null, 2);
}

function parseMemberAclDocument(value: string): ParsedMemberAclDocument {
  const trimmed = value.trim();
  if (!trimmed) {
    return { format: 'array', rules: [] };
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return {
      format: 'array',
      rules: parsed.map((rule) => parseEditableRule(parseRuleDraft(rule))),
    };
  }

  if (isRecord(parsed) && Array.isArray(parsed['rules'])) {
    assertAllowedKeys(parsed, new Set(['version', 'rules']), 'ACL 文档');
    if (parsed['version'] !== undefined && parsed['version'] !== 1) {
      throw new Error('当前只支持 version = 1 的 ACL 文档。');
    }
    return {
      format: 'versioned',
      rules: parsed['rules'].map((rule) => parseEditableRule(parseRuleDraft(rule))),
    };
  }

  throw new Error('只支持规则数组，或 { "version": 1, "rules": [...] } 结构。');
}

export function validateMemberAclDocumentForSave(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  try {
    const document = parseMemberAclDocument(value);
    return document.rules.every((rule) => rule.platformUserId.trim().length > 0);
  } catch {
    return false;
  }
}

function formatBasePermissionState(enabled: boolean, label: string): string {
  return `${label}${enabled ? '已开启' : '未开启'}`;
}

export function ChannelMemberAclEditor({
  value,
  onChange,
  toolOptions,
  basePermissions,
}: ChannelMemberAclEditorProps) {
  const [customToolInputs, setCustomToolInputs] = useState<Record<string, string>>({});
  const [customPathInputs, setCustomPathInputs] = useState<Record<string, string>>({});

  const parsedDocument = useMemo(() => {
    try {
      return {
        document: parseMemberAclDocument(value),
        error: null as string | null,
      };
    } catch (error) {
      return {
        document: null,
        error: error instanceof Error ? error.message : 'ACL JSON 解析失败',
      };
    }
  }, [value]);

  const toolCatalog = useMemo(() => {
    const catalog = new Map<string, ToolCatalogEntry>();
    for (const tool of toolOptions) {
      catalog.set(tool.key, { ...tool, source: 'descriptor' });
    }
    for (const rule of parsedDocument.document?.rules ?? []) {
      for (const toolKey of rule.toolAllowlist) {
        if (!catalog.has(toolKey)) {
          catalog.set(toolKey, {
            key: toolKey,
            label: toolKey,
            description: '来自现有 ACL 配置的自定义工具键。',
            source: 'acl',
          });
        }
      }
    }
    return Array.from(catalog.values());
  }, [parsedDocument.document?.rules, toolOptions]);

  function updateDocument(
    mutator: (document: ParsedMemberAclDocument) => ParsedMemberAclDocument,
  ): void {
    const document = parsedDocument.document;
    if (!document) {
      return;
    }
    onChange(serializeMemberAclDocument(mutator(document)));
  }

  function updateRule(
    index: number,
    mutator: (rule: EditableMemberAclRule) => EditableMemberAclRule,
  ): void {
    updateDocument((document) => ({
      ...document,
      rules: document.rules.map((rule, ruleIndex) => (ruleIndex === index ? mutator(rule) : rule)),
    }));
  }

  function addRule(): void {
    updateDocument((document) => ({
      ...document,
      rules: [...document.rules, createEmptyRule()],
    }));
  }

  function removeRule(index: number): void {
    updateDocument((document) => ({
      ...document,
      rules: document.rules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function updateToolMode(index: number, mode: ToolMode): void {
    updateRule(index, (rule) => ({
      ...rule,
      toolMode: mode,
      toolAllowlist:
        mode === 'inherit'
          ? []
          : mode === 'none'
            ? []
            : rule.toolAllowlist.length > 0
              ? rule.toolAllowlist
              : [DEFAULT_REPLY_TOOL_KEY],
    }));
  }

  function toggleTool(index: number, toolKey: string): void {
    updateRule(index, (rule) => {
      const exists = rule.toolAllowlist.includes(toolKey);
      return {
        ...rule,
        toolMode: 'custom',
        toolAllowlist: exists
          ? rule.toolAllowlist.filter((item) => item !== toolKey)
          : [...rule.toolAllowlist, toolKey],
      };
    });
  }

  function addCustomTool(index: number): void {
    const inputKey = String(index);
    const nextTool = customToolInputs[inputKey]?.trim() ?? '';
    if (!nextTool) {
      return;
    }
    updateRule(index, (rule) => ({
      ...rule,
      toolMode: 'custom',
      toolAllowlist: [...rule.toolAllowlist, nextTool],
    }));
    setCustomToolInputs((current) => ({ ...current, [inputKey]: '' }));
  }

  function addReadablePath(index: number): void {
    const inputKey = String(index);
    const nextPath = customPathInputs[inputKey]?.trim() ?? '';
    if (!nextPath) {
      return;
    }
    updateRule(index, (rule) => ({
      ...rule,
      permissionModes: {
        ...rule.permissionModes,
        readablePathPrefixes: 'custom',
      },
      readablePathPrefixes: [...rule.readablePathPrefixes, nextPath],
    }));
    setCustomPathInputs((current) => ({ ...current, [inputKey]: '' }));
  }

  function handleCustomToolKeyDown(
    index: number,
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomTool(index);
    }
  }

  function handleReadablePathKeyDown(
    index: number,
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      addReadablePath(index);
    }
  }

  if (!parsedDocument.document) {
    return (
      <div className="channel-acl">
        <div className="channel-notice">
          当前 `memberAclJson` 无法解析，结构化面板暂时不可用：{parsedDocument.error}
        </div>
        <div className="channel-acl__raw">
          <div className="channel-field__hint">
            你可以直接修复原始 JSON，或先清空后重新通过结构化面板配置。
          </div>
          <textarea
            className="channel-acl__textarea"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            aria-label="群成员 ACL 原始 JSON"
          />
          <div className="channel-acl__actions">
            <button
              type="button"
              className="channel-button channel-button--ghost"
              onClick={() => onChange('')}
            >
              清空 ACL
            </button>
            <button
              type="button"
              className="channel-button channel-button--primary"
              onClick={() =>
                onChange(
                  JSON.stringify(
                    [
                      {
                        platformUserId: '',
                        toolAllowlist: [DEFAULT_REPLY_TOOL_KEY],
                      },
                    ],
                    null,
                    2,
                  ),
                )
              }
            >
              重建为空白规则
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="channel-acl">
      <div className="channel-acl__notice">
        配置后，未命中的群成员会被拦截工具调用；若希望命中的成员能够正常回传文本，通常至少保留
        <code>PluginReplyMessage</code>。
      </div>

      <div className="channel-acl__ceiling">
        <span className="channel-mini-badge">
          {formatBasePermissionState(basePermissions.allowReadHome, 'Home 读取')}
        </span>
        <span className="channel-mini-badge">
          {formatBasePermissionState(basePermissions.allowShell, 'Shell')}
        </span>
        <span className="channel-mini-badge">
          {formatBasePermissionState(basePermissions.allowSubAgents, '子代理')}
        </span>
        <span className="channel-mini-badge">
          可读路径 {basePermissions.readablePathPrefixes.length} 条
        </span>
      </div>

      {parsedDocument.document.rules.length === 0 ? (
        <div className="channel-acl__empty">
          <div className="channel-acl__empty-title">暂未配置群成员规则</div>
          <div className="channel-field__hint">
            适合给特定 senderId 单独放行回复、搜索、文件或 Shell
            等工具。未命中的成员不会继承任何工具调用能力。
          </div>
          <button
            type="button"
            className="channel-button channel-button--primary"
            onClick={addRule}
          >
            新增成员规则
          </button>
        </div>
      ) : (
        <div className="channel-acl__list">
          {parsedDocument.document.rules.map((rule, index) => {
            const customToolInputKey = String(index);
            return (
              <article key={`${index}:${rule.platformUserId}`} className="channel-acl-rule">
                <div className="channel-acl-rule__header">
                  <div>
                    <div className="channel-acl-rule__title">成员规则 {index + 1}</div>
                    <div className="channel-acl-rule__subtitle">
                      {rule.senderName.trim()
                        ? `${rule.senderName.trim()} · ${rule.platformUserId.trim() || '未填写 senderId'}`
                        : rule.platformUserId.trim() || '尚未填写 senderId'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="channel-button channel-button--ghost"
                    onClick={() => removeRule(index)}
                  >
                    删除规则
                  </button>
                </div>

                <div className="channel-acl-grid">
                  <div className="channel-field">
                    <div className="channel-field__label">平台 senderId</div>
                    <div className="channel-field__hint">必须精确匹配平台实际用户 ID。</div>
                    <input
                      value={rule.platformUserId}
                      onChange={(event) =>
                        updateRule(index, (current) => ({
                          ...current,
                          platformUserId: event.target.value,
                        }))
                      }
                      placeholder="如 123456789"
                      aria-label={`成员规则 ${index + 1} 的平台 senderId`}
                    />
                  </div>
                  <div className="channel-field">
                    <div className="channel-field__label">成员备注名</div>
                    <div className="channel-field__hint">可选，仅用于后台识别。</div>
                    <input
                      value={rule.senderName}
                      onChange={(event) =>
                        updateRule(index, (current) => ({
                          ...current,
                          senderName: event.target.value,
                        }))
                      }
                      placeholder="如 研发负责人"
                      aria-label={`成员规则 ${index + 1} 的备注名`}
                    />
                  </div>
                  <div className="channel-field">
                    <div className="channel-field__label">绑定工作区 ID</div>
                    <div className="channel-field__hint">可选，命中后把对话锚定到指定工作区。</div>
                    <input
                      value={rule.workspaceId}
                      onChange={(event) =>
                        updateRule(index, (current) => ({
                          ...current,
                          workspaceId: event.target.value,
                        }))
                      }
                      placeholder="workspace-id"
                      aria-label={`成员规则 ${index + 1} 的工作区 ID`}
                    />
                  </div>
                  <div className="channel-field">
                    <div className="channel-field__label">绑定用户 ID</div>
                    <div className="channel-field__hint">可选，命中后映射到站内用户。</div>
                    <input
                      value={rule.userId}
                      onChange={(event) =>
                        updateRule(index, (current) => ({
                          ...current,
                          userId: event.target.value,
                        }))
                      }
                      placeholder="user-id"
                      aria-label={`成员规则 ${index + 1} 的用户 ID`}
                    />
                  </div>
                </div>

                <div className="channel-acl-card">
                  <div className="channel-acl-card__title">工具白名单</div>
                  <div className="channel-field__hint">
                    “禁用全部”会阻止命中的成员调用任何工具，包含回传消息工具。
                  </div>
                  <div
                    className="channel-segmented"
                    role="group"
                    aria-label={`成员规则 ${index + 1} 的工具模式`}
                  >
                    {TOOL_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className="channel-segmented__button"
                        aria-pressed={rule.toolMode === option.key}
                        onClick={() => updateToolMode(index, option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {rule.toolMode === 'custom' ? (
                    <div className="channel-acl-card__body">
                      <div className="channel-tool-grid">
                        {toolCatalog.map((tool) => (
                          <label key={tool.key} className="channel-check-card">
                            <input
                              type="checkbox"
                              checked={rule.toolAllowlist.includes(tool.key)}
                              onChange={() => toggleTool(index, tool.key)}
                            />
                            <div>
                              <div className="channel-check-card__title">{tool.label}</div>
                              <div className="channel-check-card__desc">{tool.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="channel-inline-entry">
                        <input
                          value={customToolInputs[customToolInputKey] ?? ''}
                          onChange={(event) =>
                            setCustomToolInputs((current) => ({
                              ...current,
                              [customToolInputKey]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => handleCustomToolKeyDown(index, event)}
                          placeholder="补充自定义工具键"
                          aria-label={`成员规则 ${index + 1} 的自定义工具键`}
                        />
                        <button
                          type="button"
                          className="channel-button channel-button--ghost"
                          onClick={() => addCustomTool(index)}
                        >
                          添加工具
                        </button>
                      </div>
                      {rule.toolAllowlist.length === 0 ? (
                        <div className="channel-field__hint">
                          当前没有允许任何工具，命中该成员后将无法主动回传消息。
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="channel-acl-card">
                  <div className="channel-acl-card__title">权限覆盖</div>
                  <div className="channel-field__hint">
                    这些开关只会继续收紧命中成员的能力，不会突破通道级上限。
                  </div>
                  <div className="channel-acl-permission-list">
                    {BOOLEAN_PERMISSION_FIELDS.map((field) => (
                      <div key={field.key} className="channel-acl-permission-row">
                        <div className="channel-acl-permission-copy">
                          <div className="channel-check-card__title">{field.title}</div>
                          <div className="channel-check-card__desc">{field.description}</div>
                        </div>
                        <div
                          className="channel-segmented"
                          role="group"
                          aria-label={`${field.title} 权限模式`}
                        >
                          {PERMISSION_MODE_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              className="channel-segmented__button channel-segmented__button--compact"
                              aria-pressed={
                                rule.permissionModes[field.key as PermissionModeKey] === option.key
                              }
                              onClick={() =>
                                updateRule(index, (current) => ({
                                  ...current,
                                  permissionModes: {
                                    ...current.permissionModes,
                                    [field.key]: option.key,
                                  },
                                }))
                              }
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="channel-acl-permission-row">
                      <div className="channel-acl-permission-copy">
                        <div className="channel-check-card__title">可读路径前缀</div>
                        <div className="channel-check-card__desc">
                          仅在命中的成员需要更窄路径白名单时使用。
                        </div>
                      </div>
                      <div className="channel-segmented" role="group" aria-label="可读路径模式">
                        {READABLE_PATH_MODE_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className="channel-segmented__button channel-segmented__button--compact"
                            aria-pressed={rule.permissionModes.readablePathPrefixes === option.key}
                            onClick={() =>
                              updateRule(index, (current) => ({
                                ...current,
                                permissionModes: {
                                  ...current.permissionModes,
                                  readablePathPrefixes: option.key,
                                },
                                readablePathPrefixes:
                                  option.key === 'inherit' ? [] : current.readablePathPrefixes,
                              }))
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {rule.permissionModes.readablePathPrefixes === 'custom' ? (
                    <div className="channel-acl-card__body">
                      <div className="channel-inline-entry">
                        <input
                          value={customPathInputs[customToolInputKey] ?? ''}
                          onChange={(event) =>
                            setCustomPathInputs((current) => ({
                              ...current,
                              [customToolInputKey]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => handleReadablePathKeyDown(index, event)}
                          placeholder="/workspace 或 /home/user/project"
                          aria-label={`成员规则 ${index + 1} 的可读路径前缀`}
                        />
                        <button
                          type="button"
                          className="channel-button channel-button--ghost"
                          onClick={() => addReadablePath(index)}
                        >
                          添加路径
                        </button>
                      </div>
                      <div className="channel-path-list">
                        {rule.readablePathPrefixes.length === 0 ? (
                          <span className="channel-mini-badge">暂未限制额外路径</span>
                        ) : (
                          rule.readablePathPrefixes.map((prefix) => (
                            <span key={prefix} className="channel-path-pill">
                              {prefix}
                              <button
                                type="button"
                                onClick={() =>
                                  updateRule(index, (current) => ({
                                    ...current,
                                    readablePathPrefixes: current.readablePathPrefixes.filter(
                                      (item) => item !== prefix,
                                    ),
                                  }))
                                }
                              >
                                移除
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="channel-acl__actions">
        {parsedDocument.document.rules.length > 0 ? (
          <button type="button" className="channel-button channel-button--ghost" onClick={addRule}>
            新增成员规则
          </button>
        ) : null}
        {value.trim() ? (
          <button
            type="button"
            className="channel-button channel-button--ghost"
            onClick={() => onChange('')}
          >
            清空 ACL
          </button>
        ) : null}
      </div>

      <details className="channel-acl__details" open={Boolean(parsedDocument.error)}>
        <summary>查看原始 JSON</summary>
        <div className="channel-acl__raw">
          <textarea
            className="channel-acl__textarea"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            aria-label="群成员 ACL 原始 JSON"
          />
        </div>
      </details>
    </div>
  );
}
