/**
 * 全局错误处理器的记录契约测试。
 *
 * 这些断言守护的是本次修复的核心目标——「任何离开错误处理器的错误都必须在服务端
 * 留下痕迹」。一旦回退成「4xx 只返回响应不记日志」，下面的用例会立刻失败。
 *
 * 刻意采集**真实 pino 输出**而不是 mock `app.log`：级别路由（error/warn/info）
 * 本身就是被测行为的一部分，mock 会把它一并 mock 掉。
 */
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../infra/error-handler.js';
import { ApiError } from '../../infra/error-response.js';

interface LogEntry {
  level: number;
  msg: string;
  requestId?: string;
  method?: string;
  path?: string;
  code?: string;
  userId?: string | null;
  statusCode?: number;
  err?: { message?: string; type?: string; stack?: string };
}

const LEVEL_ERROR = 50;
const LEVEL_WARN = 40;
const LEVEL_INFO = 30;

function buildApp(): { app: FastifyInstance; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const app = Fastify({
    logger: {
      level: 'trace',
      stream: {
        write: (line: string): void => {
          try {
            entries.push(JSON.parse(line) as LogEntry);
          } catch {
            // 非 JSON 行（异常路径下的兜底输出）不参与断言。
          }
        },
      },
    },
  });
  registerErrorHandler(app);
  return { app, entries };
}

function hasEntry(
  entries: LogEntry[],
  level: number,
  predicate: (entry: LogEntry) => boolean,
): boolean {
  return entries.some((entry) => entry.level === level && predicate(entry));
}

describe('registerErrorHandler', () => {
  it('未知错误记 error 级日志并携带堆栈，响应体不泄露内部信息', async () => {
    const { app, entries } = buildApp();
    app.get('/boom', async () => {
      throw new Error('底层炸了');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json().name).toBe('InternalError');
    expect(response.body).not.toContain('底层炸了');
    expect(response.headers['x-request-id']).toBeTruthy();

    expect(hasEntry(entries, LEVEL_ERROR, (entry) => entry.msg.includes('/boom'))).toBe(true);
    const errorEntry = entries.find((entry) => entry.level === LEVEL_ERROR);
    // 堆栈是「无法排查」的另一半：只有 message 时定位不到代码位置。
    expect(errorEntry?.err?.stack).toContain('error-handler.test');
    expect(errorEntry?.err?.stack).toContain('底层炸了');
    await app.close();
  });

  it('ApiError 5xx 记 error 级，4xx 记 info 级（不刷屏但可检索）', async () => {
    const { app, entries } = buildApp();
    app.get('/server-error', async () => {
      throw ApiError.internal('数据库不可用');
    });
    app.get('/missing-thing', async () => {
      throw ApiError.notFound('会话不存在。');
    });

    await app.inject({ method: 'GET', url: '/server-error' });
    await app.inject({ method: 'GET', url: '/missing-thing' });

    expect(hasEntry(entries, LEVEL_ERROR, (e) => e.msg.includes('数据库不可用'))).toBe(true);
    expect(hasEntry(entries, LEVEL_INFO, (e) => e.msg.includes('会话不存在。'))).toBe(true);
    expect(hasEntry(entries, LEVEL_ERROR, (e) => e.msg.includes('会话不存在。'))).toBe(false);
    await app.close();
  });

  it('入站 x-request-id 被沿用，使客户端与网关日志可交叉检索', async () => {
    const { app, entries } = buildApp();
    app.get('/echo', async () => {
      throw ApiError.badRequest('参数不合法。');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-request-id': 'client-supplied-id' },
    });

    expect(response.headers['x-request-id']).toBe('client-supplied-id');
    expect(entries.some((entry) => entry.requestId === 'client-supplied-id')).toBe(true);
    await app.close();
  });

  it('未匹配路由的 404 被记为 warn，便于发现客户端版本落后', async () => {
    const { app, entries } = buildApp();

    const response = await app.inject({ method: 'GET', url: '/never-registered' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(hasEntry(entries, LEVEL_WARN, (entry) => entry.msg.includes('路由未命中'))).toBe(true);
    await app.close();
  });

  it('404 响应体保持 Fastify 默认形状，不因新增日志而改变客户端契约', async () => {
    const { app } = buildApp();

    const response = await app.inject({ method: 'GET', url: '/never-registered' });
    const body = response.json() as { statusCode?: number; error?: string; message?: string };

    // 客户端可能已按 Fastify 默认结构解析 404，这里锁定形状防止无声改契约。
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('/never-registered');
    await app.close();
  });

  it('入站 requestId 超长时重新生成，避免日志字段被注入撑爆', async () => {
    const { app, entries } = buildApp();
    app.get('/echo', async () => {
      throw ApiError.badRequest('参数不合法。');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-request-id': 'x'.repeat(500) },
    });

    const echoed = String(response.headers['x-request-id']);
    expect(echoed.length).toBeGreaterThan(0);
    expect(echoed.length).toBeLessThanOrEqual(200);
    expect(entries.some((entry) => entry.requestId === echoed)).toBe(true);
    await app.close();
  });
});
