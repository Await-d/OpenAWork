import { describe, expect, it } from 'vitest';
import {
  buildDispatchPackages,
  parseAllTasks,
  validateParsedTasks,
} from '../../handoff/capability/dispatch-package.js';

function dispatch(content: string) {
  return buildDispatchPackages({
    tasks: parseAllTasks(content),
    context: '实现任务',
    artifactRefs: { tasksId: 'tasks-dependencies' },
  });
}

describe('任务依赖与责任范围', () => {
  it('编号及依赖统一大小写，也不能靠大小写绕过重复编号校验', () => {
    const packages = dispatch(`
- [ ] t001 [src/a.ts] 新增入口 - 可启动
- [ ] T002 [DEPS:t001] [src/b.ts] 新增调用 - 可运行
`);
    expect(packages.map((pkg) => pkg.taskMarkers.taskId)).toEqual(['T001', 'T002']);
    expect(packages[1]?.dependsOn).toEqual(['T001']);
    expect(validateParsedTasks(parseAllTasks(`
- [ ] t001 [src/a.ts] 新增入口 - 可启动
- [ ] T001 [src/b.ts] 新增调用 - 可运行
`)).join('；')).toContain('重复');
  });

  it.each(['src/./login.ts', 'src/module/../login.ts'])('同文件路径别名 %s 也必须串行', (alias) => {
    const packages = dispatch(`
- [ ] T001 [P] [src/login.ts] 新增校验 - 拒绝无效凭据
- [ ] T002 [P] [${alias}] 新增错误展示 - 可解释失败
`);
    expect(packages[1]?.dependsOn).toEqual(['T001']);
    expect(packages[1]?.ownedPaths).toEqual(['src/login.ts']);
  });

  it('同文件的不同需求全部保留且串行执行，不缩小责任范围', () => {
    const packages = dispatch(`
- [ ] T001 [P] [src/login.ts] 新增登录校验 - 拒绝无效凭据
- [ ] T002 [P] [src/login.ts] 新增错误展示 - 展示校验结果
`);
    expect(packages.map((pkg) => pkg.taskMarkers.taskId)).toEqual(['T001', 'T002']);
    expect(packages[1]?.dependsOn).toEqual(['T001']);
    expect(packages[1]?.ownedPaths).toEqual(['src/login.ts']);
  });

  it('模块目录与其子文件的写入任务不能并发', () => {
    const packages = dispatch(`
- [ ] T001 [P] [src/login] 新增登录模块 - 可处理登录
- [ ] T002 [P] [src/login/errors.ts] 新增错误提示 - 可解释失败
- [ ] T003 [P] [src/login-extra.ts] 新增附加能力 - 独立运行
`);
    expect(packages[1]?.dependsOn).toEqual(['T001']);
    expect(packages[2]?.dependsOn).toEqual([]);
  });

  it('显式依赖等待并行任务，标记不泄漏到标题或责任路径', () => {
    const tasks = parseAllTasks(`
- [ ] T001 [src/api.ts] 新增接口 - 接口可用
- [ ] T002 [P] [src/page.ts] 新增页面 - 页面可用
- [ ] T003 [DEPS:T001,T002,T002] [src/integration.ts] 完成联调 - 联调通过
`);
    const packages = buildDispatchPackages({
      tasks,
      context: '',
      artifactRefs: { tasksId: 'tasks-explicit' },
    });
    expect(tasks[2]?.title).toBe('[src/integration.ts] 完成联调 - 联调通过');
    expect(packages[2]?.dependsOn).toEqual(['T001', 'T002']);
    expect(packages[2]?.ownedPaths).toEqual(['src/integration.ts']);
  });

  it.each([
    ['未知任务', '[DEPS:T999]'],
    ['自身依赖', '[DEPS:T002]'],
    ['前向依赖', '[DEPS:T003]'],
    ['非法依赖', '[DEPS:garbage]'],
    ['空依赖', '[DEPS:]'],
  ])('拒绝%s，不让 PM2 丢弃无法映射的依赖', (_reason, marker) => {
    const tasks = parseAllTasks(`
- [ ] T001 [src/one.ts] 新增入口 - 可启动
- [ ] T002 ${marker} [src/two.ts] 新增实现 - 可运行
- [ ] T003 [src/three.ts] 新增集成 - 可联调
`);
    expect(validateParsedTasks(tasks).join('；')).toContain('依赖');
    expect(
      buildDispatchPackages({ tasks, context: '', artifactRefs: { tasksId: 'invalid-deps' } }),
    ).toEqual([]);
  });

  it('重复任务编号拒绝派发，避免 taskId 映射覆盖', () => {
    const tasks = parseAllTasks(`
- [ ] T001 [src/one.ts] 新增入口 - 可启动
- [ ] T001 [src/two.ts] 新增实现 - 可运行
`);
    expect(validateParsedTasks(tasks).join('；')).toContain('重复');
  });

  it('旧格式保留原有串行推断，不把独立并行任务强制串行化', () => {
    const packages = dispatch(`
- [ ] T001 [src/one.ts] 新增入口 - 可启动
- [ ] T002 [P] [src/two.ts] 新增页面 - 可展示
- [ ] T003 [src/three.ts] 新增服务 - 可调用
`);
    expect(packages.map((pkg) => pkg.dependsOn)).toEqual([[], [], ['T001']]);
  });
});
