// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildToolFailureView, TOOL_FAILURE_CATEGORY_LABEL } from './tool-failure-view.js';

/**
 * 四条样本全部**逐字**取自真实 `audit_logs`（见设计文档「真实失败形态」一节）。
 * 样本必须原样保留——它们的价值就在于连中文括号 / 反引号 / 分号都跟线上一致，
 * 一旦「顺手美化」，正则就只对测试里的假数据成立。
 */
const AGENTIGNORE_DENIAL =
  'Access denied: file "/home/await/project/OpenAWork/.omo/ime-guard-apply.ts" is protected by agentignore rules. 该类路径受 agentignore 保护(常见受保护模式:`.env` / `.env.*`、`*.pem` / `*.key` / `id_rsa*`、`.aws/credentials`、`*.sqlite` / `*.db`、`node_modules/**`、`.git/**` 等)。请勿重复尝试读取或写入;如需其中的值,请让用户显式提供,或改读不含敏感值的等价文件(如 `.env.example`)。';

const READ_BEFORE_EDIT =
  'You must read file "/home/await/project/OpenAWork/apps/web/src/pages/chat-page/panels/sub-session-detail-panel.tsx" before editing it';

const WORKSPACE_ESCAPE =
  '目标路径超出当前工作区范围：/tmp/mwg-guide-1005252-1794926975048.md（当前工作区：/home/await/project/OpenAWork）';

const ENOENT =
  "ENOENT: no such file or directory, stat '/home/await/project/OpenAWork/apps/web/src/components/permissions/PermissionPrompt.tsx'";

/** 取某个 label 的字段值；没有该字段时返回 undefined（断言里更好读）。 */
function fieldValue(
  view: ReturnType<typeof buildToolFailureView>,
  label: string,
): string | undefined {
  if (!view || view.kind !== 'structured') return undefined;
  return view.fields.find((field) => field.label === label)?.value;
}

describe('buildToolFailureView · isError 门禁', () => {
  it('isError 为假 / 未定义时返回 null（不渲染失败卡）', () => {
    expect(buildToolFailureView(AGENTIGNORE_DENIAL, false)).toBeNull();
    expect(buildToolFailureView(AGENTIGNORE_DENIAL, undefined)).toBeNull();
    expect(buildToolFailureView('boom', false)).toBeNull();
  });
});

describe('buildToolFailureView · 形态 1：agentignore 拦截', () => {
  const view = buildToolFailureView(AGENTIGNORE_DENIAL, true);

  it('归为 permission 分类，标题是一句结论', () => {
    expect(view?.kind).toBe('structured');
    expect(view?.kind === 'structured' && view.category).toBe('permission');
    expect(view?.headline).toBe('agentignore 保护路径');
    expect(TOOL_FAILURE_CATEGORY_LABEL.permission).toBe('写入被拒绝');
  });

  it('拆出「路径 / 原因」两个字段，而不是把整段塞进一个字段', () => {
    expect(fieldValue(view, '路径')).toBe('/home/await/project/OpenAWork/.omo/ime-guard-apply.ts');
    const reason = fieldValue(view, '原因');
    expect(reason?.startsWith('该类路径受 agentignore 保护')).toBe(true);
    // 原因只收第一句：保护模式清单属于「为什么」，后面的动作指引归「建议」。
    expect(reason).not.toContain('请勿重复尝试');
  });

  it('后半段中文进入建议行', () => {
    expect(view?.kind === 'structured' && view.suggestion).toContain('请勿重复尝试读取或写入');
    expect(view?.kind === 'structured' && view.suggestion).toContain('.env.example');
  });

  it('raw 与原文逐字相同（不做任何重排 / 截断）', () => {
    expect(view?.raw).toBe(AGENTIGNORE_DENIAL);
  });
});

describe('buildToolFailureView · 形态 2：编辑前必须先读取', () => {
  const view = buildToolFailureView(READ_BEFORE_EDIT, true);

  it('归为 precondition 分类并抽出路径', () => {
    expect(view?.kind === 'structured' && view.category).toBe('precondition');
    expect(view?.headline).toBe('编辑前需先读取文件');
    expect(fieldValue(view, '路径')).toBe(
      '/home/await/project/OpenAWork/apps/web/src/pages/chat-page/panels/sub-session-detail-panel.tsx',
    );
    expect(view?.kind === 'structured' && view.suggestion).toBeTruthy();
  });

  it('raw 与原文逐字相同', () => {
    expect(view?.raw).toBe(READ_BEFORE_EDIT);
  });
});

