export interface LayerArtifactPreview {
  content: string;
  title: string;
}

export interface LayerSummaryPresentation {
  artifactSectionTitle: string;
  dialogueFieldOrder: Array<'recommendedNextStep' | 'recommendedRole' | 'rewrittenIntent' | 'sourceIntent'>;
  dialogueSectionTitle: string;
  dialogueFieldLabels: {
    recommendedNextStep: string;
    recommendedRole: string;
    rewrittenIntent: string;
    sourceIntent: string;
  };
  emptyMessage: string;
  note: string;
  primaryLensDescription: string;
  primaryLensLabel: string;
  sectionOrder: Array<'artifact' | 'dialogue' | 'summary'>;
  summaryCardTitle: string;
  title: string;
}

export interface LayerArtifactSelection {
  artifact: LayerArtifactPreview;
  phase: 'plan' | 'review' | 'spec' | 'tasks';
}

export function getLayerSummaryPresentation(roleLayer: string | null | undefined): LayerSummaryPresentation {
  switch (roleLayer) {
    case 'pm1':
      return {
        artifactSectionTitle: '规划产物链',
        dialogueFieldOrder: ['sourceIntent', 'rewrittenIntent', 'recommendedRole', 'recommendedNextStep'],
        dialogueSectionTitle: '规划讨论线索',
        dialogueFieldLabels: {
          recommendedNextStep: '规划下一步',
          recommendedRole: '规划接手角色',
          rewrittenIntent: '规划入口',
          sourceIntent: '原始需求',
        },
        title: '规划链摘要',
        note: '规划层通常先澄清意图，再沉淀 spec / plan / tasks。这里优先看规划上下文与产物，而不是只看空消息壳。',
        emptyMessage: '当前规划层还没有可展示的 spec / plan / tasks 产物，将仅展示正文或交接上下文。',
        primaryLensDescription: '优先确认需求是否被澄清，并检查规格、计划和任务是否已经连续产出。',
        primaryLensLabel: '规划完整度',
        sectionOrder: ['summary', 'dialogue', 'artifact'],
        summaryCardTitle: '本次规划摘要',
      };
    case 'pm2':
    case 'reviewer':
      return {
        artifactSectionTitle: '评审产物链',
        dialogueFieldOrder: ['recommendedNextStep', 'rewrittenIntent', 'sourceIntent', 'recommendedRole'],
        dialogueSectionTitle: '评审判断线索',
        dialogueFieldLabels: {
          recommendedNextStep: '评审建议',
          recommendedRole: '接手角色',
          rewrittenIntent: '评审焦点',
          sourceIntent: '上游交付',
        },
        title: '评审链摘要',
        note: '管控与评审层更强调 review 结论、风险判断和回退建议。这里优先显示 review / review_report，再回退到计划产物。',
        emptyMessage: '当前评审链还没有可展示的 review / review_report 产物，将仅展示正文或交接上下文。',
        primaryLensDescription: '优先判断是否已经产出评审结论，以及是否具备足够依据支持回退、升级或继续执行。',
        primaryLensLabel: '评审结论',
        sectionOrder: ['summary', 'artifact', 'dialogue'],
        summaryCardTitle: '本次评审摘要',
      };
    case 'executor':
    case 'tester':
      return {
        artifactSectionTitle: '执行产物链',
        dialogueFieldOrder: ['sourceIntent', 'recommendedNextStep', 'rewrittenIntent', 'recommendedRole'],
        dialogueSectionTitle: '执行过程线索',
        dialogueFieldLabels: {
          recommendedNextStep: '当前动作',
          recommendedRole: '执行角色',
          rewrittenIntent: '执行上下文',
          sourceIntent: '执行任务',
        },
        title: '执行链摘要',
        note: '执行层更看重过程、工具调用和错误定位。这里会结合过程时间线、任务上下文和执行产物一起展示。',
        emptyMessage: '当前执行链还没有可展示的产物，将优先展示正文和过程时间线。',
        primaryLensDescription: '优先确认执行过程是否可追踪、工具调用是否完成，以及当前任务是否已经产生可验收输出。',
        primaryLensLabel: '执行过程',
        sectionOrder: ['dialogue', 'summary', 'artifact'],
        summaryCardTitle: '本次执行摘要',
      };
    case 'reception':
      return {
        artifactSectionTitle: '接待层补充信息',
        dialogueFieldOrder: ['sourceIntent', 'rewrittenIntent', 'recommendedRole', 'recommendedNextStep'],
        dialogueSectionTitle: '原始需求线索',
        dialogueFieldLabels: {
          recommendedNextStep: '建议下发',
          recommendedRole: '推荐角色',
          rewrittenIntent: '改写任务',
          sourceIntent: '用户原始需求',
        },
        title: '接待层摘要',
        note: '接待层主要负责接收原始意图、改写任务并决定下发方向，这里优先展示原始需求与改写后的下发内容。',
        emptyMessage: '当前接待层暂无额外产物，将展示原始意图和下发上下文。',
        primaryLensDescription: '优先确认用户原始需求是否被准确改写，并且已经被下发给正确的下游角色。',
        primaryLensLabel: '需求转译',
        sectionOrder: ['dialogue', 'summary', 'artifact'],
        summaryCardTitle: '本次接待摘要',
      };
    default:
      return {
        artifactSectionTitle: '关联产物',
        dialogueFieldOrder: ['sourceIntent', 'rewrittenIntent', 'recommendedRole', 'recommendedNextStep'],
        dialogueSectionTitle: '对话线索',
        dialogueFieldLabels: {
          recommendedNextStep: '下一步建议',
          recommendedRole: '推荐角色',
          rewrittenIntent: '改写意图',
          sourceIntent: '原始意图',
        },
        title: '本层摘要',
        note: '这里优先展示当前层的上下文、摘要与产物，补足消息较少时的可读性。',
        emptyMessage: '当前层级暂无可展示产物，将仅展示正文或交接上下文。',
        primaryLensDescription: '优先查看该层当前留下的上下文与产物，确认它在这次链路中的职责和输出。',
        primaryLensLabel: '当前重点',
        sectionOrder: ['summary', 'dialogue', 'artifact'],
        summaryCardTitle: '当前摘要',
      };
  }
}

