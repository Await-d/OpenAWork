import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

type RoutePageModule = {
  default: ComponentType;
};

type RouteModuleImporter = () => Promise<RoutePageModule>;

interface PreloadableRouteModule {
  component: LazyExoticComponent<ComponentType>;
  preload: () => Promise<RoutePageModule>;
  title: string;
}

const routeImportPromises = new Map<string, Promise<RoutePageModule>>();

function createPreloadableRouteModule(
  cacheKey: string,
  importer: RouteModuleImporter,
  title: string,
): PreloadableRouteModule {
  const preload = (): Promise<RoutePageModule> => {
    const cachedPromise = routeImportPromises.get(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }

    const nextPromise = importer();
    routeImportPromises.set(cacheKey, nextPromise);
    return nextPromise;
  };

  return {
    component: lazy(preload),
    preload,
    title,
  };
}

export const PRELOADABLE_ROUTE_MODULES = {
  agents: createPreloadableRouteModule(
    'agents',
    () => import('../pages/AgentsPage.js'),
    'Agent 管理',
  ),
  artifacts: createPreloadableRouteModule(
    'artifacts',
    () => import('../pages/ArtifactsPage.js'),
    '产物中心',
  ),
  channels: createPreloadableRouteModule(
    'channels',
    () => import('../pages/ChannelsPage.js'),
    '消息频道',
  ),
  chat: createPreloadableRouteModule('chat', () => import('../pages/ChatPage.js'), '会话工作台'),
  schedules: createPreloadableRouteModule(
    'schedules',
    () => import('../pages/SchedulesPage.js'),
    '计划任务',
  ),
  sessions: createPreloadableRouteModule(
    'sessions',
    () => import('../pages/SessionsPage.js'),
    '会话列表',
  ),
  settings: createPreloadableRouteModule(
    'settings',
    () => import('../pages/SettingsPage.js'),
    '设置中心',
  ),
  team: createPreloadableRouteModule('team', () => import('../pages/TeamPage.js'), '团队协作'),
  templates: createPreloadableRouteModule(
    'templates',
    () => import('../pages/TeamTemplatesPage.js'),
    '模板管理',
  ),
  workflows: createPreloadableRouteModule(
    'workflows',
    () => import('../pages/WorkflowsPage.js'),
    '工作流工作台',
  ),
  skills: createPreloadableRouteModule('skills', () => import('../pages/SkillsPage.js'), '技能库'),
  usage: createPreloadableRouteModule('usage', () => import('../pages/UsagePage.js'), '用量统计'),
} as const;

export type PreloadableRouteKey = keyof typeof PRELOADABLE_ROUTE_MODULES;

function getPreloadableRouteKey(pathname: string): PreloadableRouteKey | null {
  const [firstSegment] = pathname.split('/').filter(Boolean);

  if (!firstSegment) {
    return null;
  }

  return firstSegment in PRELOADABLE_ROUTE_MODULES ? (firstSegment as PreloadableRouteKey) : null;
}

export function preloadRouteModuleByPath(pathname: string): Promise<RoutePageModule> | null {
  const routeKey = getPreloadableRouteKey(pathname);
  return routeKey ? PRELOADABLE_ROUTE_MODULES[routeKey].preload() : null;
}
