/**
 * 会话级 MCP 的**运行时风险策略**（261031 / T-10）。
 *
 * 会话级配置的来源是「对话里的一句话」，与设置页手填相比，可信度更低。因此新增
 * 三条默认收紧的规则：
 *
 *   1. **stdio 默认关闭**（`OPENAWORK_SESSION_EXTENSION_ALLOW_STDIO`）。
 *      stdio 传输等于「在网关宿主上启动一个子进程」，属宿主执行能力；把它默认放给
 *      对话侧，等于让一句提示词变成任意命令执行。用户级配置维持既有行为不变。
 *   2. **会话级 MCP 不接受 OAuth**。OAuth 的 state / token 目前按「用户 + server」
 *      落库，没有会话维度；在本期没有把授权事务绑定到会话身份之前，允许它会退化成
 *      「会话 A 发起授权、会话 B 拿到 token」。宁可先拒绝并指向设置页。
 *   3. **明文密钥不入库**。`secretRef` 必须指向本会话凭据存储里的真实条目；含密
 *      配置（携密 URL、凭据类参数、未知嵌套字段）由 `sessionMcpConfigSchema` 在
 *      提案阶段**直接拒绝**，不是「剥离后照存」——静默剥离会让用户以为自己配上了。
 *
 * 另外提供**最小环境**构造：会话级 stdio 子进程不再继承网关进程的全部环境变量，
 * 只保留运行命令所必需的白名单项，避免把网关自身的凭据带进第三方子进程。
 */

/** stdio 开关的环境变量名。 */
export const SESSION_EXTENSION_ALLOW_STDIO_ENV = 'OPENAWORK_SESSION_EXTENSION_ALLOW_STDIO';

import { z } from 'zod';
import {
  hasSessionExtensionSecret,
  isValidSessionExtensionSecretName,
} from './session-extension-secret-store.js';

