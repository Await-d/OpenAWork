import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function webStaticPlugin(app: FastifyInstance): Promise<void> {
  const webDistPath = join(__dirname, '../../apps/web/dist');

  if (!existsSync(webDistPath)) return;

  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    decorateReply: true,
  });

  const indexHtml = readFileSync(join(webDistPath, 'index.html'), 'utf8');

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    void reply.type('text/html').send(indexHtml);
  });
}

export default fp(webStaticPlugin);
