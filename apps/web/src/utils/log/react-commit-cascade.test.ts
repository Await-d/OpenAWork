import { Profiler, createElement, useLayoutEffect, useState } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReactUpdateDepthDiagnostics,
  dumpReactCommitCascadeReport,
  installReactCommitCascadeDiagnostics,
  recordReactCommit,
  recordReactUpdateSource,
  resetReactCommitCascadeDiagnostics,
  uninstallReactCommitCascadeDiagnostics,
} from './react-commit-cascade.js';

afterEach(() => {
  cleanup();
  uninstallReactCommitCascadeDiagnostics();
  resetReactCommitCascadeDiagnostics();
  localStorage.removeItem('openawork:react-commit-cascade');
  history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

function commit(id: string, time: number, phase: 'update' | 'nested-update' = 'update'): void {
  recordReactCommit(id, phase, 1, 1, 0, time);
}

describe('React 更新诊断', () => {
  it('按 commitTime 合并嵌套 Profiler，不把一次提交重复计算', () => {
    commit('route:chat', 10);
    commit('app-root', 10);
    commit('app-root', 20);
    const report = dumpReactCommitCascadeReport();
    expect(report).toContain('独立提交总数：2');
    expect(report).toContain('route:chat:update');
    expect(report).toContain('app-root:update');
    expect(report).toContain('Δ=10.00ms');
  });

  it('只保留最近 80 次提交且保留总数', () => {
    for (let index = 1; index <= 100; index += 1) commit('app-root', index);
    const report = dumpReactCommitCascadeReport();
    expect(report).toContain('独立提交总数：100；保留最近 80/80 次');
    expect(report).not.toContain('#20 t=');
    expect(report).toContain('#21 t=');
  });

  it('普通提交不采集栈，nested-update 保留现场栈但不宣称它是 setter 来源', () => {
    commit('app-root', 1);
    expect(dumpReactCommitCascadeReport()).not.toContain('React update diagnostic');
    commit('app-root', 2, 'nested-update');
    expect(dumpReactCommitCascadeReport()).toContain('React update diagnostic');
    expect(dumpReactCommitCascadeReport()).toContain('未必包含触发 setter');
  });

  it.each(['url', 'storage'])('%s 开关可从首次更新入口采集调用栈', (mode) => {
    if (mode === 'url') history.replaceState({}, '', '/?diag=commit-cascade');
    else localStorage.setItem('openawork:react-commit-cascade', '1');
    recordReactUpdateSource('gateway.attachToActiveStream', 'start');
    const report = dumpReactCommitCascadeReport();
    expect(report).toContain('gateway.attachToActiveStream');
    expect(report).toContain('React update diagnostic');
  });

  it('首次 #185 冻结现场，后续提交和派遣不能覆盖', () => {
    commit('route:chat', 1);
    const report = buildReactUpdateDepthDiagnostics('Minified React error #185;');
    commit('app-root', 2);
    recordReactUpdateSource('late', 'ignored');
    expect(dumpReactCommitCascadeReport()).toBe(report);
    expect(report).not.toContain('late');
    expect(report).not.toContain('#2 t=');
  });

  it('兼容开发文案，其他错误不触发报告冻结', () => {
    expect(buildReactUpdateDepthDiagnostics('Failed to fetch')).toBeNull();
    expect(buildReactUpdateDepthDiagnostics('Minified React error #1850')).toBeNull();
    expect(buildReactUpdateDepthDiagnostics('Maximum update depth exceeded.')).toContain(
      'React 更新诊断',
    );
  });

  it('仅保留 React 更新警告并原样转发 console.error，安装和卸载幂等', () => {
    const forward = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installReactCommitCascadeDiagnostics();
    const wrapped = console.error;
    installReactCommitCascadeDiagnostics();
    expect(console.error).toBe(wrapped);
    console.error('The result of getSnapshot should be cached', 'at ChatPage');
    console.error('unrelated secret business output');
    const report = dumpReactCommitCascadeReport();
    expect(report).toContain('at ChatPage');
    expect(report).not.toContain('unrelated secret business output');
    expect(forward).toHaveBeenCalledTimes(2);
    uninstallReactCommitCascadeDiagnostics();
    expect(console.error).toBe(forward);
  });

  it('真实 Profiler 能采集有界布局更新链，且父子回调属于同一提交', () => {
    function LayoutUpdates() {
      const [value, setValue] = useState(0);
      useLayoutEffect(() => {
        if (value < 3) setValue(value + 1);
      }, [value]);
      return createElement('span', null, value);
    }
    render(
      createElement(
        Profiler,
        { id: 'app-root', onRender: recordReactCommit },
        createElement(
          Profiler,
          { id: 'route:test', onRender: recordReactCommit },
          createElement(LayoutUpdates),
        ),
      ),
    );
    const report = dumpReactCommitCascadeReport();
    expect(report).toContain('独立提交总数：4');
    expect(report).toContain('route:test:nested-update');
    expect(report).toContain('app-root:nested-update');
  });
});
