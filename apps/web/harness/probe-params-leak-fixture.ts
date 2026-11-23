import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';

/**
 * 用真实会话记录生成 harness 夹具：模拟 recovery 瘦身后的形态
 * （每个字符串叶子截到 8000 字符 + 截断标记），覆盖截图里的那种大文件。
 */
const db = new Database('/home/await/.local/share/OpenAWork/native-gateway/data/openAwork.db', {
  readonly: true,
});

const LIMIT = 8000;
function slim(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > LIMIT
      ? `${value.slice(0, LIMIT)}\n…[truncated, ${value.length - LIMIT} chars omitted]`
      : value;
  }
  if (Array.isArray(value)) return value.map(slim);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = slim(v);
    return out;
  }
  return value;
}

const ids = [35277, 35248, 35284];
const cases: Array<{
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output: string;
}> = [];

for (const id of ids) {
  const row = db
    .query('SELECT tool_name, input_json, output_json FROM audit_logs WHERE id = ?')
    .get(id) as { tool_name: string; input_json: string | null; output_json: string };
  const parsed = JSON.parse(row.output_json) as Record<string, unknown>;
  const slimmed = JSON.stringify(slim(parsed));
  const rawInput = row.input_json ? (JSON.parse(row.input_json) as Record<string, unknown>) : {};
  cases.push({
    id: `real-${id}`,
    tool: row.tool_name,
    input: rawInput,
    output: slimmed,
  });
}

db.close();

const body = `/* 由 probe 脚本从真实会话记录生成，仅用于 harness 验收。 */
export interface ParamsLeakCase {
  id: string;
  input: Record<string, unknown>;
  output: string;
  tool: string;
}

export const cases: readonly ParamsLeakCase[] = ${JSON.stringify(cases, null, 2)};
`;

writeFileSync('apps/web/harness/params-leak-fixtures.ts', body);
console.log(`已生成 ${cases.length} 个用例，字节数 ${body.length}`);
