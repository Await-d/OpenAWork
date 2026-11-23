const SLIM_STRING_MAX = 800;
const SLIM_OUTPUT_TOTAL_MAX = 4000;

const marker = (n: number) => `\n…[truncated, ${n} chars omitted]`;
const truncStr = (v: string, max: number) =>
  v.length <= max ? v : v.slice(0, max) + marker(v.length - max);

function slimOutputValue(output: unknown): unknown {
  if (typeof output === 'string') return truncStr(output, SLIM_STRING_MAX);
  if (!output || typeof output !== 'object') return output;
  if (Array.isArray(output)) return output.map(slimOutputValue);
  const obj = output as Record<string, unknown>;
  const slimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    slimmed[k] =
      typeof v === 'string' && v.length > SLIM_STRING_MAX ? truncStr(v, SLIM_STRING_MAX) : v;
  }
  const serialized = JSON.stringify(slimmed);
  if (serialized.length > SLIM_OUTPUT_TOTAL_MAX) return truncStr(serialized, SLIM_OUTPUT_TOTAL_MAX);
  return slimmed;
}

const out = {
  before: 'A'.repeat(2539),
  after: 'B'.repeat(2536),
  created: false,
  filediff: {
    file: '/x.js',
    before: 'A'.repeat(2539),
    after: 'B'.repeat(2536),
    additions: 3,
    deletions: 4,
  },
  success: true,
  path: '/x.js',
  bytes: 2536,
};

const slimmed = slimOutputValue(out);
console.log('原始类型:', typeof out);
console.log('瘦身后类型:', typeof slimmed);
console.log('瘦身后开头 220 字符:');
console.log(JSON.stringify(String(slimmed).slice(0, 220)));
console.log('');
console.log('瘦身后结尾 120 字符:');
console.log(JSON.stringify(String(slimmed).slice(-120)));
