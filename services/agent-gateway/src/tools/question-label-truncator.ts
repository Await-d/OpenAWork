/**
 * Question Label Truncator
 *
 * Ported from oh-my-opencode's question-label-truncator hook.
 * Truncates overly long option labels in ask_user_question tool calls
 * to prevent UI overflow issues.
 *
 * In oh-my-opencode this was a tool.execute.before hook.
 * In OpenAWork it's applied before tool execution in the sandbox.
 */

const MAX_LABEL_LENGTH = 30;

/**
 * Truncate a single label if it exceeds max length.
 */
export function truncateLabel(label: string, maxLength: number = MAX_LABEL_LENGTH): string {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength - 3) + '...';
}

/**
 * Truncate question labels in ask_user_question tool arguments.
 * Modifies the args object in place.
 */
export function truncateQuestionLabels(args: Record<string, unknown>): Record<string, unknown> {
  const questions = args.questions;
  if (!Array.isArray(questions)) return args;

  return {
    ...args,
    questions: questions.map((question: Record<string, unknown>) => ({
      ...question,
      options: Array.isArray(question.options)
        ? question.options.map((option: Record<string, unknown>) => ({
            ...option,
            label: typeof option.label === 'string' ? truncateLabel(option.label) : option.label,
          }))
        : [],
    })),
  };
}
