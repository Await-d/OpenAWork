import {
  listSystemBuiltinCommandDescriptors,
  type SystemBuiltinCommandId,
} from '@openAwork/resources/node';
import type {
  CommandAction,
  CommandDescriptor,
  CommandExecutionMode,
  CommandSurface,
} from '@openAwork/shared';

interface RuntimeCommandBinding {
  readonly action: CommandAction;
  readonly fallback: {
    readonly id: SystemBuiltinCommandId;
    readonly label: string;
    readonly description?: string;
    readonly contexts: readonly CommandSurface[];
    readonly execution: CommandExecutionMode;
    readonly shortcut?: string;
  };
}

const RUNTIME_COMMAND_BINDINGS: Readonly<Record<SystemBuiltinCommandId, RuntimeCommandBinding>> = {
  'slash-compact': {
    action: { kind: 'compact_session' },
    fallback: {
      id: 'slash-compact',
      label: '/compact',
      description: '压缩当前会话上下文（别名：/summarize）',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-summarize': {
    action: { kind: 'compact_session' },
    fallback: {
      id: 'slash-summarize',
      label: '/summarize',
      description: '压缩当前会话——/compact 的别名',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-handoff': {
    action: { kind: 'generate_handoff' },
    fallback: {
      id: 'slash-handoff',
      label: '/handoff',
      description: '生成可续跑的结构化交接摘要',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-buddy': {
    action: { kind: 'open_companion_panel' },
    fallback: {
      id: 'slash-buddy',
      label: '/buddy',
      description: '打开 Buddy 伴侣面板并显式唤起陪跑模式',
      contexts: ['composer'],
      execution: 'client',
    },
  },
  'nav-chat': {
    action: { kind: 'navigate', to: '/chat' },
    fallback: {
      id: 'nav-chat',
      label: '新建对话',
      description: '前往 Chat 页面',
      shortcut: 'C',
      contexts: ['palette'],
      execution: 'client',
    },
  },
  'nav-sessions': {
    action: { kind: 'navigate', to: '/sessions' },
    fallback: {
      id: 'nav-sessions',
      label: '会话列表',
      description: '查看所有会话',
      shortcut: 'S',
      contexts: ['palette'],
      execution: 'client',
    },
  },
  'nav-settings': {
    action: { kind: 'navigate', to: '/settings' },
    fallback: {
      id: 'nav-settings',
      label: '设置',
      shortcut: ',',
      contexts: ['palette'],
      execution: 'client',
    },
  },
  'toggle-theme': {
    action: { kind: 'toggle_theme' },
    fallback: {
      id: 'toggle-theme',
      label: '切换主题',
      description: '切换当前主题',
      contexts: ['palette'],
      execution: 'client',
    },
  },
  'slash-init-deep': {
    action: { kind: 'init_deep' },
    fallback: {
      id: 'slash-init-deep',
      label: '/init-deep',
      description: '递归汇总已有 AGENTS.md 到当前会话',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-ralph-loop': {
    action: { kind: 'start_ralph_loop' },
    fallback: {
      id: 'slash-ralph-loop',
      label: '/ralph-loop',
      description: '启动 Ralph Loop 自引用持续开发循环（默认上限 100 轮）',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-ulw-loop': {
    action: { kind: 'start_ulw_loop' },
    fallback: {
      id: 'slash-ulw-loop',
      label: '/ulw-loop',
      description: '启动需要验证收尾的 UltraWork 循环',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-ulw-verify': {
    action: { kind: 'verify_ulw_loop' },
    fallback: {
      id: 'slash-ulw-verify',
      label: '/ulw-verify',
      description: '用 --pass / --fail 提交 ULW 验证结果',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-cancel-ralph': {
    action: { kind: 'cancel_ralph_loop' },
    fallback: {
      id: 'slash-cancel-ralph',
      label: '/cancel-ralph',
      description: '取消当前活动中的 Ralph / ULW 循环',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-stop-continuation': {
    action: { kind: 'stop_continuation' },
    fallback: {
      id: 'slash-stop-continuation',
      label: '/stop-continuation',
      description: '停止当前 continuation / loop 状态',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-refactor': {
    action: { kind: 'refactor_session' },
    fallback: {
      id: 'slash-refactor',
      label: '/refactor',
      description: '启动带任务追踪与验证预期的重构流程',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-remove-deadcode': {
    action: { kind: 'remove_deadcode' },
    fallback: {
      id: 'slash-remove-deadcode',
      label: '/remove-deadcode',
      description: '用 LSP/AST 证据驱动的多阶段死代码清理流程',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-start-work': {
    action: { kind: 'start_work' },
    fallback: {
      id: 'slash-start-work',
      label: '/start-work',
      description: '从计划或任务状态恢复执行',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-start-work-done': {
    action: { kind: 'submit_start_work_done_claim' },
    fallback: {
      id: 'slash-start-work-done',
      label: '/start-work-done',
      description: '提交 start-work 子任务完成声明，等待 reviewer 确认',
      contexts: ['composer'],
      execution: 'server',
    },
  },
  'slash-start-work-review': {
    action: { kind: 'review_start_work_done_claim' },
    fallback: {
      id: 'slash-start-work-review',
      label: '/start-work-review',
      description: '提交 start-work reviewer verdict 并解除或保持完成门禁',
      contexts: ['composer'],
      execution: 'server',
    },
  },
};

export function buildCommandDescriptors(): CommandDescriptor[] {
  const metadataById = new Map(
    listSystemBuiltinCommandDescriptors().map((command) => [command.id, command]),
  );
  return Object.values(RUNTIME_COMMAND_BINDINGS).map((binding) => {
    const metadata = metadataById.get(binding.fallback.id);
    return {
      id: metadata?.id ?? binding.fallback.id,
      label: metadata?.title ?? binding.fallback.label,
      description: metadata?.description ?? binding.fallback.description,
      contexts: metadata
        ? metadata.contexts.map(readCommandSurface)
        : [...binding.fallback.contexts],
      execution: metadata?.execution ?? binding.fallback.execution,
      ...(binding.fallback.shortcut ? { shortcut: binding.fallback.shortcut } : {}),
      action: binding.action,
    };
  });
}

function readCommandSurface(value: string): CommandSurface {
  if (value === 'composer' || value === 'palette') {
    return value;
  }
  throw new Error(`Unknown command surface: ${value}`);
}
