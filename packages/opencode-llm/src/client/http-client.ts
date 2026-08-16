/**
 * HTTP 客户端
 *
 * 基于 fetch 的 HTTP 客户端，提供：
 * - 请求/响应拦截器
 * - 自动重试（指数退避 + 抖动）
 * - 请求超时控制
 * - 请求取消（AbortController）
 * - Bearer Token 认证
 * - 请求日志记录
 */

/**
 * HTTP 方法
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * HTTP 请求配置
 */
export interface HttpRequestConfig {
  /**
   * 请求 URL
   */
  readonly url: string;

  /**
   * HTTP 方法
   * @default 'GET'
   */
  readonly method?: HttpMethod;

  /**
   * 请求头
   */
  readonly headers?: Record<string, string>;

  /**
   * 请求体
   */
  readonly body?: BodyInit | Record<string, unknown>;

  /**
   * URL 查询参数
   */
  readonly params?: Record<string, string | number | boolean | undefined>;

  /**
   * 超时时间（毫秒）
   * @default 30000
   */
  readonly timeout?: number;

  /**
   * 取消信号
   */
  readonly signal?: AbortSignal;

  /**
   * 响应类型
   * @default 'json'
   */
  readonly responseType?: 'json' | 'text' | 'blob' | 'arraybuffer' | 'stream';
}

/**
 * HTTP 响应
 */
export interface HttpResponse<T = unknown> {
  /**
   * 响应状态码
   */
  readonly status: number;

  /**
   * 响应状态文本
   */
  readonly statusText: string;

  /**
   * 响应头
   */
  readonly headers: Headers;

  /**
   * 响应数据
   */
  readonly data: T;

  /**
   * 原始请求配置
   */
  readonly config: HttpRequestConfig;
}

/**
 * HTTP 错误
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Headers;
  readonly data?: unknown;
  readonly config: HttpRequestConfig;

  constructor(
    message: string,
    config: HttpRequestConfig,
    options?: {
      status?: number;
      statusText?: string;
      headers?: Headers;
      data?: unknown;
    },
  ) {
    super(message);
    this.config = config;
    this.status = options?.status;
    this.statusText = options?.statusText;
    this.headers = options?.headers;
    this.data = options?.data;
  }
}

/**
 * 请求拦截器
 */
export type RequestInterceptor = (
  config: HttpRequestConfig,
) => HttpRequestConfig | Promise<HttpRequestConfig>;

/**
 * 响应拦截器
 */
export type ResponseInterceptor = <T>(
  response: HttpResponse<T>,
) => HttpResponse<T> | Promise<HttpResponse<T>>;

/**
 * 错误拦截器
 */
export type ErrorInterceptor = (error: HttpError) => HttpError | Promise<HttpError>;

/**
 * 重试配置
 */
export interface RetryConfig {
  /**
   * 最大重试次数
   * @default 3
   */
  readonly maxAttempts: number;

  /**
   * 初始延迟时间（毫秒）
   * @default 1000
   */
  readonly initialDelayMs: number;

  /**
   * 最大延迟时间（毫秒）
   * @default 30000
   */
  readonly maxDelayMs: number;

  /**
   * 退避倍数
   * @default 2
   */
  readonly backoffMultiplier: number;

  /**
   * 抖动因子（0-1 之间）
   * @default 0.2
   */
  readonly jitterFactor: number;

  /**
   * 判断是否应该重试
   * @default 基于状态码和错误类型
   */
  readonly shouldRetry: (error: HttpError, attempt: number) => boolean;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  shouldRetry: (error: HttpError, attempt: number) => {
    // 不重试客户端错误（除了特定的可重试状态码）
    if (error.status && error.status >= 400 && error.status < 500) {
      // 408 Request Timeout, 429 Too Many Requests 可以重试
      return error.status === 408 || error.status === 429;
    }
    // 重试服务器错误和网络错误
    return true;
  },
};

/**
 * HTTP 客户端配置
 */
export interface HttpClientConfig {
  /**
   * 基础 URL
   */
  readonly baseURL?: string;

  /**
   * 默认请求头
   */
  readonly headers?: Record<string, string>;

  /**
   * 默认超时时间（毫秒）
   * @default 30000
   */
  readonly timeout?: number;

  /**
   * Bearer Token
   */
  readonly token?: string;

  /**
   * 重试配置
   */
  readonly retry?: Partial<RetryConfig>;

  /**
   * 启用请求日志
   * @default false
   */
  readonly enableLogging?: boolean;
}

