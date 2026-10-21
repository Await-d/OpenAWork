/**
 * The `question` / `askUserQuestion` tools return their answered result as a
 * flat string: `question text="answer a, answer b"` per line. Rendering that
 * verbatim reads like a log line, so we split it back into question → answers
 * rows.
 */
export interface QuestionAnswerItem {
  answers: string[];
  question: string;
}

const ANSWER_LINE_RE = /^(.+?)="(.*)"$/;

function unwrapText(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const candidate = (output as Record<string, unknown>)['output'];
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

export function extractQuestionAnswers(output: unknown): QuestionAnswerItem[] | null {
  const text = unwrapText(output);
  if (!text) return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const items: QuestionAnswerItem[] = [];
  for (const line of lines) {
    const match = line.match(ANSWER_LINE_RE);
    if (!match) return null;
    const question = (match[1] ?? '').trim();
    const answers = splitAnswers(match[2] ?? '');
    if (question.length === 0) return null;
    items.push({ answers, question });
  }
  return items.length > 0 ? items : null;
}

/**
 * 把 `question="answer a, answer b"` 里的答案串还原成条目数组。
 *
 * 工具结果是**扁平字符串**，多选答案用逗号拼接，所以只能按逗号切分——但选项文本
 * 本身可能带逗号（例如「北京, 上海」这类地名、含参数的命令行选项），一刀切会把一个
 * 选项拆成多个碎片，界面上表现为「选了一项却显示成两三项」。
 *
 * 这里用两级切分：
 *   1. 优先按 `, `（逗号 + 空格）切——网关拼接多选时用的正是这个分隔符；
 *   2. 若整串里没有 `, `，再退回按裸 `,` 切，兼容单值里不含空格的旧格式。
 *
 * 不做更激进的「按已知选项反查」：提取函数只知道输出字符串，拿不到题目选项表；
 * 客户端侧无从判断 `a,b` 究竟是一个选项还是两个，猜错会把合法答案并成一个。
 */
function splitAnswers(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const separator = trimmed.includes(', ') ? ', ' : ',';
  return trimmed
    .split(separator)
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);
}

export function QuestionAnswerPreview({ items }: { items: QuestionAnswerItem[] }) {
  return (
    <div className="question-answers">
      {items.map((item, index) => (
        <div className="question-answer-item" key={`${item.question}-${index}`}>
          <div className="question-answer-q">{item.question}</div>
          {item.answers.length > 0 ? (
            <div className="question-answer-values">
              {item.answers.map((answer) => (
                <span className="question-answer-chip" key={answer}>
                  {answer}
                </span>
              ))}
            </div>
          ) : (
            <div className="question-answer-empty">（未作答）</div>
          )}
        </div>
      ))}
    </div>
  );
}
