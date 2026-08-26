# P0 缓存上下文计费复查包

## 原始目标

1. 说明模型连接时的上下文长度如何判断。
2. 说明同步模型数据如何获知上下文长度。
3. 实现多级上下文计费，并识别支持多级上下文的模型。
4. 用户同意“快速调整”后，本轮明确收敛为 P0：缓存读取/写入 token 的价格同步与费用计算闭环。

## 本轮验收边界

- models.dev 的 cache_read/cache_write 映射到模型配置。
- cache read/write token 在流式主会话、月度用量、团队流式和非流式工作流路径中按独立价格计费。
- 无缓存价格时回退普通输入价，避免免费计费。
- 仅缓存 token 的调用不可被零输入/零输出守卫丢弃。
- 不扩展长上下文阶梯定价、推理 token 单独价格或缓存能力 UI。

## 约束

- TypeScript 严格模式；禁止 any、类型抑制、CommonJS。
- 不改动 .evidence；不执行 git 回滚操作；保留其他未提交修改。
- Provider 设置需经过 Zod 解析；现有对外 API 应保持兼容。

## 复查范围文件

- `packages/agent-core/src/index.ts`
- `packages/agent-core/src/provider/index.ts`
- `packages/agent-core/src/provider/manager.ts`
- `packages/agent-core/src/provider/types.ts`
- `packages/agent-core/src/provider/utils.ts`
- `packages/agent-core/src/provider/utils.test.ts`
- `services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts`
- `services/agent-gateway/src/__tests__/routes/workflow-llm-usage-event.test.ts`
- `services/agent-gateway/src/__tests__/session/usage-records-store.test.ts`
- `services/agent-gateway/src/handoff/runner/pm1-runner.ts`
- `services/agent-gateway/src/handoff/runner/pm2-quality-review-reconciler.ts`
- `services/agent-gateway/src/handoff/runner/pm2-runner.ts`
- `services/agent-gateway/src/handoff/runner/reception-orchestrator.ts`
- `services/agent-gateway/src/provider/auxiliary-llm-config.ts`
- `services/agent-gateway/src/provider/model-router.ts`
- `services/agent-gateway/src/provider/models-dev-discover.ts`
- `services/agent-gateway/src/provider/provider-config.ts`
- `services/agent-gateway/src/routes/stream-runtime.ts`
- `services/agent-gateway/src/routes/stream-team-events.ts`
- `services/agent-gateway/src/routes/stream.ts`
- `services/agent-gateway/src/routes/workflow-llm.ts`
- `services/agent-gateway/src/session/usage-records-store.ts`
- `services/agent-gateway/src/team/team-usage-records-store.ts`
- `services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts`

## 已运行验证（待独立复核）

- gateway 定向 Vitest：5 文件、20 测试通过。
- agent-core utils Vitest：1 文件、2 测试通过。
- agent-core 与 gateway 类型检查通过。
- ESLint 与全仓 Prettier 检查通过。
- 费用手工样例：1000 输入 × $3/M + 500 输出 × $15/M + 4000 缓存读取 × $0.3/M + 2000 缓存写入 × $3.75/M = $0.0192。

## 差异（已跟踪文件）

