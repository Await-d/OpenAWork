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
    const answers = (match[2] ?? '')
      .split(',')
      .map((answer) => answer.trim())
      .filter((answer) => answer.length > 0);
    if (question.length === 0) return null;
    items.push({ answers, question });
  }
  return items.length > 0 ? items : null;
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
