import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createBuiltinResourceSkillDefs,
  createResourceSkillManifest,
  listResourceCatalog,
  resourcePath,
} from './node.js';

const name = 'modern-web-guidance';
const revision = '64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65';

describe('modern-web-guidance bundled skill', () => {
  it('loads the packaged document into the on-demand manifest and builtin catalog', () => {
    const manifest = createResourceSkillManifest(name);
    const path = resourcePath('skills', 'reference', name, 'SKILL.md');
    const source = readFileSync(path, 'utf8');
    const descriptionLine = source.split('\n').find((line) => line.startsWith('description: '));

    expect(descriptionLine?.slice('description: '.length)).toBe(manifest.description);
    expect(manifest).toMatchObject({
      id: `com.openAwork.resource.${name}`,
      name,
      license: 'Apache-2.0',
      lifecycle: { activation: 'on-demand' },
      references: [{ path, loadAt: 'activation' }],
      capabilities: ['frontend.web-platform', 'frontend.compatibility', 'frontend.accessibility'],
      permissions: [
        { type: 'filesystem', scope: '**', required: false },
        { type: 'network', scope: '*', required: false },
      ],
    });
    expect(manifest.descriptionForModel).toContain('GoogleChrome/modern-web-guidance');
    expect(manifest.descriptionForModel).toContain(revision);
    const executor = async () => ({ content: 'instruction loaded', isError: false });
    expect(
      createBuiltinResourceSkillDefs(executor).find((def) => def.manifest.name === name),
    ).toMatchObject({ manifest, executor });
    expect(listResourceCatalog().skills.find((skill) => skill.name === name)).toMatchObject({
      integration: 'builtin',
      path,
      content: manifest.descriptionForModel,
      permissions: manifest.permissions,
    });
  });

  it('pins every CLI example, disables telemetry and requires search before retrieve', () => {
    const body = createResourceSkillManifest(name).descriptionForModel ?? '';
    const commands = body.split('\n').filter((line) => line.startsWith('DISABLE_TELEMETRY='));

    expect(commands).toEqual([
      'DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 search "light dismiss dialog"',
      'DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 retrieve "<id returned by search>"',
      'DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 legacy-scan "<authorized path>" --json',
    ]);
    expect(body).toContain("$env:DISABLE_TELEMETRY='1'");
    expect(body.indexOf(' search ')).toBeLessThan(body.indexOf(' retrieve '));
    expect(body).not.toMatch(
      /@latest|--force|--ignore-scripts|npm install|curl[^\n]*\|\s*(?:sh|bash)/,
    );
    expect(body).not.toMatch(/as any\)\}|npx\s+\*|pnpx\s+\*/);
  });

  it('preserves host dependency, permission, project and modernization boundaries', () => {
    const body = createResourceSkillManifest(name).descriptionForModel ?? '';

    for (const requirement of [
      'Gateway 主机',
      'Node.js >=22',
      'node --version',
      'npm --version',
      'npx --version',
      '不得静默自动安装系统运行时',
      '不绕过权限',
      '禁止 `any`、`as any`、`@ts-ignore` 和 `@ts-expect-error`',
      'packages/shared-ui/DESIGN-TOKENS.md',
      'Tauri WebView',
      'WebView2',
      'WKWebView',
      'WebKitGTK',
      '具体组件的修复、功能新增、定向审查不触发此扫描',
      '仅当用户明确请求',
      '用户只要求报告时不改代码',
    ]) {
      expect(body).toContain(requirement);
    }
    expect(body).not.toMatch(/(?:sudo|apt-get|brew install|winget install)\s/);
  });
});
