import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../request-workflow-log-store.js', () => ({
  persistRequestWorkflowLog: () => undefined,
}));

import requestWorkflowPlugin, { startRequestWorkflow } from '../request-workflow.js';

describe('request workflow helper', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation((_msg?: unknown) => undefined);
    app = Fastify();
    await app.register(requestWorkflowPlugin);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('allows suffix-only child names under a route root', async () => {
    app.get('/valid', async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'demo.route');
      const parseStep = child('parse-body');

      parseStep.succeed();
      step.succeed();
      return reply.send({ ok: true });
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/valid' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it('rejects empty workflow child suffixes at runtime', async () => {
    app.get('/invalid-empty', async (request: FastifyRequest, reply: FastifyReply) => {
      const { child } = startRequestWorkflow(request, 'demo.route');
      const suffix = String('');
      child(suffix);
      return reply.send({ ok: true });
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/invalid-empty' });

    expect(response.statusCode).toBe(500);
  });

  it('rejects root-prefixed workflow child suffixes at runtime', async () => {
    app.get('/invalid-prefixed', async (request: FastifyRequest, reply: FastifyReply) => {
      const { child } = startRequestWorkflow(request, 'demo.route');
      const suffix = String('demo.route.parse-body');
      child(suffix);
      return reply.send({ ok: true });
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/invalid-prefixed' });

    expect(response.statusCode).toBe(500);
  });

  it('auto-completes pending business steps as success on successful responses', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation((_msg?: unknown) => undefined);

    app.get('/auto-success', async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'demo.auto-success');
      child('query');
      void step;
      return reply.send({ ok: true });
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/auto-success' });

    expect(response.statusCode).toBe(200);
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
    expect(output).toContain('demo.auto-success');
    expect(output).toContain('query');
    expect(output).toContain('[成功]');
  });

  it('auto-completes pending business steps as failure on uncaught errors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation((_msg?: unknown) => undefined);

    app.get('/auto-fail', async (request: FastifyRequest) => {
      const { step, child } = startRequestWorkflow(request, 'demo.auto-fail');
      child('query');
      void step;
      throw new Error('boom');
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/auto-fail' });

    expect(response.statusCode).toBe(500);
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
    expect(output).toContain('demo.auto-fail');
    expect(output).toContain('query');
    expect(output).toContain('[失败]');
    expect(output).toContain('boom');
  });
});