describe('buildToolFailureView · 形态 3：工作区越界', () => {
  const view = buildToolFailureView(WORKSPACE_ESCAPE, true);

  it('归为 workspace 分类并抽出「路径 / 工作区」', () => {
    expect(view?.kind === 'structured' && view.category).toBe('workspace');
    expect(view?.headline).toBe('目标路径超出工作区范围');
    expect(fieldValue(view, '路径')).toBe('/tmp/mwg-guide-1005252-1794926975048.md');
    expect(fieldValue(view, '工作区')).toBe('/home/await/project/OpenAWork');
  });

  it('raw 与原文逐字相同', () => {
    expect(view?.raw).toBe(WORKSPACE_ESCAPE);
  });

  it.each([WORKSPACE_ESCAPE, 'Forbidden workspace path: ../report.md'])(
    '写入被拒时保留路径信息并给出用户导出建议：%s',
    (message) => {
      const advice =
        '\n建议：交付新文件时，先写入当前工作区并告诉用户文件位置，由用户在文件编辑器中另存为或下载。';
      expect(buildToolFailureView(message + advice, true)).toMatchObject({
        kind: 'structured',
        category: 'workspace',
        suggestion: expect.stringContaining('另存为或下载'),
        raw: message + advice,
      });
      expect(buildToolFailureView(message, true)).toMatchObject({
        suggestion: '改用当前工作区内的路径，或切换到有权访问的工作区。',
      });
    },
  );
});

describe('buildToolFailureView · 形态 4：errno 系统错误', () => {
  const view = buildToolFailureView(ENOENT, true);

  it('归为 system 分类并拆出错误码 / 详情 / 操作 / 路径', () => {
    expect(view?.kind === 'structured' && view.category).toBe('system');
    expect(view?.headline).toBe('文件或目录不存在');
    expect(fieldValue(view, '错误码')).toBe('ENOENT');
    expect(fieldValue(view, '详情')).toBe('no such file or directory');
    expect(fieldValue(view, '操作')).toBe('stat');
    expect(fieldValue(view, '路径')).toBe(
      '/home/await/project/OpenAWork/apps/web/src/components/permissions/PermissionPrompt.tsx',
    );
  });

  it('raw 与原文逐字相同', () => {
    expect(view?.raw).toBe(ENOENT);
  });

  it('未收录的 errno 码仍按 system 处理，标题带上错误码', () => {
    const unknown = buildToolFailureView('EZZZZ: something lowercase happened', true);
    expect(unknown?.kind === 'structured' && unknown.category).toBe('system');
    expect(unknown?.headline).toBe('系统调用失败（EZZZZ）');
  });

  it('不把普通英文前缀误判成 errno（`Error:` / `ERROR:`）', () => {
    const notErrno = buildToolFailureView('Error: 桌面桥连接超时', true);
    expect(notErrno?.kind).toBe('plain');
    expect(buildToolFailureView('ERROR: Something went wrong', true)?.kind).toBe('plain');
  });
});

describe('buildToolFailureView · 回退与不变量', () => {
  it('认不出的文本退回 plain，标题取首个非空行', () => {
    const view = buildToolFailureView('\n\n  写文件时发生了未知问题\nstack line', true);
    expect(view).toEqual({
      kind: 'plain',
      headline: '写文件时发生了未知问题',
      raw: '\n\n  写文件时发生了未知问题\nstack line',
    });
  });

  it('已知规则拦截（guard）按一行结论呈现，并带上分类', () => {
    const view = buildToolFailureView('Command substitution is not allowed here', true);
    expect(view?.kind).toBe('plain');
    expect(view?.kind === 'plain' && view.category).toBe('guard');
    expect(view?.headline).toBe('Command substitution is not allowed here');
  });

  it('plain 视图的 raw 保留原始空白与换行（信息不丢）', () => {
    const text = '  boom  \n\n  second line  \n';
    expect(buildToolFailureView(text, true)?.raw).toBe(text);
  });

  it('标题超长时按 120 字符截断，raw 仍是全文', () => {
    const long = `${'x'.repeat(300)}`;
    const view = buildToolFailureView(long, true);
    expect(view?.headline.length).toBe(120);
    expect(view?.headline.endsWith('…')).toBe(true);
    expect(view?.raw).toBe(long);
  });

  it('对象信封取 error 字段做解析，raw 是完整 JSON', () => {
    const view = buildToolFailureView({ ok: false, error: WORKSPACE_ESCAPE }, true);
    expect(view?.kind === 'structured' && view.category).toBe('workspace');
    expect(view?.raw).toContain('"ok": false');
    expect(view?.raw).toContain('/tmp/mwg-guide-1005252-1794926975048.md');
  });

  it('对象信封没有任何可读错误字段时给「执行失败」，不渲染空卡片', () => {
    const view = buildToolFailureView({ random: 'noise' }, true);
    expect(view?.kind).toBe('plain');
    expect(view?.headline).toBe('执行失败');
    expect(view?.raw).toContain('"random": "noise"');
  });

  it('空输出 / null 不抛错', () => {
    expect(buildToolFailureView('', true)?.headline).toBe('执行失败');
    expect(buildToolFailureView(null, true)?.headline).toBe('执行失败');
    expect(buildToolFailureView(undefined, true)?.headline).toBe('执行失败');
  });

  it('属性读取会抛错的对象也不会打崩解析器', () => {
    const hostile = {
      get error(): string {
        throw new Error('boom');
      },
    };
    expect(() => buildToolFailureView(hostile, true)).not.toThrow();
    expect(buildToolFailureView(hostile, true)?.kind).toBe('plain');
  });
});
