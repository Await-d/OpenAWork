import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import fp from 'fastify-plugin';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { redis, sqliteGet, sqliteRun } from './db.js';
import { ensureDefaultInstalledSkills } from '../skill/default-skills.js';
import { ensureDefaultWorkflowTemplates } from '../runtime/default-workflow-templates.js';
import { syncSystemSkillsForUser } from '../skill/system-skills.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { LoginRateLimiter, buildLoginRateLimitKey } from './login-rate-limiter.js';
import { hashPassword, verifyPassword } from './password-hash.js';

const JWT_SECRET = globalThis.process?.env['JWT_SECRET'] ?? 'change-me-in-production-min-32-chars';
const JWT_EXPIRES_IN = globalThis.process?.env['JWT_EXPIRES_IN'] ?? '15m';
const REFRESH_EXPIRES_DAYS = 7;
const ADMIN_EMAIL = globalThis.process?.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local';
// 与 index.ts 的 seedDefaultAdmin 必须保持一致：env 优先，否则用 'admin123456'。
// 用来判定 admin 是否还在用「写死的弱默认密码」——一旦用户启用 LAN Web 访问，
// 这条密码会变成局域网攻击面。前端会在 toggle on 之前强制改密。
const DEFAULT_ADMIN_PASSWORD = globalThis.process?.env['ADMIN_PASSWORD'] ?? 'admin123456';
const DESKTOP_AUTH_HEADER = 'x-openawork-desktop-auth';

// Brute-force throttle for credential login. Shared module instance so the
// counter survives across requests within the process. See login-rate-limiter.ts.
const loginRateLimiter = new LoginRateLimiter();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const desktopDefaultLoginSchema = z.object({
  deviceName: z.string().min(1).max(80).optional(),
  platform: z.enum(['desktop']).optional(),
});

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

function readHeaderValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === 'string' ? value : null;
}

export function hasValidDesktopAuthToken(request: FastifyRequest): boolean {
  const expected = globalThis.process?.env['OPENAWORK_DESKTOP_AUTH_TOKEN'];
  if (!expected || expected.length < 32) {
    return false;
  }

  const provided = readHeaderValue(request, DESKTOP_AUTH_HEADER);
  if (!provided || provided.length !== expected.length) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Delete every already-expired `refresh_tokens` row. Rows are only otherwise
 * removed on rotation / logout / password-change, and the refresh lookup
 * filters expired rows with `expires_at > datetime('now')` WITHOUT deleting
 * them — so a user who closes the browser without logging out leaves a dead
 * row that lingers for the table's lifetime (one per such session, growing
 * unbounded). Token issuance is low-frequency, so we prune opportunistically
 * on each issue/rotate. Best-effort: a prune failure must never block login.
 */
export function pruneExpiredRefreshTokens(): void {
  try {
    sqliteRun("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')");
  } catch {
    // Best-effort cleanup — never break token issuance on a prune failure.
  }
}

