/**
 * 方案 4 延伸：自动 OpenAPI 文档生成
 *
 * 注册 @fastify/swagger + @fastify/swagger-ui，
 * 在 /docs 路径提供交互式 API 文档。
 *
 * 路由 schema 定义（src/routes/schemas/）会被自动收集并展示。
 * 未定义 schema 的路由仍然正常工作，只是不会出现在文档中。
 */
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'OpenAWork Agent Gateway',
        description: 'API for the OpenAWork agent gateway service',
        version: '0.5.8',
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  // 桌面端 sidecar（Bun --compile 产物）中 @fastify/swagger-ui 的静态资源
  // 路径会被硬编码为 CI 构建机器的绝对路径，运行时必然 ENOENT。
  // 桌面端用户不需要交互式 API 文档，跳过 swagger-ui 注册。
  // 使用运行时拼接的模块名绕过 Bun --compile 的静态分析，避免将 swagger-ui
  // 及其静态资源嵌入编译产物。
  if (!process.env.DESKTOP_AUTOMATION) {
    const swaggerUiPkg = ['@fastify', 'swagger-ui'].join('/');
    try {
      const { default: swaggerUi } = await import(/* webpackIgnore: true */ swaggerUiPkg);
      await app.register(swaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
          docExpansion: 'list',
          deepLinking: true,
          defaultModelsExpandDepth: 3,
        },
      });
    } catch (error) {
      app.log.warn(
        { err: error },
        'openapi: @fastify/swagger-ui unavailable; interactive docs disabled',
      );
    }
  }
}
