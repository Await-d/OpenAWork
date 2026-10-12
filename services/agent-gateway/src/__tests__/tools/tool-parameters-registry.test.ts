import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildChannelToolParameters } from '../../tools/channel-tool-parameters.js';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import { TOOL_PARAMETER_BUILDERS, buildToolParameters } from '../../tools/tool-parameters/index.js';

const TOOL_PARAMETERS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../tools/tool-parameters',
);

const SCHEMA_FILES = ['index.ts', 'tool-parameter-schema.ts'];

function collectCaseLabels(): Array<{ family: string; label: string }> {
  const entries: Array<{ family: string; label: string }> = [];
  for (const file of readdirSync(TOOL_PARAMETERS_DIR).sort()) {
    if (!file.endsWith('.ts') || SCHEMA_FILES.includes(file)) {
      continue;
    }
    const source = readFileSync(join(TOOL_PARAMETERS_DIR, file), 'utf8');
    for (const match of source.matchAll(/^\s*case '([^']+)':/gm)) {
      entries.push({ family: file, label: match[1]! });
    }
  }
  return entries;
}

describe('tool-parameters 注册表', () => {
  const entries = collectCaseLabels();

  it('注册表与目录中的工具族文件一一对应', () => {
    const familyFiles = readdirSync(TOOL_PARAMETERS_DIR)
      .filter((file) => file.endsWith('.ts') && !SCHEMA_FILES.includes(file))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();
    expect(TOOL_PARAMETER_BUILDERS.map((entry) => entry.family).sort()).toEqual(familyFiles);
  });

  it('从工具族中抽取到的 case 标签数量稳定(防止拆分时漏搬分支)', () => {
    // 拆分前 switch 有 87 个 case;这里锁住下界,漏搬会立刻报警。
    expect(entries.length).toBeGreaterThanOrEqual(80);
  });

  it('各族之间的 case 标签互不重复(重复会被前面的族静默遮蔽)', () => {
    const seen = new Map<string, string>();
    for (const { family, label } of entries) {
      const previous = seen.get(label);
      expect(previous, `标签 ${label} 同时出现在 ${previous} 与 ${family}`).toBeUndefined();
      seen.set(label, family);
    }
  });

  it('每个 case 标签都能被 buildToolParameters 解析', () => {
    for (const { label } of entries) {
      expect(buildToolParameters(label), `${label} 未被任何工具族解析`).toBeDefined();
    }
  });

  it('除已知例外外,渠道以外的模型可见工具都解析到显式参数 schema', () => {
    const unresolved = buildGatewayToolDefinitions()
      .map((definition) => definition.function.name)
      .filter((name) => !buildChannelToolParameters(name) && !buildToolParameters(name));
    // `subagent`(子代理工具规范名)与历史别名 `task` 共用同一份显式 schema,
    // 现在**都有**显式参数定义 —— 模型可见名 `subagent` 不再走宽松空 schema 兜底。
    // 此处若出现任何名字,说明某个工具族漏搬了 case 分支。
    expect(unresolved).toEqual([]);
  });
});
