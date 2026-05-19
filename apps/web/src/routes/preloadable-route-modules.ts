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
  about: createPreloadableRouteModule(
    'about',
    () => import('../pages/misc/AboutPage.js'),
    '关于 OpenAWork',
  ),
  agents: createPreloadableRouteModule(
    'agents',
    () => import('../pages/misc/AgentsPage.js'),
    'Agent 管理',
  ),
  artifacts: createPreloadableRouteModule(
    'artifacts',
    () => import('../pages/artifacts/ArtifactsPage.js'),
    '产物中心',
  ),
  channels: createPreloadableRouteModule(
    'channels',
    () => import('../pages/misc/ChannelsPage.js'),
    '消息频道',
  ),
  chat: createPreloadableRouteModule(
    'chat',
    () => import('../pages/chat-page/ChatPage.js'),
    '会话工作台',
  ),
  images: createPreloadableRouteModule(
    'images',
    () => import('../pages/artifacts/ImagesPage.js'),
    '图片工作台',
  ),
  schedules: createPreloadableRouteModule(
    'schedules',
    () => import('../pages/misc/SchedulesPage.js'),
    '计划任务',
  ),
  sessions: createPreloadableRouteModule(
    'sessions',
    () => import('../pages/sessions-page/SessionsPage.js'),
    '会话列表',
  ),
  settings: createPreloadableRouteModule(
    'settings',
    () => import('../pages/settings/SettingsPage.js'),
    '设置中心',
  ),
  team: createPreloadableRouteModule(
    'team',
    () => import('../pages/team/views/TeamPageDispatcher.js'),
    '团队协作',
  ),
  templates: createPreloadableRouteModule(
    'templates',
    () => import('../pages/team/views/TeamTemplatesPage.js'),
    '模板管理',
  ),
  workflows: createPreloadableRouteModule(
    'workflows',
    () => import('../pages/workflows/WorkflowsPage.js'),
    '工作流工作台',
  ),
  skills: createPreloadableRouteModule(
    'skills',
    () => import('../pages/skills/SkillsPage.js'),
    '技能库',
  ),
  skillSelection: createPreloadableRouteModule(
    'skill-selection',
    () => import('../pages/skills/selection/SkillSelectionPage.js'),
    'Skill 工作区选择集',
  ),
  usage: createPreloadableRouteModule(
    'usage',
    () => import('../pages/misc/UsagePage.js'),
    '用量统计',
  ),
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
