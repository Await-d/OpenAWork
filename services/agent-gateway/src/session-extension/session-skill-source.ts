/**
 * 会话级技能的**来源检查与固定内容快照**（skill 主线共用）。
 *
 * 两条边界必须在这里一次说清、且只在这里说：
 *
 * 1. **首期只支持已配置注册源的 prompt / manifest 型技能。**
 *    `github:` / `claude-marketplace:` 前缀与本地目录安装仍走设置页——
 *    它们的获取链（zipball / 目录扫描）与注册源不同，且需要更多信任确认。
 * 2. **不承诺「脚本与依赖已部署」。** 现有安装链拿到的是 manifest（`SkillManifest`
 *    只有 capabilities / permissions / mcp / references），并不会把 skill 仓库里的
 *    文件解压到某个可执行目录。声明了 `references`（需要读本地文件）或内嵌 stdio
 *    MCP 的技能，风险必须回传给模型与用户，而不是假装装完就能跑。
 *
 * 快照（`SessionSkillProposal`）一旦被审批，就以 `contentDigest` 冻结——执行阶段
 * 重新计算摘要并比对，避免「审批 A、执行 B」。
 */

import { createRegistryClient } from '../routes/skills.js';
import { computeSessionExtensionDigest } from './session-extension-store.js';

/** 首期不支持的安装来源前缀（与 `skill_manage` v1 的边界一致）。 */
const UNSUPPORTED_INSTALL_PREFIXES = ['github:', 'claude-marketplace:', 'local:'] as const;

export interface SessionSkillProposal {
  readonly skillId: string;
  readonly sourceId: string;
  readonly version: string | null;
  readonly displayName: string | null;
  readonly description: string | null;
  /** 已校验的 manifest 全文（快照本体）。 */
  readonly manifest: unknown;
  /** 内容摘要：审批与执行之间的一致性凭据。 */
  readonly contentDigest: string;
  readonly declaredPermissions: readonly unknown[];
  /** 内嵌 MCP（stdio 命令 = 宿主执行能力）。 */
  readonly hasMcp: boolean;
  /** 声明了需要读取的本地文件（manifest-only 快照无法提供）。 */
  readonly requiresLocalFiles: boolean;
  /** 需要向用户交代的风险点；空数组表示无额外说明。 */
  readonly warnings: readonly string[];
}

export interface SessionSkillSearchHit {
  readonly skillId: string;
  readonly sourceId: string;
  readonly displayName: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly category: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 搜索已配置注册源里的技能。
 *
 * 只返回**未安装也可见**的候选，供模型向用户复述来源；实际安装必须再走
 * `prepareSessionSkillInstall` 重新取一次内容（搜索结果里的 manifest 可能是
 * 缓存快照，不能直接当作审批对象）。
 */
export async function searchSessionSkills(params: {
  userId: string;
  query?: string;
  limit?: number;
}): Promise<SessionSkillSearchHit[]> {
  const client = createRegistryClient(params.userId);
  const entries = await client.search({
    query: params.query,
    limit: params.limit ?? 20,
  });
  return entries.map((entry) => ({
    skillId: entry.id,
    sourceId: entry.sourceId,
    displayName: entry.displayName || entry.name,
    version: entry.version ?? null,
    description: entry.description ?? null,
    category: entry.category ?? null,
  }));
}

/**
 * 取一次**新鲜**的技能内容并产出快照提案。
 *
 * 走与 HTTP 安装 / `skill_manage` 完全相同的注册源客户端，保证「对话里看到的」
 * 与「设置页装到的」是同一份内容。
 */
export async function prepareSessionSkillInstall(params: {
  userId: string;
  skillId: string;
  sourceId?: string;
}): Promise<SessionSkillProposal> {
  const skillId = params.skillId.trim();
  if (skillId.length === 0) {
    throw new Error('缺少 skillId。');
  }

  const unsupported = UNSUPPORTED_INSTALL_PREFIXES.find((prefix) => skillId.startsWith(prefix));
  if (unsupported) {
    throw new Error(`"${unsupported}" 来源的技能暂不支持在会话内安装，请在设置页 → 技能 中安装。`);
  }

  const client = createRegistryClient(params.userId);
  const record = await client.install(skillId, {
    sourceId: params.sourceId,
    skipSignatureVerification: true,
  });

  const manifest = record.manifest as unknown;
  const manifestRecord = asRecord(manifest);
  const warnings: string[] = [];

  const hasMcp = Boolean(manifestRecord?.['mcp']);
  if (hasMcp) {
    warnings.push('该技能内嵌 MCP：安装后会以当前会话身份连接该服务，请确认来源可信。');
  }

  const references = manifestRecord?.['references'];
  const requiresLocalFiles =
    Array.isArray(references) &&
    references.some((entry) => {
      const record2 = asRecord(entry);
      return record2 !== null && record2['loadAt'] === 'activation';
    });
  if (requiresLocalFiles) {
    warnings.push(
      '该技能声明了需在激活时读取的本地文件；当前安装只登记 manifest，未部署技能仓库文件，相关能力可能不可用。',
    );
  }

  const permissions = manifestRecord?.['permissions'];
  const declaredPermissions = Array.isArray(permissions) ? permissions : [];
  if (declaredPermissions.length > 0) {
    warnings.push('该技能声明了权限项，请向用户说明；声明权限不等于已授予运行权限。');
  }

  return {
    skillId: record.skillId,
    sourceId: record.sourceId,
    version: readString(manifestRecord ?? {}, 'version'),
    displayName:
      readString(manifestRecord ?? {}, 'displayName') ?? readString(manifestRecord ?? {}, 'name'),
    description: readString(manifestRecord ?? {}, 'description'),
    manifest,
    // 摘要覆盖 manifest 全量：任何字段变化都会换摘要 ⇒ 需要重新审批。
    contentDigest: computeSessionExtensionDigest(manifest),
    declaredPermissions,
    hasMcp,
    requiresLocalFiles,
    warnings,
  };
}
