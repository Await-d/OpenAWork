/**
 * HTTP 客户端单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HttpClient,
  createHttpClient,
  HttpError,
  DEFAULT_RETRY_CONFIG,
  type HttpClientConfig,
  type Logger,
} from '../http-client.js';

// 模拟 fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

// 测试用的日志记录器
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('HttpClient', () => {
  let client: HttpClient;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('基础功能', () => {
    it('应该成功创建客户端', () => {
      const config: HttpClientConfig = {
        baseURL: 'https://api.example.com',
        timeout: 5000,
      };
      const client = createHttpClient(config);
      expect(client).toBeInstanceOf(HttpClient);
    });

    it('应该执行 GET 请求', async () => {
      const mockResponse = { data: 'test' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.get('https://api.example.com/test');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('应该执行 POST 请求', async () => {
      const mockResponse = { success: true };
      const requestBody = { name: 'test' };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.post('https://api.example.com/test', requestBody);

      expect(response.status).toBe(200);
      expect(response.data).toEqual(mockResponse);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[1]?.method).toBe('POST');
      expect(fetchCall?.[1]?.body).toBe(JSON.stringify(requestBody));
    });

    it('应该执行 PUT 请求', async () => {
      const mockResponse = { updated: true };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.put('https://api.example.com/test', { data: 'value' });

      expect(response.status).toBe(200);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[1]?.method).toBe('PUT');
    });

    it('应该执行 PATCH 请求', async () => {
      const mockResponse = { patched: true };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.patch('https://api.example.com/test', { field: 'new' });

      expect(response.status).toBe(200);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[1]?.method).toBe('PATCH');
    });

    it('应该执行 DELETE 请求', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.delete('https://api.example.com/test');

      expect(response.status).toBe(200);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[1]?.method).toBe('DELETE');
    });
  });

  describe('URL 处理', () => {
    it('应该正确拼接 baseURL 和相对路径', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({ baseURL: 'https://api.example.com' }, mockLogger);
      await client.get('/users');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[0]).toBe('https://api.example.com/users');
    });

    it('应该处理 baseURL 和路径的斜杠', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({ baseURL: 'https://api.example.com/' }, mockLogger);
      await client.get('/users');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall?.[0]).toBe('https://api.example.com/users');
    });

    it('应该添加查询参数', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      await client.get('https://api.example.com/users', {
        params: {
          page: 1,
          limit: 10,
          active: true,
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall?.[0] as string;
      expect(url).toContain('page=1');
      expect(url).toContain('limit=10');
      expect(url).toContain('active=true');
    });

    it('应该忽略 undefined 参数', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      await client.get('https://api.example.com/users', {
        params: {
          page: 1,
          filter: undefined,
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall?.[0] as string;
      expect(url).toContain('page=1');
      expect(url).not.toContain('filter');
    });
  });

  describe('请求头处理', () => {
    it('应该添加默认请求头', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient(
        {
          headers: {
            'X-Custom-Header': 'value',
          },
        },
        mockLogger,
      );

      await client.get('https://api.example.com/test');

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('X-Custom-Header')).toBe('value');
    });

    it('应该合并配置中的请求头', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient(
        {
          headers: {
            'X-Default': 'default',
          },
        },
        mockLogger,
      );

      await client.get('https://api.example.com/test', {
        headers: {
          'X-Custom': 'custom',
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('X-Default')).toBe('default');
      expect(headers.get('X-Custom')).toBe('custom');
    });

    it('应该添加 Bearer Token', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient(
        {
          token: 'test-token-123',
        },
        mockLogger,
      );

      await client.get('https://api.example.com/test');

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer test-token-123');
    });

    it('应该不覆盖已存在的 Authorization 头', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({ token: 'test-token' }, mockLogger);

      await client.get('https://api.example.com/test', {
        headers: {
          Authorization: 'Bearer custom-token',
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer custom-token');
    });

    it('应该自动添加 Content-Type 为 JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      await client.post('https://api.example.com/test', { data: 'value' });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('错误处理', () => {
    it('应该抛出 HTTP 错误', async () => {
      const errorResponse = { message: 'Not Found' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(errorResponse), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({ retry: { maxAttempts: 1 } }, mockLogger);

      try {
        await client.get('https://api.example.com/test');
        // 如果没有抛出错误，测试应该失败
        expect.fail('应该抛出 HttpError');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(404);
        expect(httpError.statusText).toBe('Not Found');
        expect(httpError.data).toEqual(errorResponse);
      }
    });

    it('应该处理非 JSON 错误响应', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
        }),
      );

      client = new HttpClient({ retry: { maxAttempts: 1 } }, mockLogger);

      try {
        await client.get('https://api.example.com/test');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(500);
        expect(httpError.data).toBe('Internal Server Error');
      }
    });

    it('应该处理网络错误', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      client = new HttpClient({ retry: { maxAttempts: 1 } }, mockLogger);

      await expect(client.get('https://api.example.com/test')).rejects.toThrow('Network error');
    });
  });

  describe('重试机制', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应该在失败时重试', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );

      client = new HttpClient(
        {
          retry: {
            maxAttempts: 3,
            initialDelayMs: 100,
          },
        },
        mockLogger,
      );

      const requestPromise = client.get('https://api.example.com/test');

      // 第一次失败
      await vi.advanceTimersByTimeAsync(0);
      // 等待第一次重试延迟
      await vi.advanceTimersByTimeAsync(150);
      // 第二次失败
      await vi.advanceTimersByTimeAsync(0);
      // 等待第二次重试延迟
      await vi.advanceTimersByTimeAsync(250);
      // 第三次成功
      await vi.advanceTimersByTimeAsync(0);

      const response = await requestPromise;
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('应该在达到最大重试次数后抛出错误', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      client = new HttpClient(
        {
          retry: {
            maxAttempts: 2,
            initialDelayMs: 100,
          },
        },
        mockLogger,
      );

      const requestPromise = client.get('https://api.example.com/test');
      const rejection = expect(requestPromise).rejects.toThrow('Network error');

      // 第一次失败
      await vi.advanceTimersByTimeAsync(0);
      // 等待重试延迟
      await vi.advanceTimersByTimeAsync(150);
      // 第二次失败
      await vi.advanceTimersByTimeAsync(0);

      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('应该不重试客户端错误（除了 408 和 429）', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Bad Request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient(
        {
          retry: {
            maxAttempts: 3,
          },
        },
        mockLogger,
      );

      await expect(client.get('https://api.example.com/test')).rejects.toThrow(HttpError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('应该重试 429 错误', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Too Many Requests' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );

      client = new HttpClient(
        {
          retry: {
            maxAttempts: 2,
            initialDelayMs: 100,
          },
        },
        mockLogger,
      );

      const requestPromise = client.get('https://api.example.com/test');

      // 第一次失败（429）
      await vi.advanceTimersByTimeAsync(0);
      // 等待重试延迟
      await vi.advanceTimersByTimeAsync(150);
      // 第二次成功
      await vi.advanceTimersByTimeAsync(0);

      const response = await requestPromise;
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('应该使用自定义重试判断', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Custom Error' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );

      client = new HttpClient(
        {
          retry: {
            maxAttempts: 2,
            initialDelayMs: 100,
            shouldRetry: () => true, // 重试所有错误
          },
        },
        mockLogger,
      );

      const requestPromise = client.get('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(0);

      const response = await requestPromise;
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('拦截器', () => {
    it('应该执行请求拦截器', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);

      const interceptor = vi.fn((config) => {
        return {
          ...config,
          headers: {
            ...config.headers,
            'X-Intercepted': 'true',
          },
        };
      });

      client.addRequestInterceptor(interceptor);
      await client.get('https://api.example.com/test');

      expect(interceptor).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers as Headers;
      expect(headers.get('X-Intercepted')).toBe('true');
    });

    it('应该执行响应拦截器', async () => {
      const mockResponse = { data: 'test' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({}, mockLogger);

      const interceptor = vi.fn((response) => {
        return {
          ...response,
          data: { ...response.data, intercepted: true },
        };
      });

      client.addResponseInterceptor(interceptor);
      const response = await client.get('https://api.example.com/test');

      expect(interceptor).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual({ ...mockResponse, intercepted: true });
    });

    it('应该执行错误拦截器', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );

      client = new HttpClient({ retry: { maxAttempts: 1 } }, mockLogger);

      const interceptor = vi.fn((error) => {
        return new HttpError('自定义错误消息', error.config, {
          status: error.status,
          statusText: error.statusText,
          headers: error.headers,
          data: error.data,
        });
      });

      client.addErrorInterceptor(interceptor);

      try {
        await client.get('https://api.example.com/test');
      } catch (error) {
        expect(interceptor).toHaveBeenCalledTimes(1);
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).message).toBe('自定义错误消息');
      }
    });
  });

  describe('请求取消', () => {
    it('应该支持 AbortController 取消请求', async () => {
      const controller = new AbortController();

      mockFetch.mockImplementationOnce(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }, 1000);
        });
      });

      client = new HttpClient({ retry: { maxAttempts: 1 } }, mockLogger);

      const requestPromise = client.get('https://api.example.com/test', {
        signal: controller.signal,
      });

      // 立即取消请求
      controller.abort();

      await expect(requestPromise).rejects.toThrow('请求已取消');
    });
  });

  describe('超时控制', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应该在超时后抛出错误', async () => {
      mockFetch.mockImplementationOnce(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }, 10000);
        });
      });

      client = new HttpClient({ timeout: 5000, retry: { maxAttempts: 1 } }, mockLogger);

      const requestPromise = client.get('https://api.example.com/test');
      const rejection = expect(requestPromise).rejects.toThrow('请求超时');

      // 推进时间超过超时时间
      await vi.advanceTimersByTimeAsync(5001);

      await rejection;
    });
  });

  describe('日志记录', () => {
    it('应该记录请求和响应', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const mockLogger = createMockLogger();
      client = new HttpClient({ enableLogging: true }, mockLogger);

      await client.get('https://api.example.com/test');

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('应该记录错误', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const mockLogger = createMockLogger();
      client = new HttpClient({ enableLogging: true, retry: { maxAttempts: 1 } }, mockLogger);

      try {
        await client.get('https://api.example.com/test');
      } catch {
        // 忽略错误
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('响应类型', () => {
    it('应该支持 text 响应', async () => {
      const textResponse = 'Hello World';
      mockFetch.mockResolvedValueOnce(
        new Response(textResponse, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.get('https://api.example.com/test', {
        responseType: 'text',
      });

      expect(response.data).toBe(textResponse);
    });

    it('应该支持 blob 响应', async () => {
      const blobData = new Blob(['test'], { type: 'text/plain' });
      mockFetch.mockResolvedValueOnce(
        new Response(blobData, {
          status: 200,
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.get('https://api.example.com/test', {
        responseType: 'blob',
      });

      expect(response.data).toBeInstanceOf(Blob);
    });

    it('应该支持 stream 响应', async () => {
      const stream = new ReadableStream();
      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
        }),
      );

      client = new HttpClient({}, mockLogger);
      const response = await client.get('https://api.example.com/test', {
        responseType: 'stream',
      });

      expect(response.data).toBeInstanceOf(ReadableStream);
    });
  });

  describe('默认配置', () => {
    it('DEFAULT_RETRY_CONFIG 应该有正确的值', () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.2);
    });
  });
});