export function issueTokenPair(
  app: FastifyInstance,
  user: { id: string; email: string },
): TokenPair {
  const payload: JwtPayload = { sub: user.id, email: user.email };
  const accessToken = app.jwt.sign(payload);

  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400 * 1000).toISOString();

  sqliteRun(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [randomUUID(), user.id, tokenHash, expiresAt],
  );

  // Opportunistic cleanup of expired rows on this low-frequency write path.
  pruneExpiredRefreshTokens();

  redis.setex(`session:${user.id}:active`, 900, '1');
  return { accessToken, refreshToken, expiresIn: JWT_EXPIRES_IN };
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(jwtPlugin, {
    secret: JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRES_IN },
  });

  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { step, child } = startRequestWorkflow(request, 'auth.login');
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      step.fail('invalid input');
      return reply.status(400).send({ error: '请求参数无效。', issues: body.error.issues });
    }

    const { email, password } = body.data;

    // Brute-force throttle: reject early once a key (email+ip) has accumulated
    // too many recent failures, so an attacker can't hammer credentials.
    const rateLimitKey = buildLoginRateLimitKey(email, request.ip);
    const limit = loginRateLimiter.check(rateLimitKey);
    if (!limit.allowed) {
      step.fail('rate limited');
      return reply
        .status(429)
        .header('retry-after', String(limit.retryAfterSeconds))
        .send({
          error: '登录尝试过于频繁，请稍后再试。',
          retryAfterSeconds: limit.retryAfterSeconds,
        });
    }

    const lookupStep = child('lookup-user');
    const user = sqliteGet<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1',
      [email],
    );

    if (!user) {
      loginRateLimiter.recordFailure(rateLimitKey);
      lookupStep.fail('invalid credentials');
      step.fail('invalid credentials');
      return reply.status(401).send({ error: '邮箱或密码错误。' });
    }
    lookupStep.succeed(undefined, { userId: user.id });

    const verification = verifyPassword(password, user.password_hash);
    if (!verification.valid) {
      loginRateLimiter.recordFailure(rateLimitKey);
      step.fail('invalid credentials');
      return reply.status(401).send({ error: '邮箱或密码错误。' });
    }

    // Transparent upgrade: a legacy unsalted-SHA256 hash that just verified is
    // re-hashed with the current scheme on this successful login, so stored
    // credentials migrate to scrypt without forcing a reset.
    if (verification.needsUpgrade) {
      try {
        sqliteRun('UPDATE users SET password_hash = ? WHERE id = ?', [
          hashPassword(password),
          user.id,
        ]);
      } catch {
        // Best-effort migration: never block a valid login on the re-hash write.
      }
    }

    // Successful login clears the failure counter for this key.
    loginRateLimiter.recordSuccess(rateLimitKey);

    const issueTokenStep = child('issue-tokens', undefined, { userId: user.id });
    const tokenPair = issueTokenPair(app, user);
    issueTokenStep.succeed();
    step.succeed(undefined, { userId: user.id });

    return reply.send(tokenPair);
  });

  app.post('/auth/desktop-default', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasValidDesktopAuthToken(request)) {
      return reply.status(403).send({ error: '当前未启用桌面默认登录。' });
    }

    const body = desktopDefaultLoginSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: '请求参数无效。', issues: body.error.issues });
    }

    const user = sqliteGet<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = ? LIMIT 1',
      [ADMIN_EMAIL],
    );
    if (!user) {
      return reply.status(404).send({ error: '默认管理员账号不存在。' });
    }

    return reply.send(issueTokenPair(app, user));
  });

  /**
   * 桌面端用：检测 admin 账号当前的密码是否仍为种子默认值。返回 isDefault=true 时，
   * 桌面端 UI 应强制弹出改密表单，并禁止开启 LAN Web 访问；否则视作用户已自定义。
   * 用 X-OpenAWork-Desktop-Auth header 鉴权（仅桌面 sidecar 父进程能签发），
   * LAN 上的攻击者无法读到这个状态。
   */
  app.get('/auth/admin-password-status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasValidDesktopAuthToken(request)) {
      return reply.status(403).send({ error: '需要桌面端鉴权。' });
    }
    const user = sqliteGet<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = ? LIMIT 1',
      [ADMIN_EMAIL],
    );
    if (!user) {
      return reply.send({ exists: false, isDefault: false, email: ADMIN_EMAIL });
    }
    return reply.send({
      exists: true,
      isDefault: verifyPassword(DEFAULT_ADMIN_PASSWORD, user.password_hash).valid,
      email: ADMIN_EMAIL,
    });
  });

  /**
   * 桌面端用：覆盖 admin 账号密码。同样要求 X-OpenAWork-Desktop-Auth header；
   * 改完顺手把所有 refresh_tokens 失效掉，避免历史会话继续用旧凭据。
   */
  app.post('/auth/admin-set-password', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasValidDesktopAuthToken(request)) {
      return reply.status(403).send({ error: '需要桌面端鉴权。' });
    }
    const body = z.object({ newPassword: z.string().min(8).max(128) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: '请求参数无效。', issues: body.error.issues });
    }
    const user = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
      ADMIN_EMAIL,
    ]);
    if (!user) {
      return reply.status(404).send({ error: '管理员账号不存在。' });
    }
    const newHash = hashPassword(body.data.newPassword);
    sqliteRun('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    sqliteRun('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);
    redis.del(`session:${user.id}:active`);
    return reply.send({ ok: true });
  });

  /**
   * 桌面端专用：请求 sidecar 优雅退出。用途——
   * 1. 用户在「桌面端 → Web 端访问」section 点「关闭」时，即使 Tauri 进程并未持有
   *    该 sidecar 的 CommandChild 句柄（例如上次桌面崩溃残留的孤儿进程被新桌面
   *    adopt 了），仍然能通过本接口把它杀掉；
   * 2. 新桌面启动发现端口被占用时，先请占用方退出再 spawn 自己，保证 CommandChild
   *    句柄总是对应当前真实运行的 sidecar。
   *
   * 同样用 X-OpenAWork-Desktop-Auth header 鉴权（仅桌面 sidecar 父进程签发），
   * LAN 上的攻击者拿不到 token，也就无法把用户的 sidecar 停掉。
   */
  app.post('/__internal/shutdown', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasValidDesktopAuthToken(request)) {
      return reply.status(403).send({ error: '需要桌面端鉴权。' });
    }
    void reply.code(202).send({ status: 'shutting_down' });
    // 给 reply 一点时间 flush；再把 Fastify 主动关了以便 linger 中的 socket 能收到 FIN。
    setTimeout(() => {
      const proc = globalThis.process;
      if (proc) {
        proc.exit(0);
      }
    }, 100);
  });

  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { step, child } = startRequestWorkflow(request, 'auth.refresh');
    const body = z.object({ refreshToken: z.string() }).safeParse(request.body);
    if (!body.success) {
      step.fail('refresh token missing');
      return reply.status(400).send({ error: 'refreshToken required' });
    }

    const tokenHash = hashToken(body.data.refreshToken);

    const tokenLookupStep = child('lookup-token');
    const token = sqliteGet<{ user_id: string; expires_at: string }>(
      "SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now') LIMIT 1",
      [tokenHash],
    );

    if (!token) {
      tokenLookupStep.fail('invalid or expired token');
      step.fail('invalid or expired token');
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }
    tokenLookupStep.succeed(undefined, { userId: token.user_id });

    const userLookupStep = child('lookup-user', undefined, { userId: token.user_id });
    const user = sqliteGet<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = ? LIMIT 1',
      [token.user_id],
    );

    if (!user) {
      userLookupStep.fail('user not found');
      step.fail('user not found');
      return reply.status(401).send({ error: 'User not found' });
    }
    userLookupStep.succeed(undefined, { userId: user.id });

    const rotateTokenStep = child('rotate-token', undefined, { userId: user.id });
    sqliteRun('DELETE FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = app.jwt.sign(payload);
    const newRefreshToken = generateRefreshToken();
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400 * 1000).toISOString();

    sqliteRun(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), user.id, newHash, expiresAt],
    );

    // Opportunistic cleanup of expired rows on this low-frequency write path.
    pruneExpiredRefreshTokens();

    rotateTokenStep.succeed();
    step.succeed(undefined, { userId: user.id });

    return reply.send({ accessToken, refreshToken: newRefreshToken, expiresIn: JWT_EXPIRES_IN });
  });

  app.post(
    '/auth/logout',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'auth.logout');
      const payload = request.user as JwtPayload;
      sqliteRun('DELETE FROM refresh_tokens WHERE user_id = ?', [payload.sub]);
      redis.del(`session:${payload.sub}:active`);
      step.succeed(undefined, { userId: payload.sub });
      return reply.send({ ok: true });
    },
  );

  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { step, child } = startRequestWorkflow(request, 'auth.register');
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      step.fail('invalid input');
      return reply.status(400).send({ error: '请求参数无效。', issues: body.error.issues });
    }

    const { email, password } = body.data;
    const existingUserStep = child('check-existing');
    const existing = sqliteGet('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing) {
      existingUserStep.fail('email already registered');
      step.fail('email already registered');
      return reply.status(409).send({ error: '该邮箱已注册。' });
    }
    existingUserStep.succeed();

    const id = randomUUID();
    const passwordHash = hashPassword(password);
    const createUserStep = child('insert-user', undefined, { userId: id });
    sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id,
      email,
      passwordHash,
    ]);
    ensureDefaultInstalledSkills(id);
    ensureDefaultWorkflowTemplates(id);
    await syncSystemSkillsForUser(id).catch(() => {
      // System skills are best-effort: a missing or unreadable
      // ~/.claude/skills must not break user signup.
    });
    createUserStep.succeed();
    step.succeed(undefined, { userId: id });

    return reply.status(201).send({ ok: true });
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { step } = startRequestWorkflow(request, 'auth.verify');
  try {
    await request.jwtVerify();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未授权或登录已失效。';
    step.fail(message);
    reply.status(401).send({ error: '未授权或登录已失效。' });
    return;
  }

  // 令牌签名有效，但其 sub 可能已不存在于 users 表（DB 重置 / 用户被删 /
  // admin 重新播种生成了新 UUID 后旧令牌仍在用）。此时若放行，后续任何带
  // `user_id REFERENCES users(id)` 外键的写入（team_workspaces / sessions /
  // tasks …）都会以不透明的 `FOREIGN KEY constraint failed` 500 收场。
  // 在认证层提前拦截：孤儿令牌直接返回 401，提示前端重新登录。
  const payload = request.user as JwtPayload | undefined;
  const userId = payload?.sub;
  if (!userId) {
    step.fail('token missing subject');
    reply.status(401).send({ error: '未授权或登录已失效。' });
    return;
  }
  try {
    const userRow = sqliteGet<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [
      userId,
    ]);
    if (!userRow) {
      step.fail('user no longer exists');
      reply.status(401).send({
        error: '登录账号已失效，请重新登录。',
        code: 'auth_user_not_found',
      });
      return;
    }
  } catch (error) {
    // DB 查询本身失败（极少见）——不要把它误判成「用户不存在」而锁死所有请求，
    // 放行让下游按既有逻辑处理，避免一次 DB 抖动导致全站 401。
    step.fail(error instanceof Error ? error.message : 'user lookup failed');
    return;
  }

  step.succeed(undefined, { userId });
}

export default fp(authPlugin, { name: 'auth' });