```diff
diff --git a/packages/agent-core/src/index.ts b/packages/agent-core/src/index.ts
index 23a3e955..128cb3b9 100644
--- a/packages/agent-core/src/index.ts
+++ b/packages/agent-core/src/index.ts
@@ -241,7 +241,9 @@ export {
   mergeBuiltinModels,
   buildRequestOverrides,
   calculateTokenCost,
+  calculateTokenUsageCost,
 } from './provider/utils.js';
+export type { TokenUsageCostInput } from './provider/utils.js';
 export * from './oauth/index.js';

 export type { StreamCheckpoint, StreamRecoveryManager } from './stream/recovery.js';
diff --git a/packages/agent-core/src/provider/index.ts b/packages/agent-core/src/provider/index.ts
index 7fa16132..52a80c01 100644
--- a/packages/agent-core/src/provider/index.ts
+++ b/packages/agent-core/src/provider/index.ts
@@ -60,4 +60,6 @@ export {
   mergeBuiltinModels,
   buildRequestOverrides,
   calculateTokenCost,
+  calculateTokenUsageCost,
 } from './utils.js';
+export type { TokenUsageCostInput } from './utils.js';
diff --git a/packages/agent-core/src/provider/manager.ts b/packages/agent-core/src/provider/manager.ts
index d23d0f14..63c51327 100644
--- a/packages/agent-core/src/provider/manager.ts
+++ b/packages/agent-core/src/provider/manager.ts
@@ -384,6 +384,8 @@ export class ProviderManagerImpl implements ProviderManager {
         : model.supportsVision,
       inputPricePerMillion: live.cost?.input ?? model.inputPricePerMillion,
       outputPricePerMillion: live.cost?.output ?? model.outputPricePerMillion,
+      cacheReadPricePerMillion: live.cost?.cache_read ?? model.cacheReadPricePerMillion,
+      cacheWritePricePerMillion: live.cost?.cache_write ?? model.cacheWritePricePerMillion,
     };
   }

@@ -407,6 +409,8 @@ export class ProviderManagerImpl implements ProviderManager {
       supportsThinking: live.reasoning ?? false,
       inputPricePerMillion: live.cost?.input,
       outputPricePerMillion: live.cost?.output,
+      cacheReadPricePerMillion: live.cost?.cache_read,
+      cacheWritePricePerMillion: live.cost?.cache_write,
     };
   }

diff --git a/packages/agent-core/src/provider/types.ts b/packages/agent-core/src/provider/types.ts
index a5388981..a8fd3080 100644
--- a/packages/agent-core/src/provider/types.ts
+++ b/packages/agent-core/src/provider/types.ts
@@ -81,6 +81,8 @@ export interface AIModelConfig {
   supportsThinking?: boolean;
   inputPricePerMillion?: number;
   outputPricePerMillion?: number;
+  cacheReadPricePerMillion?: number;
+  cacheWritePricePerMillion?: number;
   thinking?: ThinkingConfig;
   requestOverrides?: RequestOverrides;
 }
diff --git a/packages/agent-core/src/provider/utils.ts b/packages/agent-core/src/provider/utils.ts
index 5c36221c..b4e4e1f0 100644
--- a/packages/agent-core/src/provider/utils.ts
+++ b/packages/agent-core/src/provider/utils.ts
@@ -87,17 +87,48 @@ export const buildRequestOverrides = (
   return merged;
 };

+export type TokenUsageCostInput = {
+  readonly inputTokens: number;
+  readonly outputTokens: number;
+  readonly cacheReadTokens?: number;
+  readonly cacheWriteTokens?: number;
+  readonly inputPricePerMillion?: number;
+  readonly outputPricePerMillion?: number;
+  readonly cacheReadPricePerMillion?: number;
+  readonly cacheWritePricePerMillion?: number;
+};
+
+function normalizeTokenCount(value: number | undefined): number {
+  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
+}
+
+function normalizePrice(value: number | undefined): number {
+  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
+}
+
+export const calculateTokenUsageCost = (input: TokenUsageCostInput): number => {
+  const inputPrice = normalizePrice(input.inputPricePerMillion);
+  const totalUsd =
+    (normalizeTokenCount(input.inputTokens) * inputPrice +
+      normalizeTokenCount(input.outputTokens) * normalizePrice(input.outputPricePerMillion) +
+      normalizeTokenCount(input.cacheReadTokens) *
+        normalizePrice(input.cacheReadPricePerMillion ?? inputPrice) +
+      normalizeTokenCount(input.cacheWriteTokens) *
+        normalizePrice(input.cacheWritePricePerMillion ?? inputPrice)) /
+    1_000_000;
+  return Number(totalUsd.toFixed(8));
+};
+
 export const calculateTokenCost = (
   inputTokens: number,
   outputTokens: number,
   inputPricePerMillion?: number,
   outputPricePerMillion?: number,
 ): number => {
-  const safeInputTokens = Math.max(0, inputTokens);
-  const safeOutputTokens = Math.max(0, outputTokens);
-  const inPrice = inputPricePerMillion ?? 0;
-  const outPrice = outputPricePerMillion ?? 0;
-
-  const totalUsd = (safeInputTokens * inPrice + safeOutputTokens * outPrice) / 1_000_000;
-  return Number(totalUsd.toFixed(8));
+  return calculateTokenUsageCost({
+    inputTokens,
+    outputTokens,
+    inputPricePerMillion,
+    outputPricePerMillion,
+  });
 };
diff --git a/services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts b/services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts
index 53bd8d93..2cbbbef0 100644
--- a/services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts
+++ b/services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts
@@ -25,6 +25,7 @@ const sample: ModelsDevData = {
         id: 'meta-llama/Llama-3-8b',
         name: 'Llama 3 8B',
         tool_call: true,
+        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 },
       },
       old: { id: 'old', name: 'Old', status: 'deprecated' },
     },
@@ -58,6 +59,16 @@ describe('models-dev-discover', () => {
     expect(provider.id.startsWith('custom-md-together-')).toBe(true);
   });

+  it('从 models.dev 保留缓存读取和写入价格', () => {
+    const provider = buildCustomProviderFromModelsDev(sample, 'together');
+    const model = provider.defaultModels.find((item) => item.id === 'meta-llama/Llama-3-8b');
+
+    expect(model).toMatchObject({
+      cacheReadPricePerMillion: 0.1,
+      cacheWritePricePerMillion: 1.25,
+    });
+  });
+
   it('未知 id 抛错', () => {
     expect(() => buildCustomProviderFromModelsDev(sample, 'nope')).toThrow(/not found/i);
   });
diff --git a/services/agent-gateway/src/__tests__/routes/workflow-llm-usage-event.test.ts b/services/agent-gateway/src/__tests__/routes/workflow-llm-usage-event.test.ts
index e389ae9a..0b515d52 100644
--- a/services/agent-gateway/src/__tests__/routes/workflow-llm-usage-event.test.ts
+++ b/services/agent-gateway/src/__tests__/routes/workflow-llm-usage-event.test.ts
@@ -108,6 +108,42 @@ describe('requestWorkflowLlmCompletion · team_usage 事件', () => {
     expect(envelope.payload?.['costUsd']).toBeCloseTo(0.0105, 6);
   });

+  it('缓存 token 使用缓存单价并写入团队用量事件', async () => {
+    mocks.runUpstreamGenerate.mockReturnValue(
+      Effect.succeed({
+        text: 'ok',
+        inputTokens: 1_000,
+        outputTokens: 500,
+        cacheReadTokens: 4_000,
+        cacheWriteTokens: 2_000,
+        finishReason: 'stop',
+        raw: {},
+      }),
+    );
+
+    await requestWorkflowLlmCompletion({
+      ...BASE_INPUT,
+      usageContext: {
+        userId: 'u-1',
+        sessionId: 's-1',
+        layer: 'pm1',
+        inputPricePerMillion: 3,
+        outputPricePerMillion: 15,
+        cacheReadPricePerMillion: 0.3,
+        cacheWritePricePerMillion: 3.75,
+      },
+    });
+
+    const envelope = mocks.publishTeamEvent.mock.calls[0]?.[0] as {
+      payload?: Record<string, unknown>;
+    };
+    expect(envelope.payload).toMatchObject({
+      cacheReadTokens: 4_000,
+      cacheWriteTokens: 2_000,
+    });
+    expect(envelope.payload?.['costUsd']).toBeCloseTo(0.0192, 8);
+  });
+
   it('未提供 usageContext 时不发任何 team 事件（chat 端不受影响）', async () => {
     mocks.runUpstreamGenerate.mockReturnValue(
       Effect.succeed({
diff --git a/services/agent-gateway/src/handoff/runner/pm1-runner.ts b/services/agent-gateway/src/handoff/runner/pm1-runner.ts
index 89c4d2df..56e76b3b 100644
--- a/services/agent-gateway/src/handoff/runner/pm1-runner.ts
+++ b/services/agent-gateway/src/handoff/runner/pm1-runner.ts
@@ -919,6 +919,12 @@ async function runPm1(input: Parameters<HandoffTaskRunner>[0]): Promise<void> {
         ...(typeof llmConfig.outputPricePerMillion === 'number'
           ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
           : {}),
+        ...(typeof llmConfig.cacheReadPricePerMillion === 'number'
+          ? { cacheReadPricePerMillion: llmConfig.cacheReadPricePerMillion }
+          : {}),
+        ...(typeof llmConfig.cacheWritePricePerMillion === 'number'
+          ? { cacheWritePricePerMillion: llmConfig.cacheWritePricePerMillion }
+          : {}),
       },
     });
   };
diff --git a/services/agent-gateway/src/handoff/runner/pm2-quality-review-reconciler.ts b/services/agent-gateway/src/handoff/runner/pm2-quality-review-reconciler.ts
index a9825e59..b09cc0dd 100644
--- a/services/agent-gateway/src/handoff/runner/pm2-quality-review-reconciler.ts
+++ b/services/agent-gateway/src/handoff/runner/pm2-quality-review-reconciler.ts
@@ -549,6 +549,12 @@ export async function reconcilePm2QualityReview(input: {
                 ...(typeof llmConfig.outputPricePerMillion === 'number'
                   ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
                   : {}),
+                ...(typeof llmConfig.cacheReadPricePerMillion === 'number'
+                  ? { cacheReadPricePerMillion: llmConfig.cacheReadPricePerMillion }
+                  : {}),
+                ...(typeof llmConfig.cacheWritePricePerMillion === 'number'
+                  ? { cacheWritePricePerMillion: llmConfig.cacheWritePricePerMillion }
+                  : {}),
               },
             });
           } catch (err) {
diff --git a/services/agent-gateway/src/handoff/runner/pm2-runner.ts b/services/agent-gateway/src/handoff/runner/pm2-runner.ts
index 42d3abd5..0509e999 100644
--- a/services/agent-gateway/src/handoff/runner/pm2-runner.ts
+++ b/services/agent-gateway/src/handoff/runner/pm2-runner.ts
@@ -568,6 +568,12 @@ export function createPm2Runner(): HandoffTaskRunner {
                       ...(typeof llmConfig.outputPricePerMillion === 'number'
                         ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
                         : {}),
+                      ...(typeof llmConfig.cacheReadPricePerMillion === 'number'
+                        ? { cacheReadPricePerMillion: llmConfig.cacheReadPricePerMillion }
+                        : {}),
+                      ...(typeof llmConfig.cacheWritePricePerMillion === 'number'
+                        ? { cacheWritePricePerMillion: llmConfig.cacheWritePricePerMillion }
+                        : {}),
                     },
                   });
                 } catch (err) {
diff --git a/services/agent-gateway/src/handoff/runner/reception-orchestrator.ts b/services/agent-gateway/src/handoff/runner/reception-orchestrator.ts
index c5be0e2c..5e03a00d 100644
--- a/services/agent-gateway/src/handoff/runner/reception-orchestrator.ts
+++ b/services/agent-gateway/src/handoff/runner/reception-orchestrator.ts
@@ -350,6 +350,12 @@ async function runReceptionOrchestrationBody(
             ...(typeof llmConfig.outputPricePerMillion === 'number'
               ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
               : {}),
+            ...(typeof llmConfig.cacheReadPricePerMillion === 'number'
+              ? { cacheReadPricePerMillion: llmConfig.cacheReadPricePerMillion }
+              : {}),
+            ...(typeof llmConfig.cacheWritePricePerMillion === 'number'
+              ? { cacheWritePricePerMillion: llmConfig.cacheWritePricePerMillion }
+              : {}),
           },
         });
       },
@@ -564,6 +570,12 @@ async function runReceptionOrchestrationBody(
         ...(typeof llmConfig.outputPricePerMillion === 'number'
           ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
           : {}),
+        ...(typeof llmConfig.cacheReadPricePerMillion === 'number'
+          ? { cacheReadPricePerMillion: llmConfig.cacheReadPricePerMillion }
+          : {}),
+        ...(typeof llmConfig.cacheWritePricePerMillion === 'number'
+          ? { cacheWritePricePerMillion: llmConfig.cacheWritePricePerMillion }
+          : {}),
       },
     });
   } catch (err) {
diff --git a/services/agent-gateway/src/provider/auxiliary-llm-config.ts b/services/agent-gateway/src/provider/auxiliary-llm-config.ts
index 44e468ea..34e7e892 100644
--- a/services/agent-gateway/src/provider/auxiliary-llm-config.ts
+++ b/services/agent-gateway/src/provider/auxiliary-llm-config.ts
@@ -82,6 +82,8 @@ export interface ResolvedAuxiliaryLlmConfig {
    */
   inputPricePerMillion?: number;
   outputPricePerMillion?: number;
+  cacheReadPricePerMillion?: number;
+  cacheWritePricePerMillion?: number;
 }

 /**
@@ -228,6 +230,12 @@ function resolveProviderCredentials(
     ...(typeof modelEntry?.outputPricePerMillion === 'number'
       ? { outputPricePerMillion: modelEntry.outputPricePerMillion }
       : {}),
+    ...(typeof modelEntry?.cacheReadPricePerMillion === 'number'
+      ? { cacheReadPricePerMillion: modelEntry.cacheReadPricePerMillion }
+      : {}),
+    ...(typeof modelEntry?.cacheWritePricePerMillion === 'number'
+      ? { cacheWritePricePerMillion: modelEntry.cacheWritePricePerMillion }
+      : {}),
   };
 }

diff --git a/services/agent-gateway/src/provider/model-router.ts b/services/agent-gateway/src/provider/model-router.ts
index a62e0c90..0b222fc1 100644
--- a/services/agent-gateway/src/provider/model-router.ts
+++ b/services/agent-gateway/src/provider/model-router.ts
@@ -47,6 +47,8 @@ export interface ModelRouteConfig {
   providerType?: AIProvider['type'];
   inputPricePerMillion?: number;
   outputPricePerMillion?: number;
+  cacheReadPricePerMillion?: number;
+  cacheWritePricePerMillion?: number;
   supportsThinking: boolean;
   systemPrompt?: string;
 }
@@ -226,6 +228,8 @@ export function resolveModelRoute(request: ModelRequest): ModelRouteConfig {
     providerType,
     inputPricePerMillion: builtinModel?.inputPricePerMillion,
     outputPricePerMillion: builtinModel?.outputPricePerMillion,
+    cacheReadPricePerMillion: builtinModel?.cacheReadPricePerMillion,
+    cacheWritePricePerMillion: builtinModel?.cacheWritePricePerMillion,
     supportsThinking: builtinModel?.supportsThinking === true,
     systemPrompt: request.systemPrompt,
   };
@@ -301,6 +305,8 @@ export function resolveModelRouteFromProvider(
     providerType: provider.type,
     inputPricePerMillion: modelConfig?.inputPricePerMillion,
     outputPricePerMillion: modelConfig?.outputPricePerMillion,
+    cacheReadPricePerMillion: modelConfig?.cacheReadPricePerMillion,
+    cacheWritePricePerMillion: modelConfig?.cacheWritePricePerMillion,
     supportsThinking: modelConfig?.supportsThinking === true,
     systemPrompt: request.systemPrompt,
   };
diff --git a/services/agent-gateway/src/provider/models-dev-discover.ts b/services/agent-gateway/src/provider/models-dev-discover.ts
index b4c78a15..c0f916dd 100644
--- a/services/agent-gateway/src/provider/models-dev-discover.ts
+++ b/services/agent-gateway/src/provider/models-dev-discover.ts
@@ -84,6 +84,8 @@ function mapLiveModel(modelId: string, live: ModelsDevModel): AIModelConfig {
     supportsThinking: live.reasoning ?? false,
     inputPricePerMillion: live.cost?.input,
     outputPricePerMillion: live.cost?.output,
+    cacheReadPricePerMillion: live.cost?.cache_read,
+    cacheWritePricePerMillion: live.cost?.cache_write,
   };
 }

diff --git a/services/agent-gateway/src/provider/provider-config.ts b/services/agent-gateway/src/provider/provider-config.ts
index ee35cdaa..56917b36 100644
--- a/services/agent-gateway/src/provider/provider-config.ts
+++ b/services/agent-gateway/src/provider/provider-config.ts
@@ -115,6 +115,7 @@ const oauthConfigSchema = z.object({
 });

 const nonNegativeIntegerMetadataSchema = z.number().int().nonnegative().optional();
+const compactionRatioMetadataSchema = z.number().gt(0).lt(1).optional();

 export const aiModelConfigSchema = z.object({
   id: z.string().min(1),
@@ -122,6 +123,8 @@ export const aiModelConfigSchema = z.object({
   enabled: z.boolean(),
   contextWindow: nonNegativeIntegerMetadataSchema,
   maxOutputTokens: nonNegativeIntegerMetadataSchema,
+  autoCompactThresholdRatio: compactionRatioMetadataSchema,
+  autoCompactTargetRatio: compactionRatioMetadataSchema,
   supportsTools: z.boolean().optional(),
   supportsVision: z.boolean().optional(),
   supportsImageGeneration: z.boolean().optional(),
@@ -129,6 +132,8 @@ export const aiModelConfigSchema = z.object({
   supportsThinking: z.boolean().optional(),
   inputPricePerMillion: z.number().min(0).optional(),
   outputPricePerMillion: z.number().min(0).optional(),
+  cacheReadPricePerMillion: z.number().min(0).optional(),
+  cacheWritePricePerMillion: z.number().min(0).optional(),
   thinking: thinkingConfigSchema.optional(),
   requestOverrides: requestOverridesSchema.optional(),
 });
diff --git a/services/agent-gateway/src/routes/stream-runtime.ts b/services/agent-gateway/src/routes/stream-runtime.ts
index 289c2159..70d43249 100644
--- a/services/agent-gateway/src/routes/stream-runtime.ts
+++ b/services/agent-gateway/src/routes/stream-runtime.ts
@@ -560,6 +560,8 @@ async function continueFromApprovedToolResult(input: {
             occurredAt: result.usageOccurredAt,
             inputPricePerMillion: route.inputPricePerMillion,
             outputPricePerMillion: route.outputPricePerMillion,
+            cacheReadPricePerMillion: route.cacheReadPricePerMillion,
+            cacheWritePricePerMillion: route.cacheWritePricePerMillion,
             usage: result.usage,
             userId: input.userId,
           });
diff --git a/services/agent-gateway/src/routes/stream-team-events.ts b/services/agent-gateway/src/routes/stream-team-events.ts
index ce72f167..642e012a 100644
--- a/services/agent-gateway/src/routes/stream-team-events.ts
+++ b/services/agent-gateway/src/routes/stream-team-events.ts
@@ -119,7 +119,14 @@ export interface TeamWorkflowUsageEventInput {
 export function publishTeamWorkflowUsageEvent(input: TeamWorkflowUsageEventInput): void {
   if (!input.layer) return;
   // 没有任何 token 的调用（例如纯缓存命中或异常返回）不发，避免噪声。
-  if (input.inputTokens <= 0 && input.outputTokens <= 0) return;
+  if (
+    input.inputTokens <= 0 &&
+    input.outputTokens <= 0 &&
+    (input.cacheReadTokens ?? 0) <= 0 &&
+    (input.cacheWriteTokens ?? 0) <= 0
+  ) {
+    return;
+  }
   // 与 stream 路径一致地落库，让 reception / pm1 / pm2 的用量也能跨刷新 / 重连存活。
   // 落库失败（如极端 DB 错误）不应吞掉实时事件——分开 try/catch，保证「至少实时
   // 面板能看到」与「尽量落库」互不拖累。
diff --git a/services/agent-gateway/src/routes/stream.ts b/services/agent-gateway/src/routes/stream.ts
index 6b7174ea..84e0d0ab 100644
--- a/services/agent-gateway/src/routes/stream.ts
+++ b/services/agent-gateway/src/routes/stream.ts
@@ -49,7 +49,7 @@ import {
   YOLO_MODE_SYSTEM_PROMPT,
   detectThinkingLanguageHintFromText,
 } from './stream-system-prompts.js';
-import { KeywordDetectorImpl, redactText } from '@openAwork/agent-core';
+import { calculateTokenUsageCost, KeywordDetectorImpl, redactText } from '@openAwork/agent-core';
 import {
   deleteSessionRunEventsByRequest,
   hasPersistedRunEvent,
@@ -2819,6 +2819,8 @@ export async function handleStreamRequest(input: {
             occurredAt: result.usageOccurredAt,
             inputPricePerMillion: route.inputPricePerMillion,
             outputPricePerMillion: route.outputPricePerMillion,
+            cacheReadPricePerMillion: route.cacheReadPricePerMillion,
+            cacheWritePricePerMillion: route.cacheWritePricePerMillion,
             usage: result.usage,
             userId: input.user.sub,
           });
@@ -2844,9 +2846,16 @@ export async function handleStreamRequest(input: {
               costUsd:
                 typeof route.inputPricePerMillion === 'number' &&
                 typeof route.outputPricePerMillion === 'number'
-                  ? (result.usage.inputTokens * route.inputPricePerMillion +
-                      result.usage.outputTokens * route.outputPricePerMillion) /
-                    1_000_000
+                  ? calculateTokenUsageCost({
+                      inputTokens: result.usage.inputTokens,
+                      outputTokens: result.usage.outputTokens,
+                      cacheReadTokens: result.usage.cacheReadTokens,
+                      cacheWriteTokens: result.usage.cacheWriteTokens,
+                      inputPricePerMillion: route.inputPricePerMillion,
+                      outputPricePerMillion: route.outputPricePerMillion,
+                      cacheReadPricePerMillion: route.cacheReadPricePerMillion,
+                      cacheWritePricePerMillion: route.cacheWritePricePerMillion,
+                    })
                   : undefined,
             });
             publishTeamTimingEvent({
diff --git a/services/agent-gateway/src/routes/workflow-llm.ts b/services/agent-gateway/src/routes/workflow-llm.ts
index 1e2e5f52..60970def 100644
--- a/services/agent-gateway/src/routes/workflow-llm.ts
+++ b/services/agent-gateway/src/routes/workflow-llm.ts
@@ -18,7 +18,7 @@
  */

 import type { AIProvider } from '@openAwork/agent-core';
-import { inferProviderTypeFromHostname } from '@openAwork/agent-core';
+import { calculateTokenUsageCost, inferProviderTypeFromHostname } from '@openAwork/agent-core';
 import { Effect } from 'effect';
 import type { UpstreamProtocolKind } from '../v2-runtime/upstream/native-model.js';
 import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';
@@ -106,6 +106,8 @@ export interface WorkflowLlmRequestConfig {
     inputPricePerMillion?: number;
     /** 每百万输出 token 单价（USD）。 */
     outputPricePerMillion?: number;
+    cacheReadPricePerMillion?: number;
+    cacheWritePricePerMillion?: number;
   };
 }

@@ -197,12 +199,21 @@ export async function requestWorkflowLlmCompletion(
           result.inputTokens > 0 ? result.inputTokens : estimateTokensFromText(input.prompt);
         const outputTokens =
           result.outputTokens > 0 ? result.outputTokens : estimateTokensFromText(result.text);
+        const cacheReadTokens = result.cacheReadTokens;
+        const cacheWriteTokens = result.cacheWriteTokens;
         const costUsd =
           typeof usageContext.inputPricePerMillion === 'number' &&
           typeof usageContext.outputPricePerMillion === 'number'
-            ? (inputTokens * usageContext.inputPricePerMillion +
-                outputTokens * usageContext.outputPricePerMillion) /
-              1_000_000
+            ? calculateTokenUsageCost({
+                inputTokens,
+                outputTokens,
+                cacheReadTokens,
+                cacheWriteTokens,
+                inputPricePerMillion: usageContext.inputPricePerMillion,
+                outputPricePerMillion: usageContext.outputPricePerMillion,
+                cacheReadPricePerMillion: usageContext.cacheReadPricePerMillion,
+                cacheWritePricePerMillion: usageContext.cacheWritePricePerMillion,
+              })
             : undefined;
         publishTeamWorkflowUsageEvent({
           userId: usageContext.userId,
@@ -213,6 +224,8 @@ export async function requestWorkflowLlmCompletion(
           model: input.model,
           inputTokens,
           outputTokens,
+          ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
+          ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
           ...(costUsd !== undefined ? { costUsd } : {}),
         });
       } catch (err) {
diff --git a/services/agent-gateway/src/session/usage-records-store.ts b/services/agent-gateway/src/session/usage-records-store.ts
index b1c1151e..a2c8c98b 100644
--- a/services/agent-gateway/src/session/usage-records-store.ts
+++ b/services/agent-gateway/src/session/usage-records-store.ts
@@ -1,4 +1,4 @@
-import { calculateTokenCost } from '@openAwork/agent-core';
+import { calculateTokenUsageCost } from '@openAwork/agent-core';
 import { sqliteRun } from '../infra/db.js';
 import type { StreamUsageSummary } from '../routes/stream-usage.js';

@@ -6,23 +6,34 @@ export function persistMonthlyUsageRecord(input: {
   occurredAt?: number;
   inputPricePerMillion?: number;
   outputPricePerMillion?: number;
-  usage: Pick<StreamUsageSummary, 'inputTokens' | 'outputTokens'>;
+  cacheReadPricePerMillion?: number;
+  cacheWritePricePerMillion?: number;
+  usage: Pick<
+    StreamUsageSummary,
+    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
+  >;
   userId: string;
 }): void {
   const inputTokens = Math.max(0, Math.trunc(input.usage.inputTokens));
   const outputTokens = Math.max(0, Math.trunc(input.usage.outputTokens));

-  if (inputTokens === 0 && outputTokens === 0) {
+  const cacheReadTokens = Math.max(0, Math.trunc(input.usage.cacheReadTokens ?? 0));
+  const cacheWriteTokens = Math.max(0, Math.trunc(input.usage.cacheWriteTokens ?? 0));
+  if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
     return;
   }

   const month = new Date(input.occurredAt ?? Date.now()).toISOString().slice(0, 7);
-  const costUsd = calculateTokenCost(
+  const costUsd = calculateTokenUsageCost({
     inputTokens,
     outputTokens,
-    input.inputPricePerMillion,
-    input.outputPricePerMillion,
-  );
+    cacheReadTokens,
+    cacheWriteTokens,
+    inputPricePerMillion: input.inputPricePerMillion,
+    outputPricePerMillion: input.outputPricePerMillion,
+    cacheReadPricePerMillion: input.cacheReadPricePerMillion,
+    cacheWritePricePerMillion: input.cacheWritePricePerMillion,
+  });

   sqliteRun(
     `INSERT INTO usage_records (user_id, month, input_tokens, output_tokens, cost_usd)
