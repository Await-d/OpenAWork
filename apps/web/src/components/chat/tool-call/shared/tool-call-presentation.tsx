import { resolveToolStatusMeta, type resolveToolVisualStatus } from '@openAwork/shared-ui';
import {
  naturalLanguageSummary,
  type NaturalLanguageSummaryOptions,
} from './natural-language-summary.js';

type VisualStatus = ReturnType<typeof resolveToolVisualStatus>;

export function toolDisplayName(toolName: string): string {
  const name = toolName.trim();
  return !name || name.toLowerCase() === 'tool' ? '工具调用' : name;
}

/** 仅转换生成摘要开头的已知动作，不改写路径、工具名或输出中的「已/了」。 */
export function toolCallSummary(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  status: VisualStatus,
  options: NaturalLanguageSummaryOptions = {},
): string {
  if (toolDisplayName(toolName) === '工具调用') return '工具调用';
  const summary = naturalLanguageSummary(toolName, input, output, {
    ...options,
    skillStatus: status,
  });
  if (status === 'completed' || toolName.trim().toLowerCase() === 'skill') return summary;
  return summary.replace(
    /^(?:已)?(查看|列举|搜索|执行|读取|创建|编辑|应用|还原|运行|取消|抓取|发送|回复|提醒|更新|删除|调用|进入|退出|获取|重命名|移动|同步|克隆|概览|并行执行|检测|向用户提问|重置|添加|移除|启用|停用|安装|卸载|重新加载|索引|查找|分析|查询)了?/,
    '$1',
  );
}

const STATUS_LABELS: Record<VisualStatus, string> = {
  running: '执行中…',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  paused: '已暂停',
  pending: '待执行',
  idle: '未开始',
};

export function ToolCallStatus({ status, toolName }: { status: VisualStatus; toolName: string }) {
  return (
    <span className="tool-call-status-label" data-status={status}>
      {status === 'paused' ? resolveToolStatusMeta(status, toolName).label : STATUS_LABELS[status]}
    </span>
  );
}