export function pickLayerPreferredArtifact(input: {
  planArtifact: LayerArtifactPreview | null;
  reviewArtifact: LayerArtifactPreview | null;
  roleLayer: string | null | undefined;
  specArtifact: LayerArtifactPreview | null;
  tasksArtifact: LayerArtifactPreview | null;
}): { artifact: LayerArtifactPreview | null; phase: 'plan' | 'review' | 'spec' | 'tasks' | null } {
  if (input.roleLayer === 'pm2' || input.roleLayer === 'reviewer') {
    if (input.reviewArtifact) return { artifact: input.reviewArtifact, phase: 'review' };
    if (input.tasksArtifact) return { artifact: input.tasksArtifact, phase: 'tasks' };
    if (input.planArtifact) return { artifact: input.planArtifact, phase: 'plan' };
    if (input.specArtifact) return { artifact: input.specArtifact, phase: 'spec' };
    return { artifact: null, phase: null };
  }

  if (input.tasksArtifact) return { artifact: input.tasksArtifact, phase: 'tasks' };
  if (input.planArtifact) return { artifact: input.planArtifact, phase: 'plan' };
  if (input.specArtifact) return { artifact: input.specArtifact, phase: 'spec' };
  if (input.reviewArtifact) return { artifact: input.reviewArtifact, phase: 'review' };
  return { artifact: null, phase: null };
}

export function pickLayerArtifactSequence(input: {
  planArtifact: LayerArtifactPreview | null;
  reviewArtifact: LayerArtifactPreview | null;
  roleLayer: string | null | undefined;
  specArtifact: LayerArtifactPreview | null;
  tasksArtifact: LayerArtifactPreview | null;
}): LayerArtifactSelection[] {
  const sequence: LayerArtifactSelection[] = [];

  const pushIfPresent = (
    artifact: LayerArtifactPreview | null,
    phase: LayerArtifactSelection['phase'],
  ) => {
    if (artifact) {
      sequence.push({ artifact, phase });
    }
  };

  switch (input.roleLayer) {
    case 'pm1':
      pushIfPresent(input.specArtifact, 'spec');
      pushIfPresent(input.planArtifact, 'plan');
      pushIfPresent(input.tasksArtifact, 'tasks');
      pushIfPresent(input.reviewArtifact, 'review');
      return sequence;
    case 'pm2':
    case 'reviewer':
      pushIfPresent(input.reviewArtifact, 'review');
      pushIfPresent(input.tasksArtifact, 'tasks');
      pushIfPresent(input.planArtifact, 'plan');
      pushIfPresent(input.specArtifact, 'spec');
      return sequence;
    default:
      pushIfPresent(input.tasksArtifact, 'tasks');
      pushIfPresent(input.planArtifact, 'plan');
      pushIfPresent(input.specArtifact, 'spec');
      pushIfPresent(input.reviewArtifact, 'review');
      return sequence;
  }
}