diff --git a/services/agent-gateway/src/team/team-usage-records-store.ts b/services/agent-gateway/src/team/team-usage-records-store.ts
index 8b67e97d..152cd685 100644
--- a/services/agent-gateway/src/team/team-usage-records-store.ts
+++ b/services/agent-gateway/src/team/team-usage-records-store.ts
@@ -147,7 +147,13 @@ export function persistTeamUsageRecord(input: TeamUsagePersistInput): void {
   const cacheWriteTokens = Math.max(0, Math.trunc(input.cacheWriteTokens ?? 0));
   const costUsd = Number.isFinite(input.costUsd) ? Math.max(0, input.costUsd as number) : 0;

-  if (inputTokens === 0 && outputTokens === 0 && costUsd === 0) {
+  if (
+    inputTokens === 0 &&
+    outputTokens === 0 &&
+    cacheReadTokens === 0 &&
+    cacheWriteTokens === 0 &&
+    costUsd === 0
+  ) {
     return;
   }

diff --git a/services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts b/services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts
index 1e362f91..eda06f10 100644
--- a/services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts
+++ b/services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts
@@ -117,6 +117,8 @@ export interface RunUpstreamGenerateResult {
   text: string;
   inputTokens: number;
   outputTokens: number;
+  cacheReadTokens: number;
+  cacheWriteTokens: number;
   finishReason: string;
   /** Raw native response — surfaced for callers that need provider metadata. */
   raw: UpstreamGenerateTextResult;
@@ -326,8 +328,10 @@ export function runUpstreamGenerate(

     return {
       text: result.text,
-      inputTokens: result.usage?.inputTokens ?? 0,
+      inputTokens: result.usage?.nonCachedInputTokens ?? result.usage?.inputTokens ?? 0,
       outputTokens: result.usage?.outputTokens ?? 0,
+      cacheReadTokens: result.usage?.cacheReadInputTokens ?? 0,
+      cacheWriteTokens: result.usage?.cacheWriteInputTokens ?? 0,
       finishReason: result.finishReason,
       raw: result,
     } satisfies RunUpstreamGenerateResult;

```

## 未跟踪测试：`packages/agent-core/src/provider/utils.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { calculateTokenUsageCost } from './utils.js';

describe('calculateTokenUsageCost', () => {
  it('按普通输入、输出、缓存读取和缓存写入的各自单价计算费用', () => {
    const cost = calculateTokenUsageCost({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 2_000,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
    });

    expect(cost).toBeCloseTo(0.0192, 8);
  });

  it('缓存价格缺失时按普通输入单价估算，避免把缓存 token 视为免费', () => {
    const cost = calculateTokenUsageCost({
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 0,
      inputPricePerMillion: 2,
    });

    expect(cost).toBeCloseTo(0.02, 8);
  });
});
```

## 未跟踪测试：`services/agent-gateway/src/__tests__/session/usage-records-store.test.ts`

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import { persistMonthlyUsageRecord } from '../../session/usage-records-store.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM usage_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    'u-usage-cost',
    'usage-cost@example.com',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('persistMonthlyUsageRecord', () => {
  it('将缓存读写 token 按模型缓存价格计入月度费用', () => {
    persistMonthlyUsageRecord({
      userId: 'u-usage-cost',
      occurredAt: Date.UTC(2026, 7, 1),
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
      },
    });

    const row = dbModule.sqliteGet<{ cost_usd: number }>(
      'SELECT cost_usd FROM usage_records WHERE user_id = ? AND month = ?',
      ['u-usage-cost', '2026-08'],
    );
    expect(row?.cost_usd).toBeCloseTo(0.0192, 8);
  });

  it('只有缓存 token 时仍写入月度费用', () => {
    persistMonthlyUsageRecord({
      userId: 'u-usage-cost',
      occurredAt: Date.UTC(2026, 7, 1),
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
      },
    });

    const row = dbModule.sqliteGet<{ cost_usd: number }>(
      'SELECT cost_usd FROM usage_records WHERE user_id = ? AND month = ?',
      ['u-usage-cost', '2026-08'],
    );
    expect(row?.cost_usd).toBeCloseTo(0.0087, 8);
  });
});
```
