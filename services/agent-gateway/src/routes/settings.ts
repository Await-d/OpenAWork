import type { FastifyInstance } from 'fastify';
import { registerSettingsUserRoutes } from './settings-user-routes.js';
import { registerSettingsMcpRoutes } from './settings-mcp-routes.js';
import { registerSettingsAdminRoutes } from './settings-admin-routes.js';
import { registerSettingsProviderRoutes } from './settings-provider-routes.js';
import { registerSettingsModelRoutes } from './settings-model-routes.js';

/**
 * settings 路由入口（已按域拆分：user / mcp / admin / provider / model）。
 * 各分区实现见 settings-*-routes.ts，共享支撑见 settings-support.ts。
 */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  await registerSettingsUserRoutes(app);
  await registerSettingsMcpRoutes(app);
  await registerSettingsAdminRoutes(app);
  await registerSettingsProviderRoutes(app);
  await registerSettingsModelRoutes(app);
}

// 测试消费面：审计摘要提取逻辑由 settings-support 提供
export { __extractAuditSummaryForTesting } from './settings-support.js';