export const sessionMcpConfigSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    transport: z.enum(['sse', 'stdio']),
    url: z.string().url().max(2000).optional(),
    command: z
      .string()
      .regex(/^[\w./\\:-]+$/)
      .max(300)
      .optional(),
    args: z.array(z.string().max(300)).max(80).optional(),
    cwd: z.string().max(1000).optional(),
    enabled: z.boolean().optional(),
    required: z.boolean().optional(),
    disabledTools: z.array(z.string().max(160)).max(300).optional(),
    oauth: z.literal(false).optional(),
    /**
     * 凭据注入点。声明了 `secretRef` 就必须声明它——否则「解析出的明文该塞到哪里」
     * 无从判断，只能靠猜，而猜错的后果是把密钥发到错误的地方。
     */
    secretBinding: z
      .object({
        kind: z.enum(['header', 'env']),
        name: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._-]{1,160}$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      (config.transport === 'sse' && !config.url) ||
      (config.transport === 'stdio' && !config.command)
    ) {
      ctx.addIssue({ code: 'custom', message: 'MCP 缺少传输所需的 url 或 command。' });
    }
    if (config.url) {
      const url = new URL(config.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        ctx.addIssue({ code: 'custom', message: '会话 MCP 端点不接受凭据、查询参数或 fragment。' });
      }
    }
    if (
      config.args?.some((arg) =>
        /token|secret|password|api[-_]?key|authorization|bearer|\$\{|\$\(|[;&|`]/i.test(arg),
      )
    ) {
      ctx.addIssue({ code: 'custom', message: '会话 MCP 参数不接受凭据或 shell 表达式。' });
    }
  });

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isSessionExtensionStdioAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[SESSION_EXTENSION_ALLOW_STDIO_ENV]?.trim().toLowerCase();
  return raw !== undefined && TRUTHY_VALUES.has(raw);
}

/** 会话级 `secretRef` 的命名空间前缀：`session:<sessionId>:<name>`。 */
const SESSION_SECRET_REF_PREFIX = 'session:';

/**
 * 校验会话级 `secretRef` 是否属于**本会话**。
 *
 * 不接受任意字符串：否则模型可以引用其他会话 / 用户的凭据引用（即便当前实现里
 * 引用只用于指向设置页条目，越权引用也必须在这里挡住，不能留作「将来实现时的口子」）。
 */
/**
 * 解析 `secretRef` 的**本会话内名称**；不属于本会话 / 格式非法返回 `null`。
 *
 * 单独导出是因为调用方需要的是名字（拿去查凭据存储），而不是布尔值——
 * 让每个调用点各自 `split(':')` 迟早会漂移成两套解析规则。
 */
export function parseSessionSecretRefName(params: {
  secretRef: string;
  sessionId: string;
}): string | null {
  const normalized = params.secretRef.trim();
  if (!normalized.startsWith(SESSION_SECRET_REF_PREFIX)) return null;
  const rest = normalized.slice(SESSION_SECRET_REF_PREFIX.length);
  const separatorIndex = rest.indexOf(':');
  if (separatorIndex <= 0) return null;
  const ownerSessionId = rest.slice(0, separatorIndex);
  const name = rest.slice(separatorIndex + 1);
  if (ownerSessionId !== params.sessionId) return null;
  return isValidSessionExtensionSecretName(name) ? name : null;
}

export function isSessionSecretRefOwnedBySession(params: {
  secretRef: string;
  sessionId: string;
}): boolean {
  return parseSessionSecretRefName(params) !== null;
}

export function buildSessionSecretRef(sessionId: string, name: string): string {
  return `${SESSION_SECRET_REF_PREFIX}${sessionId}:${name}`;
}

export interface SessionMcpRuntimeConfig {
  readonly transport?: unknown;
  readonly type?: unknown;
  readonly oauth?: unknown;
  readonly secretBinding?: unknown;
}

export interface SessionMcpRuntimePolicyInput {
  config: SessionMcpRuntimeConfig;
  secretRef: string | null;
  sessionId: string;
  env?: Record<string, string | undefined>;
  /** 与配置里的 `secretBinding` 同源；单独入参便于执行前的复核只带引用路径。 */
  secretBinding?: unknown;
}

/**
 * 返回拒绝原因；`null` 表示允许建立提案。
 *
 * 注意这是**提案入口**的检查，不是执行前的最终检查——执行时还会复核授权与摘要
 * （见 `session-extension-service.ts`）。
 */
export function resolveSessionMcpRuntimePolicyDenial(
  input: SessionMcpRuntimePolicyInput,
): string | null {
  // 只认 `transport`：会话 MCP 配置由 `sessionMcpConfigSchema`（`.strict()`，无 `type` 键）
  // 校验，带 `type` 的配置根本进不来。此前留了 `type` 兜底，那是个永不命中的分支，
  // 只会让人以为还有第二种配置形态。
  const transport = typeof input.config.transport === 'string' ? input.config.transport : null;

  if (transport === 'stdio' && !isSessionExtensionStdioAllowed(input.env)) {
    return `会话内暂不允许配置 stdio 传输的 MCP（会在网关宿主上启动子进程）。如确需使用，请由运维开启 ${SESSION_EXTENSION_ALLOW_STDIO_ENV}=1，或在设置页配置（用户级配置不受此限制）。`;
  }

  if (input.config.oauth !== undefined && input.config.oauth !== false) {
    return '会话内暂不允许为 MCP 配置 OAuth：当前授权事务尚未绑定会话身份，允许它会退化成跨会话共享凭据。请在设置页完成授权。';
  }

  if (input.secretRef !== null) {
    const name = parseSessionSecretRefName({
      secretRef: input.secretRef,
      sessionId: input.sessionId,
    });
    if (!name) {
      return 'secretRef 必须属于本会话（形如 session:<会话ID>:<名称>），不接受跨会话引用。';
    }
    if (!input.secretBinding && !input.config.secretBinding) {
      return '引用会话凭据时必须声明 secretBinding（凭据注入到哪个 header / 环境变量），否则无法安全地使用它。';
    }
    if (!hasSessionExtensionSecret(input.sessionId, name)) {
      return `会话内不存在名为「${name}」的凭据。请先由会话所有者在「会话扩展」面板录入，勿在对话中提交密钥。`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 最小环境
// ---------------------------------------------------------------------------

/**
 * 会话级 stdio 子进程允许继承的环境变量白名单。
 *
 * 只保留「让子进程能正常启动并找到可执行文件 / 证书」所必需的项；**不含**任何
 * 形如 `*_API_KEY` / `*_TOKEN` / `AI_*` 的网关凭据。用户级 stdio 配置仍走既有的
 * `createCleanMcpEnvironment`（只排除 npm/pnpm/yarn 变量），行为不变。
 */
const MINIMAL_ENV_ALLOWLIST_EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'ProgramFiles',
  'ProgramData',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
]);

function isAllowedMinimalEnvKey(key: string): boolean {
  if (MINIMAL_ENV_ALLOWLIST_EXACT.has(key)) return true;
  // Windows 下 `Path` / `PathExt` 大小写不固定。
  return MINIMAL_ENV_ALLOWLIST_EXACT.has(key.toUpperCase());
}

/**
 * 构造最小环境。
 *
 * `explicit` 是配置里显式要求的变量（已由 schema 校验）；它会被合入，因为用户
 * 明确要求该子进程需要它。其余一律不继承。
 */
export function buildMinimalStdioEnvironment(
  options: {
    baseEnv?: Record<string, string | undefined>;
    explicit?: Record<string, string>;
  } = {},
): Record<string, string> {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  const baseEnv = options.baseEnv ?? proc?.process?.env ?? {};
  const minimal: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (!isAllowedMinimalEnvKey(key)) continue;
    minimal[key] = value;
  }

  for (const [key, value] of Object.entries(options.explicit ?? {})) {
    minimal[key] = value;
  }

  return minimal;
}
