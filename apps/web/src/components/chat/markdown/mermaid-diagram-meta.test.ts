import { describe, expect, it } from 'vitest';
import {
  buildExportableSvg,
  detectMermaidDiagramKind,
  getMermaidDiagramLabel,
  isMermaidFenceLanguage,
  parseSvgIntrinsicSize,
} from './mermaid-diagram-meta.js';

describe('isMermaidFenceLanguage', () => {
  it('认下常见别名与「直接写图表类型」的写法', () => {
    for (const language of ['mermaid', 'MERMAID', 'mmd', 'mindmap', 'flowchart', 'gantt']) {
      expect(isMermaidFenceLanguage(language), language).toBe(true);
    }
  });

  it('不误伤普通代码语言', () => {
    for (const language of ['ts', 'typescript', 'python', 'json', 'graphql', undefined]) {
      expect(isMermaidFenceLanguage(language), String(language)).toBe(false);
    }
  });
});

describe('detectMermaidDiagramKind', () => {
  it('识别思维导图', () => {
    expect(detectMermaidDiagramKind(['mindmap', '  root((主题))', '    分支'].join('\n'))).toBe(
      'mindmap',
    );
    expect(getMermaidDiagramLabel('mindmap')).toBe('思维导图');
  });

  it('识别流程图的不同写法', () => {
    expect(detectMermaidDiagramKind('graph TD\n  A --> B')).toBe('flowchart');
    expect(detectMermaidDiagramKind('flowchart LR\n  A --> B')).toBe('flowchart');
  });

  it('跳过注释、指令与元信息块', () => {
    const code = [
      '%% 这个流程图说明流程',
      '%%{init: {"theme":"base"}}%%',
      '---',
      'title: 示例',
      '---',
      'sequenceDiagram',
      '  A->>B: hi',
    ].join('\n');

    expect(detectMermaidDiagramKind(code)).toBe('sequence');
  });

  it('识别常见图表类型', () => {
    const cases: Array<[string, string]> = [
      ['classDiagram\n  class A', 'class'],
      ['stateDiagram-v2\n  [*] --> A', 'state'],
      ['erDiagram\n  A ||--o{ B : has', 'entityRelationship'],
      ['gantt\n  title 计划', 'gantt'],
      ['pie title 占比\n  "a" : 1', 'pie'],
      ['journey\n  title 体验', 'journey'],
      ['gitGraph\n  commit', 'gitGraph'],
      ['timeline\n  title 里程碑', 'timeline'],
      ['quadrantChart\n  x-axis 低 --> 高', 'quadrant'],
      ['xychart-beta\n  line [1, 2]', 'xyChart'],
      ['kanban\n  todo[待办]', 'kanban'],
      ['C4Context\n  Person(a, "b")', 'c4'],
    ];

    for (const [code, expected] of cases) {
      expect(detectMermaidDiagramKind(code), code.split('\n')[0] ?? '').toBe(expected);
    }
  });

  it('无法识别时退回通用分类', () => {
    expect(detectMermaidDiagramKind('somethingWeird\n  a -> b')).toBe('unknown');
    expect(detectMermaidDiagramKind('')).toBe('unknown');
    expect(getMermaidDiagramLabel('unknown')).toBe('图表');
  });
});

describe('parseSvgIntrinsicSize', () => {
  it('解析 mermaid 输出的 viewBox', () => {
    expect(
      parseSvgIntrinsicSize('<svg viewBox="0 0 1200.5 480" style="max-width:1200px;">'),
    ).toEqual({ width: 1200.5, height: 480 });
  });

  it('缺失或非法时返回 null，交给调用方退化为自适应宽度', () => {
    expect(parseSvgIntrinsicSize('<svg>')).toBeNull();
    expect(parseSvgIntrinsicSize('<svg viewBox="0 0 0 480">')).toBeNull();
    expect(parseSvgIntrinsicSize('<svg viewBox="0 0 abc 480">')).toBeNull();
  });
});

describe('buildExportableSvg', () => {
  it('补上命名空间与背景，单独打开不是透明底', () => {
    const output = buildExportableSvg('<svg viewBox="0 0 10 10"><g/></svg>', '#0f1428');

    expect(output).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(output).toContain('<rect width="100%" height="100%" fill="#0f1428"/>');
    expect(output).toContain('<g/>');
  });

  it('已有命名空间时不重复添加', () => {
    const output = buildExportableSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
      '#fff',
    );

    expect(output.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/gu)).toHaveLength(1);
  });
});