/**
 * 日志记录器接口
 */
export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * 默认日志记录器（输出到控制台）
 */
const DEFAULT_LOGGER: Logger = {
  debug: (message, meta) => console.debug(message, meta),
  info: (message, meta) => console.info(message, meta),
  warn: (message, meta) => console.warn(message, meta),
  error: (message, meta) => console.error(message, meta),
};

/**
 * HTTP 客户端
 */
export class HttpClient {
  private readonly config: Required<Omit<HttpClientConfig, 'baseURL' | 'token' | 'retry'>> & {
    baseURL?: string;
    token?: string;
    retry: RetryConfig;
  };
  private readonly requestInterceptors: RequestInterceptor[] = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];
  private readonly errorInterceptors: ErrorInterceptor[] = [];
  private readonly logger: Logger;

  constructor(config: HttpClientConfig = {}, logger: Logger = DEFAULT_LOGGER) {
    this.config = {
      baseURL: config.baseURL,
      headers: config.headers ?? {},
      timeout: config.timeout ?? 30000,
      token: config.token,
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      enableLogging: config.enableLogging ?? false,
    };
    this.logger = logger;
  }

  /**
   * 添加请求拦截器
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * 添加响应拦截器
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * 添加错误拦截器
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  /**
   * 执行 GET 请求
   */
  async get<T = unknown>(
    url: string,
    config?: Omit<HttpRequestConfig, 'url' | 'method'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: 'GET' });
  }

  /**
   * 执行 POST 请求
   */
  async post<T = unknown>(
    url: string,
    body?: BodyInit | Record<string, unknown>,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: 'POST', body });
  }

  /**
   * 执行 PUT 请求
   */
  async put<T = unknown>(
    url: string,
    body?: BodyInit | Record<string, unknown>,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: 'PUT', body });
  }

  /**
   * 执行 PATCH 请求
   */
  async patch<T = unknown>(
    url: string,
    body?: BodyInit | Record<string, unknown>,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: 'PATCH', body });
  }

  /**
   * 执行 DELETE 请求
   */
  async delete<T = unknown>(
    url: string,
    config?: Omit<HttpRequestConfig, 'url' | 'method'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: 'DELETE' });
  }

  /**
   * 执行 HTTP 请求
   */
  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    // 合并配置
    let requestConfig = this.mergeConfig(config);

    // 应用请求拦截器
    for (const interceptor of this.requestInterceptors) {
      requestConfig = await interceptor(requestConfig);
    }

    // 执行请求（带重试）
    return this.executeWithRetry<T>(requestConfig);
  }

  /**
   * 带重试的请求执行
   */
  private async executeWithRetry<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    let lastError: HttpError | undefined;

    for (let attempt = 1; attempt <= this.config.retry.maxAttempts; attempt++) {
      try {
        const response = await this.executeRequest<T>(config, attempt);
        return response;
      } catch (error) {
        const httpError = error instanceof HttpError ? error : this.wrapError(error, config);
        lastError = httpError;

        // 检查是否应该重试
        const shouldRetry = this.config.retry.shouldRetry(httpError, attempt);

        if (this.config.enableLogging) {
          this.logger.warn(`请求失败 (尝试 ${attempt}/${this.config.retry.maxAttempts})`, {
            url: config.url,
            method: config.method,
            status: httpError.status,
            shouldRetry,
          });
        }

        // 如果不应该重试或已达到最大重试次数，抛出错误
        if (!shouldRetry || attempt >= this.config.retry.maxAttempts) {
          // 应用错误拦截器
          let processedError = httpError;
          for (const interceptor of this.errorInterceptors) {
            processedError = await interceptor(processedError);
          }
          throw processedError;
        }

        // 计算延迟时间并等待
        const delayMs = this.computeRetryDelay(attempt);
        await this.sleep(delayMs, config.signal);
      }
    }

    // 不应该到达这里，但为了类型安全
    throw lastError ?? new HttpError('未知错误', config);
  }

  /**
   * 执行单次请求
   */
  private async executeRequest<T>(
    config: HttpRequestConfig,
    attempt: number,
  ): Promise<HttpResponse<T>> {
    const startTime = Date.now();

    if (this.config.enableLogging) {
      this.logger.debug(`发起请求 (尝试 ${attempt})`, {
        url: config.url,
        method: config.method,
      });
    }

    // 构建 fetch 请求
    const { url, init } = this.buildFetchRequest(config);

    try {
      // 执行请求
      const fetchPromise = fetch(url, init);

      // 处理超时
      const timeoutMs = config.timeout ?? this.config.timeout;
      const response = await this.withTimeout(fetchPromise, timeoutMs, config.signal);

      // 解析响应
      const httpResponse = await this.parseResponse<T>(response, config);

      // 应用响应拦截器
      let processedResponse = httpResponse;
      for (const interceptor of this.responseInterceptors) {
        processedResponse = await interceptor(processedResponse);
      }

      const duration = Date.now() - startTime;
      if (this.config.enableLogging) {
        this.logger.info('请求成功', {
          url: config.url,
          method: config.method,
          status: httpResponse.status,
          duration,
        });
      }

      return processedResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (this.config.enableLogging) {
        this.logger.error('请求失败', {
          url: config.url,
          method: config.method,
          duration,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  /**
   * 构建 fetch 请求
   */
  private buildFetchRequest(config: HttpRequestConfig): {
    url: string;
    init: RequestInit;
  } {
    // 构建 URL
    let url = config.url;
    if (this.config.baseURL && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = this.config.baseURL.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
    }

    // 添加查询参数
    if (config.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    // 构建请求头
    const headers = new Headers();

    // 添加默认请求头
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    // 添加配置中的请求头
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        headers.set(key, value);
      }
    }

    // 添加 Bearer Token
    if (this.config.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }

    // 处理请求体
    let body: BodyInit | undefined;
    if (config.body) {
      if (
        typeof config.body === 'object' &&
        !(config.body instanceof FormData) &&
        !(config.body instanceof Blob)
      ) {
        // JSON 对象
        body = JSON.stringify(config.body);
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
      } else {
        // 其他类型（string、FormData、Blob 等）
        body = config.body as BodyInit;
      }
    }

    return {
      url,
      init: {
        method: config.method ?? 'GET',
        headers,
        body,
        signal: config.signal,
      },
    };
  }

  /**
   * 解析响应
   */
  private async parseResponse<T>(
    response: Response,
    config: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    // 检查响应状态
    if (!response.ok) {
      let errorData: unknown;
      try {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          errorData = await response.json();
        } else {
          errorData = await response.text();
        }
      } catch {
        errorData = undefined;
      }

      throw new HttpError(`HTTP 错误 ${response.status}: ${response.statusText}`, config, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: errorData,
      });
    }

    // 解析响应数据
    let data: T;
    const responseType = config.responseType ?? 'json';

    switch (responseType) {
      case 'json':
        data = (await response.json()) as T;
        break;
      case 'text':
        data = (await response.text()) as T;
        break;
      case 'blob':
        data = (await response.blob()) as T;
        break;
      case 'arraybuffer':
        data = (await response.arrayBuffer()) as T;
        break;
      case 'stream':
        if (!response.body) {
          throw new HttpError('响应体为空', config, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
        data = response.body as T;
        break;
      default:
        throw new HttpError(`不支持的响应类型: ${responseType}`, config);
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data,
      config,
    };
  }

  /**
   * 合并配置
   */
  private mergeConfig(config: HttpRequestConfig): HttpRequestConfig {
    return {
      ...config,
      headers: {
        ...this.config.headers,
        ...config.headers,
      },
      timeout: config.timeout ?? this.config.timeout,
    };
  }

  /**
   * 计算重试延迟时间
   */
  private computeRetryDelay(attempt: number): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = this.config.retry;

    // 指数退避
    const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

    // 限制最大延迟
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // 添加抖动
    const jitterRange = cappedDelay * jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange;

    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * 延迟执行
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new HttpError('请求已取消', {} as HttpRequestConfig));
        return;
      }

      const timer = setTimeout(resolve, ms);

      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new HttpError('请求已取消', {} as HttpRequestConfig));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * 带超时的 Promise
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new HttpError(`请求超时 (${timeoutMs}ms)`, {} as HttpRequestConfig));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new HttpError('请求已取消', {} as HttpRequestConfig));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
    });
  }

  /**
   * 包装错误
   */
  private wrapError(error: unknown, config: HttpRequestConfig): HttpError {
    if (error instanceof HttpError) {
      return error;
    }

    if (error instanceof Error) {
      return new HttpError(error.message, config);
    }

    return new HttpError(String(error), config);
  }
}

/**
 * 创建 HTTP 客户端
 */
export function createHttpClient(config?: HttpClientConfig, logger?: Logger): HttpClient {
  return new HttpClient(config, logger);
}
