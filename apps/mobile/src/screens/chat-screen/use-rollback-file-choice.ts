/**
 * use-rollback-file-choice · 移动端「重新生成 / 重新发送」的文件变更必选交互
 *
 * 产品口径（与 Web 一致）：检测到变更就必须让用户选择，不允许静默放行。
 * 检测信号：
 *   1. 消息携带的回合键（`clientRequestIds`）→ 按 request 精确取快照；
 *   2. 快照缺失/读取失败时，按 request 查文件变更投影作为「存在变更」的证据；
 *   3. **任一信号读取失败**（`detectionIncomplete`）→ 即使没有证据也必须弹窗
 *      （展示「无法确认」），不得把读取失败当成没有变更。
 *
 * 选择语义：
 *   - 取消：什么都不做；
 *   - 保留文件并继续：直接执行原动作（截断 + 重发）；
 *   - 恢复文件后继续：先 `restoreToTree` 恢复受影响文件，再执行原动作；
 *     任一快照 detail 读取失败 → 中止并提示（不执行部分恢复）。
 */

import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { createSessionsClient, createSnapshotTreesClient } from '@openAwork/web-client';
import type { SnapshotTreeEntry } from '@openAwork/web-client';
import type { MobileChatMessage } from '../../chat/chat-message-content';
import {
  buildMobileRollbackAlertMessage,
  buildMobileRollbackChoiceModel,
  collectAffectedRequestIdsFromMessages,
  selectAffectedSnapshots,
  type MobileRollbackChoiceModel,
} from '../../chat/rollback-file-choice';

export interface UseRollbackFileChoiceInput {
  accessToken: string | null;
  gatewayUrl: string;
  messages: readonly MobileChatMessage[];
  sessionId: string;
}

export interface RollbackFileChoiceRunner {
  requestRollbackWithFileChoice: (
    sourceMessageId: string,
    proceed: () => void | Promise<void>,
  ) => Promise<void>;
}

export function useRollbackFileChoice(input: UseRollbackFileChoiceInput): RollbackFileChoiceRunner {
  const { accessToken, gatewayUrl, messages, sessionId } = input;

  const runProceed = useCallback(async (proceed: () => void | Promise<void>) => {
    try {
      await proceed();
    } catch (error) {
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后重试。');
    }
  }, []);

  const restoreAffectedFiles = useCallback(
    async (model: MobileRollbackChoiceModel) => {
      if (!accessToken || !model.restoreTargetTreeHash) {
        throw new Error('缺少可恢复的目标快照。');
      }
      const client = createSnapshotTreesClient(gatewayUrl);
      const detailResults = await Promise.allSettled(
        model.affectedSnapshots.map((snapshot) =>
          client.detail(accessToken, sessionId, snapshot.treeHash),
        ),
      );
      // 与 Web 对齐：任一 detail 失败都意味着文件清单不完整——
      // 不能拿不完整清单做 deleteMissing 恢复，否则会出现「部分回退」且用户被误导。
      if (detailResults.some((result) => result.status === 'rejected')) {
        throw new Error('部分快照的文件列表读取失败，无法保证完整恢复。');
      }

      const filePathSet = new Set<string>();
      for (const result of detailResults) {
        if (result.status === 'fulfilled') {
          for (const file of result.value.files) {
            filePathSet.add(file.filePath);
          }
        }
      }
      if (filePathSet.size === 0) {
        throw new Error('受影响文件列表为空，无法安全恢复。');
      }

      await client.restoreToTree(accessToken, sessionId, {
        treeHash: model.restoreTargetTreeHash,
        mode: 'apply',
        files: [...filePathSet],
        deleteMissing: true,
      });
    },
    [accessToken, gatewayUrl, sessionId],
  );

  const requestRollbackWithFileChoice = useCallback(
    async (sourceMessageId: string, proceed: () => void | Promise<void>) => {
      if (!accessToken || !sessionId) {
        await runProceed(proceed);
        return;
      }

      const requestIds = collectAffectedRequestIdsFromMessages({
        messages,
        sourceMessageId,
      });

      let snapshots: readonly SnapshotTreeEntry[] = [];
      let snapshotListFailed = false;
      try {
        const result = await createSnapshotTreesClient(gatewayUrl).list(accessToken, sessionId);
        snapshots = result.trees;
      } catch {
        snapshotListFailed = true;
      }

      let hasFileChangeEvidence = false;
      let diffLoadFailed = false;
      if (requestIds.length > 0) {
        const sessionsClient = createSessionsClient(gatewayUrl);
        const diffResults = await Promise.allSettled(
          requestIds.map((clientRequestId) =>
            sessionsClient.getRequestFileChanges(accessToken, sessionId, clientRequestId),
          ),
        );
        hasFileChangeEvidence = diffResults.some(
          (result) =>
            result.status === 'fulfilled' && result.value.fileChanges.fileDiffs.length > 0,
        );
        diffLoadFailed = diffResults.some((result) => result.status === 'rejected');
      }

      const affectedSnapshots = selectAffectedSnapshots({
        messages,
        requestIds,
        snapshots,
        sourceMessageId,
      });
      const model = buildMobileRollbackChoiceModel({
        snapshots: affectedSnapshots,
        snapshotListFailed,
        diffLoadFailed,
        hasFileChangeEvidence,
      });

      // 无变更且检测完整才允许静默继续；检测不完整时不得静默放行。
      if (!model.changesDetected && !model.detectionIncomplete) {
        await runProceed(proceed);
        return;
      }

      const canRestore = Boolean(model.restoreTargetTreeHash) && !model.restoreUnavailableReason;
      const buttons: AlertButton[] = [
        { text: '取消', style: 'cancel' },
        {
          text: '保留文件并继续',
          onPress: () => {
            void runProceed(proceed);
          },
        },
      ];
      if (canRestore) {
        buttons.push({
          text: '恢复文件后继续',
          onPress: () => {
            void (async () => {
              try {
                await restoreAffectedFiles(model);
              } catch (error) {
                Alert.alert(
                  '恢复文件失败',
                  error instanceof Error ? error.message : '请稍后重试。',
                );
                return;
              }
              await runProceed(proceed);
            })();
          },
        });
      }

      Alert.alert('此操作将影响已产生的文件变更', buildMobileRollbackAlertMessage(model), buttons);
    },
    [accessToken, gatewayUrl, messages, restoreAffectedFiles, runProceed, sessionId],
  );

  return { requestRollbackWithFileChoice };
}
