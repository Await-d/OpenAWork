import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { startRequestWorkflow } from '../request-workflow.js';
import * as agentCore from '@openAwork/agent-core';

type SSHConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
  password?: string;
  status: 'connected' | 'disconnected' | 'error';
  createdAt: number;
};

type SSHFileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
};

type SSHFilePreview = {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  truncated: boolean;
};

type SSHConnectionManagerLike = {
  listConnections(): SSHConnection[];
  addConnection(conn: SSHConnection): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]>;
  readFile(id: string, remotePath: string): Promise<SSHFilePreview>;
  writeFile(id: string, remotePath: string, content: string | Uint8Array): Promise<void>;
};

type AgentCoreRuntime = typeof agentCore & {
  default?: Partial<
    Pick<typeof agentCore, 'SSHConnectionManagerImpl' | 'SSHSessionBindingRegistry'>
  >;
};

const agentCoreRuntime = (agentCore as AgentCoreRuntime).default ?? agentCore;
const SSHConnectionManagerImpl = agentCoreRuntime.SSHConnectionManagerImpl;
const SSHSessionBindingRegistry = agentCoreRuntime.SSHSessionBindingRegistry;

if (!SSHConnectionManagerImpl || !SSHSessionBindingRegistry) {
  throw new Error('SSH runtime exports are unavailable from @openAwork/agent-core');
}

const sshManager: SSHConnectionManagerLike = new SSHConnectionManagerImpl();
const sshSessionBindings = new SSHSessionBindingRegistry();

const connectionSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  authType: z.enum(['password', 'key', 'agent']),
  password: z.string().optional(),
  privateKeyPath: z.string().optional(),
});

const bindSchema = z.object({ sessionId: z.string().min(1) });
const fileSchema = z.object({ connectionId: z.string().min(1), path: z.string().min(1) });
const uploadSchema = z.object({
  connectionId: z.string().min(1),
  path: z.string().min(1),
  contentBase64: z.string().min(1),
});

export async function sshRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ssh/connections', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.list');
    const connections = sshManager.listConnections();
    step.succeed(undefined, { count: connections.length });
    return reply.send({ connections });
  });

  app.post('/ssh/connections', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.add');
    const parsed = connectionSchema.safeParse(request.body);
    if (!parsed.success) {
      step.fail('invalid body');
      return reply.status(400).send({ error: 'Invalid body' });
    }
    const connection: SSHConnection = {
      id: crypto.randomUUID(),
      status: 'disconnected',
      createdAt: Date.now(),
      ...parsed.data,
    };
    sshManager.addConnection(connection);
    step.succeed(undefined, { connectionId: connection.id });
    return reply.send({ connection });
  });

  app.post('/ssh/connections/:id/connect', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.connect');
    await sshManager.connect((request.params as { id: string }).id);
    step.succeed();
    return reply.send({ ok: true });
  });

  app.post(
    '/ssh/connections/:id/disconnect',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { step } = startRequestWorkflow(request, 'ssh.connections.disconnect');
      await sshManager.disconnect((request.params as { id: string }).id);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post('/ssh/connections/:id/bind', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.bind');
    const parsed = bindSchema.safeParse(request.body);
    if (!parsed.success) {
      step.fail('invalid body');
      return reply.status(400).send({ error: 'Invalid body' });
    }
    sshSessionBindings.bind(parsed.data.sessionId, (request.params as { id: string }).id);
    step.succeed(undefined, { sessionId: parsed.data.sessionId });
    return reply.send({ ok: true });
  });

  app.get('/ssh/files', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.files.list');
    const parsed = fileSchema.safeParse(request.query);
    if (!parsed.success) {
      step.fail('invalid query');
      return reply.status(400).send({ entries: [] });
    }
    const entries = await sshManager.listFiles(parsed.data.connectionId, parsed.data.path);
    step.succeed(undefined, { count: entries.length });
    return reply.send({ entries });
  });

  app.get('/ssh/file', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.read');
    const parsed = fileSchema.safeParse(request.query);
    if (!parsed.success) {
      step.fail('invalid query');
      return reply.status(400).send({ preview: null });
    }
    const preview = await sshManager.readFile(parsed.data.connectionId, parsed.data.path);
    step.succeed(undefined, { path: parsed.data.path });
    return reply.send({ preview });
  });

  app.post('/ssh/upload', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.upload');
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) {
      step.fail('invalid body');
      return reply.status(400).send({ ok: false });
    }
    const bytes = Uint8Array.from(Buffer.from(parsed.data.contentBase64, 'base64'));
    await sshManager.writeFile(parsed.data.connectionId, parsed.data.path, bytes);
    step.succeed(undefined, { bytes: bytes.length });
    return reply.send({ ok: true });
  });
}

export type { SSHFileEntry, SSHFilePreview };
