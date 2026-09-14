import { describe, expect, it } from 'vitest';
import { extractTableData, toCsv, toDelimitedText } from './markdown-table-data.js';

type CellTag = 'th' | 'td';

function text(value: string) {
  return { type: 'text', value };
}

function cell(tagName: CellTag, children: unknown[]) {
  return { type: 'element', tagName, properties: {}, children };
}

function row(cells: unknown[]) {
  return { type: 'element', tagName: 'tr', properties: {}, children: cells };
}

function table(...sections: unknown[]) {
  return { type: 'element', tagName: 'table', properties: {}, children: sections };
}

function section(tagName: 'thead' | 'tbody', ...rows: unknown[]) {
  return { type: 'element', tagName, properties: {}, children: rows };
}

const SAMPLE = table(
  section(
    'thead',
    row([cell('th', [text('名称')]), cell('th', [text('状态')]), cell('th', [text('备注')])]),
  ),
  section(
    'tbody',
    row([cell('td', [text('表格渲染')]), cell('td', [text('进行中')]), cell('td', [text('—')])]),
    row([cell('td', [text('思维导图')]), cell('td', [text('待办')]), cell('td', [text('—')])]),
  ),
);

describe('extractTableData', () => {
  it('抽出表头与数据行', () => {
    const parsed = extractTableData(SAMPLE);

    expect(parsed?.header).toEqual(['名称', '状态', '备注']);
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[0]).toEqual(['表格渲染', '进行中', '—']);
    expect(parsed?.columnCount).toBe(3);
  });

  it('单元格里的 <br> 还原为换行，导出后不丢结构', () => {
    const node = table(
      section('thead', row([cell('th', [text('评论')])])),
      section('tbody', row([cell('td', [text('第一行'), text('<br>'), text('第二行')])])),
    );

    expect(extractTableData(node)?.rows[0]?.[0]).toBe('第一行\n第二行');
  });

  it('真实 <br> 元素同样还原为换行', () => {
    const node = table(
      section('thead', row([cell('th', [text('评论')])])),
      section(
        'tbody',
        row([
          cell('td', [
            text('A'),
            { type: 'element', tagName: 'br', properties: {}, children: [] },
            text('B'),
          ]),
        ]),
      ),
    );

    expect(extractTableData(node)?.rows[0]?.[0]).toBe('A\nB');
  });

  it('行头不在 thead 时也按表头处理', () => {
    const node = table(
      section('tbody', row([cell('th', [text('列')])]), row([cell('td', [text('值')])])),
    );

    expect(extractTableData(node)?.header).toEqual(['列']);
    expect(extractTableData(node)?.rows).toEqual([['值']]);
  });

  it('列数不一致时按最大列数补齐', () => {
    const node = table(
      section('thead', row([cell('th', [text('a')]), cell('th', [text('b')])])),
      section('tbody', row([cell('td', [text('1')])])),
    );

    const parsed = extractTableData(node);
    expect(parsed?.columnCount).toBe(2);
    expect(parsed?.rows[0]).toEqual(['1', '']);
  });

  it('非表格节点返回 null', () => {
    expect(extractTableData(null)).toBeNull();
    expect(extractTableData(undefined)).toBeNull();
    expect(extractTableData({ type: 'element', tagName: 'div', children: [] })).toBeNull();
  });
});

describe('toCsv', () => {
  it('包含表头并对逗号、引号、换行做转义', () => {
    const csv = toCsv({
      header: ['名称', '备注'],
      rows: [
        ['a,b', '含"引号"'],
        ['多行', '第一行\n第二行'],
      ],
      columnCount: 2,
    });

    expect(csv.split('\r\n')[0]).toBe('名称,备注');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"含""引号"""');
    expect(csv).toContain('"第一行\n第二行"');
  });
});

describe('toDelimitedText', () => {
  it('用制表符连接，并压平单元格内的换行与制表符', () => {
    const text = toDelimitedText(
      [
        ['名称', '备注'],
        ['多行\n文本', '含\t制表符'],
      ],
      '\t',
    );

    expect(text).toBe('名称\t备注\n多行 文本\t含 制表符');
  });
});
