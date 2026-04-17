import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import fp from 'fastify-plugin';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { redis, sqliteGet, sqliteRun } from './db.js';
import { ensureDefaultInstalledSkills } from './default-skills.js';
import { ensureDefaultWorkflowTemplates } from './default-workflow-templates.js';
import { startRequestWorkflow } from './request-workflow.js';

const JWT_SECRET = globalThis.process?.env['JWT_SECRET'] ?? 'change-me-in-production-min-32-chars';
const JWT_EXPIRES_IN = globalThis.process?.env['JWT_EXPIRES_IN'] ?? '15m';
const REFRESH_EXPIRES_DAYS = 7;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export interface JwtPayload {
  sub: string;
  email: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
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
      return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
    }

    const { email, password } = body.data;
    const lookupStep = child('lookup-user');
    const user = sqliteGet<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1',
      [email],
    );

    if (!user) {
      lookupStep.fail('invalid credentials');
      step.fail('invalid credentials');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    lookupStep.succeed(undefined, { userId: user.id });

    const inputHash = createHash('sha256').update(password).digest('hex');
    if (inputHash !== user.password_hash) {
      step.fail('invalid credentials');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = app.jwt.sign(payload);

    const refreshToken = generateRefreshToken();
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400 * 1000).toISOString();

    const issueTokenStep = child('issue-tokens', undefined, { userId: user.id });
    sqliteRun(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), user.id, tokenHash, expiresAt],
    );

    redis.setex(`session:${user.id}:active`, 900, '1');
    issueTokenStep.succeed();
    step.succeed(undefined, { userId: user.id });

    return reply.send({ accessToken, refreshToken, expiresIn: JWT_EXPIRES_IN });
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
      return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
    }

    const { email, password } = body.data;
    const existingUserStep = child('check-existing');
    const existing = sqliteGet('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing) {
      existingUserStep.fail('email already registered');
      step.fail('email already registered');
      return reply.status(409).send({ error: 'Email already registered' });
    }
    existingUserStep.succeed();

    const id = randomUUID();
    const passwordHash = createHash('sha256').update(password).digest('hex');
    const createUserStep = child('insert-user', undefined, { userId: id });
    sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id,
      email,
      passwordHash,
    ]);
    ensureDefaultInstalledSkills(id);
    ensureDefaultWorkflowTemplates(id);
    createUserStep.succeed();
    step.succeed(undefined, { userId: id });

    return reply.status(201).send({ ok: true });
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { step } = startRequestWorkflow(request, 'auth.verify');
  try {
    await request.jwtVerify();
    step.succeed();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    step.fail(message);
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

export default fp(authPlugin);
