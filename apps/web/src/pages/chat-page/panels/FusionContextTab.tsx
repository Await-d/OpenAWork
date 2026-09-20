import { ChatOverviewTabContent } from './chat-overview-tab-content.js';
import type {
  ChatOverviewRuntimeSummary,
  ChatOverviewTabContentProps,
} from './chat-overview-tab-content.js';

export type FusionContextOverviewProps = ChatOverviewTabContentProps;

export type FusionContextRuntimeSummary = ChatOverviewRuntimeSummary;

export interface FusionContextTabProps {
  readonly overview: FusionContextOverviewProps;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
}

/**
 * Fusion「会话概览」tab 的 wrapper。
 *
 * 所有权（改动前请先读）：上下文用量 meter 与「压缩会话」入口的唯一 owner 是
 * `ChatOverviewTabContent`（经典右栏与 Fusion 共用同一实现）。这里不得再渲染
 * 用量文案 / usage-card / runtime-summary 指标块——它们曾与概览正文重复表达
 * 同一批 datum（用量、压缩、子会话、待审批、计划任务、流诊断）。
 */
export function FusionContextTab({ overview, runtimeSummary }: FusionContextTabProps) {
  return (
    <div className="fusion-side-panel__scroll">
      <ChatOverviewTabContent {...overview} runtimeSummary={runtimeSummary} />
    </div>
  );
}
