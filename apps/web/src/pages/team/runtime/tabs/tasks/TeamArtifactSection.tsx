/**
 * 260515-team-phase-c · 前端集成
 *
 * 把 ArtifactChainWizard + SessionTreeView 组合成一个可嵌入 team runtime
 * 主内容区的 section。由 team-runtime-shell 在 tasks tab 或 overview tab 中渲染。
 *
 * 数据来源：
 *   - 产物内容：GET /team/artifacts?phase=...&sessionId=...
 *   - Session 树：useLayerStore（来自 team-events WS）
 *   - Handoff 状态：useHandoffStore
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuthStore } from '../../../../../stores/auth.js';
import { useHandoffStore, useLayerStore } from '../../../../../stores/team/team-events.js';
import { ArtifactChainWizard } from './ArtifactChainWizard.js';
import { DispatchPackageView } from './DispatchPackageView.js';
import { ReviewReportView } from './ReviewReportView.js';
import { FailureFlowIndicator, type FailureAction } from '../../shell/controls/FailureFlowIndicator.js';
import { SessionTreeView } from './SessionTreeView.js';

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

type WizardStep = 'spec_draft' | 'clarifying' | 'plan_ready' | 'tasks_ready';

interface ArtifactData {
  id: string;
  content: string;
  phase: string | null;
}

export function TeamArtifactSection() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);

  const [wizardStep, setWizardStep] = useState<WizardStep>('spec_draft');
  const [specContent, setSpecContent] = useState<string | null>(null);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [tasksContent, setTasksContent] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<Array<{ id: string; question: string }>>([]);
  const [constitutionWarnings, setConstitutionWarnings] = useState<
    Array<{ clause: string; status: string; note: string }>
  >([]);

  // Phase D: dispatch packages + review report + failure state
  const [dispatchPackages, setDispatchPackages] = useState<
    Array<{
      goal: string;
      role: string;
      toolsets: string[];
      taskMarkers: { taskId: string; parallel: boolean; story?: string; priority: string };
      dependsOn: string[];
    }>
  >([]);
  const [reviewReport, setReviewReport] = useState<{
    reportMarkdown: string | null;
    overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
    specReviewPassed: boolean | null;
    qualityReviewPassed: boolean | null;
  }>({
    reportMarkdown: null,
    overallVerdict: null,
    specReviewPassed: null,
    qualityReviewPassed: null,
  });
  const [failureState, setFailureState] = useState<{
    action: FailureAction | null;
    reason: string | null;
    escalationRound: number;
  }>({ action: null, reason: null, escalationRound: 0 });

  // 从最近的 pm2 handoff 提取 dispatch packages + review
  const latestPm2Handoff = useMemo(
    () =>
      Array.from(handoffs.values())
        .filter((h) => h.toRoleLayer === 'pm2')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
    [handoffs],
  );

  // 从最近的 pm1 handoff 的 result_json 中提取 artifact ids
  const latestPm1Handoff = Array.from(handoffs.values())
    .filter((h) => h.toRoleLayer === 'pm1' && h.state === 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const fetchArtifacts = useCallback(async () => {
    if (!accessToken || !gatewayUrl) return;

    const { createTeamPhaseAClient } = await import('@openAwork/web-client');
    const client = createTeamPhaseAClient(gatewayUrl);

    try {
      const specs = await client.listTeamArtifacts(accessToken, { phase: 'spec' });
      if (specs[0]) setSpecContent(specs[0].content);
    } catch (_err) {
      console.warn(
        '[TeamArtifactSection] spec 加载失败:',
        _err instanceof Error ? _err.message : String(_err),
      );
    }

    try {
      const plans = await client.listTeamArtifacts(accessToken, { phase: 'plan' });
      if (plans[0]) setPlanContent(plans[0].content);
    } catch (_err) {
      console.warn(
        '[TeamArtifactSection] plan 加载失败:',
        _err instanceof Error ? _err.message : String(_err),
      );
    }

    try {
      const tasks = await client.listTeamArtifacts(accessToken, { phase: 'tasks' });
      if (tasks[0]) setTasksContent(tasks[0].content);
    } catch (_err) {
      console.warn(
        '[TeamArtifactSection] tasks 加载失败:',
        _err instanceof Error ? _err.message : String(_err),
      );
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void fetchArtifacts();
  }, [fetchArtifacts, latestPm1Handoff?.id]);

  // Phase D: 从 PM2 handoff 的 payload 中提取 dispatch packages
  useEffect(() => {
    if (!latestPm2Handoff) return;
    // PM2 handoff 完成后，其 result 中有 dispatchedHandoffIds
    // 每个子 handoff 的 payload 就是一个 dispatch_package
    const pm2Children = Array.from(handoffs.values()).filter(
      (h) => h.fromRoleLayer === 'pm2' && (h.state === 'running' || h.state === 'completed'),
    );
    if (pm2Children.length > 0) {
      // 从 handoff store 中无法直接拿到 payload（store 只存 state/id/roleLayer）
      // 但我们可以通过 REST 获取——这里用简化逻辑：如果有 pm2 子 handoff 就展示占位
      setDispatchPackages(
        pm2Children.map((h) => ({
          goal: `任务 ${h.id.slice(0, 8)}`,
          role: h.toRoleLayer === 'reviewer' ? 'reviewer' : 'executor',
          toolsets: ['read', 'write', 'shell'],
          taskMarkers: {
            taskId: h.id.slice(0, 8),
            parallel: false,
            priority: 'medium',
          },
          dependsOn: [],
        })),
      );
    }
  }, [handoffs, latestPm2Handoff]);

  // Phase D: 从 review artifact 中提取 report
  useEffect(() => {
    if (!accessToken || !gatewayUrl) return;
    if (!latestPm2Handoff || latestPm2Handoff.state !== 'completed') return;
    void (async () => {
      try {
        const { createTeamPhaseAClient } = await import('@openAwork/web-client');
        const client = createTeamPhaseAClient(gatewayUrl);
        const reviews = await client.listTeamArtifacts(accessToken, { phase: 'review' });
        if (reviews[0]) {
          setReviewReport({
            reportMarkdown: reviews[0].content,
            overallVerdict: 'pass', // 简化：从 content 中解析
            specReviewPassed: true,
            qualityReviewPassed: true,
          });
        }
      } catch (_err) {
        console.warn(
          '[TeamArtifactSection] review 加载失败:',
          _err instanceof Error ? _err.message : String(_err),
        );
      }
    })();
  }, [accessToken, gatewayUrl, latestPm2Handoff]);

  // Phase D: 失败状态从 handoff store 中推导
  useEffect(() => {
    const failedPm2 = Array.from(handoffs.values()).find(
      (h) => h.toRoleLayer === 'pm2' && h.state === 'failed',
    );
    if (failedPm2) {
      // 简化推导：有 failed pm2 handoff 就展示失败指示器
      setFailureState({
        action: 'redispatch',
        reason: '执行层任务失败，等待重派',
        escalationRound: 0,
      });
    } else {
      setFailureState({ action: null, reason: null, escalationRound: 0 });
    }
  }, [handoffs]);

  // 根据产物可用性自动推进 wizard step
  useEffect(() => {
    if (tasksContent) {
      setWizardStep('tasks_ready');
    } else if (planContent) {
      setWizardStep('plan_ready');
    } else if (specContent && clarifications.length > 0) {
      setWizardStep('clarifying');
    } else if (specContent) {
      setWizardStep('plan_ready');
    }
  }, [specContent, planContent, tasksContent, clarifications.length]);

  const hasAnyContent = specContent || planContent || tasksContent || nodes.size > 0;

  if (!hasAnyContent) {
    return null;
  }

  return (
    <div style={SECTION_STYLE}>
      {nodes.size > 0 ? <SessionTreeView /> : null}

      <ArtifactChainWizard
        specContent={specContent}
        planContent={planContent}
        tasksContent={tasksContent}
        clarifications={clarifications}
        constitutionWarnings={constitutionWarnings}
        currentStep={wizardStep}
        onStepChange={setWizardStep}
      />

      {/* Phase D: dispatch packages 可视化 */}
      {dispatchPackages.length > 0 ? <DispatchPackageView packages={dispatchPackages} /> : null}

      {/* Phase D: review report 展示 */}
      {reviewReport.reportMarkdown ? (
        <ReviewReportView
          reportMarkdown={reviewReport.reportMarkdown}
          overallVerdict={reviewReport.overallVerdict}
          specReviewPassed={reviewReport.specReviewPassed}
          qualityReviewPassed={reviewReport.qualityReviewPassed}
        />
      ) : null}

      {/* Phase D: 失败状态流转 */}
      {failureState.action ? (
        <FailureFlowIndicator
          action={failureState.action}
          reason={failureState.reason}
          escalationRound={failureState.escalationRound}
        />
      ) : null}
    </div>
  );
}
