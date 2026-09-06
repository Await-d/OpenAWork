import { DatabaseSync } from 'node:sqlite';
import { requestPlanningCompletion } from '../handoff/runner/planning-completion.js';
import { investigatePlanningProject } from '../handoff/runner/planning-investigation.js';
import { collectPlanningProjectContext } from '../handoff/runner/planning-project-context.js';
import { validateSpecOutput } from '../handoff/runner/artifact-chain.js';
import { SPEC_TEMPLATE_SYSTEM_INSTRUCTION } from '../team-phase-c-content/index.js';

const [database, userId, directory] = process.argv.slice(2);
if (!database || !userId || !directory) throw new Error('参数：只读数据库路径 用户ID 调查目录');
const db = new DatabaseSync(database, { readOnly: true });
const row = db
  .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
  .get(userId, 'providers');
db.close();
const providers = JSON.parse(
  String(typeof row === 'object' && row !== null && 'value' in row ? row.value : '[]'),
) as Array<{
  id: string;
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
}>;
const provider = providers.find((item) => item.id === 'zhipu' && item.enabled);
if (!provider?.apiKey || !provider.baseUrl) throw new Error('缺少智谱配置');
const signal = AbortSignal.timeout(600_000);
const callLlm = (system: string, prompt: string) =>
  requestPlanningCompletion({
    apiKey: provider.apiKey!,
    apiBaseUrl: provider.baseUrl!,
    providerType: 'zhipu',
    model: 'glm-5.3-flash',
    temperature: 0.3,
    signal,
    system,
    prompt,
  });
const intent = '为规划完成调用增加空输出回归测试，保持现有接口兼容。只生成规格，不修改文件。';
const context = await investigatePlanningProject({
  directory,
  intent,
  initialContext: await collectPlanningProjectContext(directory),
  signal,
  callLlm,
});
console.log(
  JSON.stringify({ stage: 'investigation', completed: true, evidenceCharacters: context.length }),
);
const spec = await callLlm(SPEC_TEMPLATE_SYSTEM_INSTRUCTION, `${intent}\n\n调查依据：${context}`);
const validation = validateSpecOutput(spec);
console.log(
  JSON.stringify({ stage: 'spec', model: 'glm-5.3-flash', characters: spec.length, validation }),
);
if (!validation.ok) process.exitCode = 1;
