/**
 * Artifact Phase 图标组件
 *
 * 为知识图谱中的不同产物类型（phase）提供专属 SVG 图标。
 * 设计原则：20x20 viewBox，1.7 strokeWidth，线性风格，与 TeamTabIcon 保持一致。
 */

import type { ReactNode } from 'react';

export type ArtifactPhase =
  | 'spec'
  | 'plan'
  | 'tasks'
  | 'implementation'
  | 'patch'
  | 'review'
  | 'review_report';

interface ArtifactPhaseIconProps {
  readonly phase: ArtifactPhase;
  readonly size?: number;
}

function assertNever(value: never): never {
  throw new Error(`未处理的 Artifact phase 图标: ${value}`);
}

function renderPhasePath(phase: ArtifactPhase): ReactNode {
  switch (phase) {
    case 'spec':
      // 规格：文档 + 标尺线（表示精确规范）
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M7 7h6" />
          <path d="M7 10h6" />
          <path d="M7 13h4" />
          <path d="M12 13h1" />
        </>
      );

    case 'plan':
      // 计划：日历 + 检查点（表示时间规划）
      return (
        <>
          <rect x="4" y="5" width="12" height="11" rx="1" />
          <path d="M4 9h12" />
          <path d="M7 5V3" />
          <path d="M13 5V3" />
          <circle cx="7" cy="12" r="0.5" fill="currentColor" />
          <circle cx="10" cy="12" r="0.5" fill="currentColor" />
          <circle cx="13" cy="12" r="0.5" fill="currentColor" />
        </>
      );

    case 'tasks':
      // 任务：检查列表（方块 + 对勾）
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M7 7l1.5 1.5 2.5-2.5" />
          <path d="M7 11l1.5 1.5 2.5-2.5" />
          <path d="M7 15h4" />
        </>
      );

    case 'implementation':
      // 实现：代码符号（< / >）
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M7 10l-1.5 0" />
          <path d="M8 8l-2 2 2 2" />
          <path d="M12 8l2 2-2 2" />
          <path d="M10.5 7l-1 6" />
        </>
      );

    case 'patch':
      // 补丁：文档 + 创可贴/补丁标记
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M8 8h4v4H8z" />
          <path d="M10 8v4" />
          <path d="M8 10h4" />
        </>
      );

    case 'review':
      // 评审：放大镜 + 对勾（表示检查）
      return (
        <>
          <circle cx="9" cy="9" r="5" />
          <path d="M13 13l3 3" />
          <path d="M7 9l1.5 1.5L11 8" />
        </>
      );

    case 'review_report':
      // 评审报告：文档 + 评分星标
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M7 7h6" />
          <path d="M7 10h6" />
          <path d="M10 12l1 2 2-0.5-1-1.5 1-1.5-2-0.5-1 2Z" />
        </>
      );

    default:
      return assertNever(phase);
  }
}

/**
 * Artifact Phase 图标组件
 *
 * @example
 * <ArtifactPhaseIcon phase="spec" size={16} />
 */
export function ArtifactPhaseIcon({ phase, size = 14 }: ArtifactPhaseIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {renderPhasePath(phase)}
    </svg>
  );
}

/**
 * 返回 phase 的 SVG path 字符串（用于 Canvas 绘制）
 */
export function getArtifactPhasePathData(phase: ArtifactPhase): string[] {
  switch (phase) {
    case 'spec':
      return [
        'M5 4h10v12H5z',
        'M7 7h6',
        'M7 10h6',
        'M7 13h4',
        'M12 13h1',
      ];

    case 'plan':
      return [
        'M4 5h12v11H4z',
        'M4 9h12',
        'M7 5V3',
        'M13 5V3',
      ];

    case 'tasks':
      return [
        'M5 4h10v12H5z',
        'M7 7l1.5 1.5 2.5-2.5',
        'M7 11l1.5 1.5 2.5-2.5',
        'M7 15h4',
      ];

    case 'implementation':
      return [
        'M5 4h10v12H5z',
        'M8 8l-2 2 2 2',
        'M12 8l2 2-2 2',
        'M10.5 7l-1 6',
      ];

    case 'patch':
      return [
        'M5 4h10v12H5z',
        'M8 8h4v4H8z',
        'M10 8v4',
        'M8 10h4',
      ];

    case 'review':
      return [
        'M9 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
        'M13 13l3 3',
        'M7 9l1.5 1.5L11 8',
      ];

    case 'review_report':
      return [
        'M5 4h10v12H5z',
        'M7 7h6',
        'M7 10h6',
        'M10 12l1 2 2-0.5-1-1.5 1-1.5-2-0.5-1 2z',
      ];

    default:
      return assertNever(phase);
  }
}

/**
 * phase 的中文名称映射
 */
export const ARTIFACT_PHASE_LABELS: Record<ArtifactPhase, string> = {
  spec: '规格',
  plan: '计划',
  tasks: '任务',
  implementation: '实现',
  patch: '补丁',
  review: '评审',
  review_report: '评审报告',
};
