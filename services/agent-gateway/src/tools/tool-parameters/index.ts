/**
 * 工具参数 schema 分发入口。
 *
 * `buildParameters` 原本在 `tool-definitions.ts` 内是一个约 1800 行的巨型 switch,
 * 现按工具族拆分到本目录下多个模块。这里按顺序串联各族的构建器,首个命中者胜出;
 * 全部未命中时返回 `undefined`,由调用方回退到「宽松空 schema」。
 *
 * 注意:各族之间的 case 标签必须互不重叠,否则后面的族会被前面的遮蔽而静默失效。
 * 该不变量由 `__tests__/tools/tool-parameters-registry.test.ts` 守护。
 */
import type { ToolParameters } from './tool-parameter-schema.js';
import { buildInteractionAndWebParameters } from './interaction-and-web.js';
import { buildCodeIntelParameters } from './code-intel.js';
import { buildFilesystemParameters } from './filesystem.js';
import { buildExecutionParameters } from './execution.js';
import { buildAgentParameters } from './agents.js';
import { buildMediaDesktopParameters } from './media-desktop.js';
import { buildAdminParameters } from './admin.js';

/** 各工具族的参数构建器,按顺序短路匹配。导出以便测试校验「标签互不重叠」。 */
export const TOOL_PARAMETER_BUILDERS = [
  { family: 'interaction-and-web', build: buildInteractionAndWebParameters },
  { family: 'code-intel', build: buildCodeIntelParameters },
  { family: 'filesystem', build: buildFilesystemParameters },
  { family: 'execution', build: buildExecutionParameters },
  { family: 'agents', build: buildAgentParameters },
  { family: 'media-desktop', build: buildMediaDesktopParameters },
  { family: 'admin', build: buildAdminParameters },
] as const;

export function buildToolParameters(name: string): ToolParameters | undefined {
  for (const { build } of TOOL_PARAMETER_BUILDERS) {
    const parameters = build(name);
    if (parameters) {
      return parameters;
    }
  }
  return undefined;
}
