/**
 * `look_at` 的 PDF 分支曾把抽取文本静默截断到 2 万字符，模型无从得知还有内容。
 * 现改为复用文本文件同一套语义（行号 + 2000 行 / 50KB 上限 + 可执行的续读提示），
 * 这里锁定输出形态与 offset 续读行为。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  listManagedAgentsForUser: vi.fn(() => [] as unknown[]),
  selectDelegatedModelForUser: vi.fn(() => null),
  getReferenceAgentModelEntries: vi.fn(() => [] as unknown[]),
  getProviderConfigForSelection: vi.fn(async () => null),
  resolveModelRoute: vi.fn(),
  resolveModelRouteFromProvider: vi.fn(),
  appendSessionMessageV2: vi.fn(),
  validateWorkspacePath: vi.fn((p: string) => p),
  stat: vi.fn(),
  readFile: vi.fn(),
  pdfGetText: vi.fn(),
  pdfDestroy: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKSPACE_ROOTS: ['/tmp/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../../agent/agent-catalog.js', () => ({
  listManagedAgentsForUser: mocks.listManagedAgentsForUser,
}));

vi.mock('../../task/task-model-selection.js', () => ({
  selectDelegatedModelForUser: mocks.selectDelegatedModelForUser,
}));

vi.mock('../../task/task-model-reference-snapshot.js', () => ({
  getReferenceAgentModelEntries: mocks.getReferenceAgentModelEntries,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getProviderConfigForSelection: mocks.getProviderConfigForSelection,
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveModelRoute: mocks.resolveModelRoute,
  resolveModelRouteFromProvider: mocks.resolveModelRouteFromProvider,
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessageV2,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  validateWorkspacePath: mocks.validateWorkspacePath,
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return { ...actual, runUpstreamGenerate: mocks.runUpstreamGenerate };
});

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    public readonly getText = mocks.pdfGetText;
    public readonly destroy = mocks.pdfDestroy;
  },
}));

import { runLookAtTool } from '../../tools/look-at-tools.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

const PDF_PATH = '/tmp/workspace/doc.pdf';

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 2048,
    temperature: overrides?.temperature ?? 0.2,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

const sentTextContent = (): string =>
  JSON.stringify(mocks.runUpstreamGenerate.mock.calls[0]?.[0] ?? {});

const runPdf = (offset?: number) =>
  runLookAtTool({
    filePath: PDF_PATH,
    goal: '总结要点',
    ...(offset !== undefined ? { offset } : {}),
    parentSessionId: 'parent-session',
    userId: 'user-1',
  });

describe('runLookAtTool — PDF 文本分页', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === 'function' && 'mockReset' in m) {
        (m as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    mocks.listManagedAgentsForUser.mockReturnValue([]);
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.validateWorkspacePath.mockImplementation((p: string) => p);
    mocks.resolveModelRoute.mockReturnValue(createRoute());
    mocks.stat.mockResolvedValue({ size: 2048 });
    mocks.readFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mocks.pdfDestroy.mockResolvedValue(undefined);
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({ text: 'ok', inputTokens: 1, outputTokens: 1, finishReason: 'stop' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('输出 opencode 风格包裹 + 行号 + 结束标记', async () => {
    mocks.pdfGetText.mockResolvedValue({ text: 'alpha\nbeta\ngamma\n' });

    await runPdf();

    const sent = sentTextContent();
    expect(sent).toContain('<path>/tmp/workspace/doc.pdf</path>');
    expect(sent).toContain('<content>');
    expect(sent).toContain('1: alpha');
    expect(sent).toContain('3: gamma');
    expect(sent).toContain('(End of file - total 3 lines)');
    expect(sent).toContain('</content>');
  });

  it('超过 2000 行时给出可执行的续读提示，offset 可续读', async () => {
    const lines = Array.from({ length: 2001 }, (_, index) => `line-${index + 1}`).join('\n');
    mocks.pdfGetText.mockResolvedValue({ text: lines });

    await runPdf();

    expect(sentTextContent()).toContain(
      '(Showing lines 1-2000 of 2001. Use offset=2001 to continue.)',
    );

    mocks.runUpstreamGenerate.mockClear();
    await runPdf(2001);

    const second = sentTextContent();
    expect(second).toContain('2001: line-2001');
    expect(second).toContain('(End of file - total 2001 lines)');
  });

  it('扫描件（无可提取文本）给出明确提示而不是空内容', async () => {
    mocks.pdfGetText.mockResolvedValue({ text: '   \n  ' });

    await runPdf();

    expect(sentTextContent()).toContain('未提取到可读文本');
  });

  it('解析器始终被释放', async () => {
    mocks.pdfGetText.mockResolvedValue({ text: 'alpha' });

    await runPdf();

    expect(mocks.pdfDestroy).toHaveBeenCalledTimes(1);
  });
});
