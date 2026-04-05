import { createServer } from 'node:http';

const port = Number(process.env.UPSTREAM_PORT ?? '3312');

function writeResponsesEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeResponsesStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const timers = [
    setTimeout(() => {
      writeResponsesEvent(res, 'response.output_text.delta', {
        output_index: 0,
        content_index: 0,
        item_id: 'msg_attach_live',
        delta: '实时续流第一段',
      });
    }, 250),
    setTimeout(() => {
      writeResponsesEvent(res, 'response.output_text.delta', {
        output_index: 0,
        content_index: 0,
        item_id: 'msg_attach_live',
        delta: '实时续流第二段',
      });
    }, 6000),
    setTimeout(() => {
      writeResponsesEvent(res, 'response.completed', {
        response: {
          output: [{ id: 'msg_attach_live', type: 'message' }],
          usage: { input_tokens: 5, output_tokens: 6, total_tokens: 11 },
        },
      });
      res.end();
    }, 6200),
  ];

  res.on('close', () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  });
}

function writeChatCompletionsStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const timers = [
    setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '实时续流第一段' } }] })}\n\n`,
      );
    }, 250),
    setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '实时续流第二段' } }] })}\n\n`,
      );
    }, 6000),
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 6200),
  ];

  res.on('close', () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  });
}

function createChatToolCallStream(res, { argsJson, toolCallId, toolName }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                function: {
                  name: toolName,
                  arguments: argsJson,
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function writePermissionResumeChatStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const timers = [
    setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '审批恢复后继续执行' } }] })}\n\n`,
      );
    }, 250),
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 500),
  ];

  res.on('close', () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  });
}

function writeQuestionResumeChatStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const timers = [
    setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '回答恢复后继续执行' } }] })}\n\n`,
      );
    }, 250),
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 500),
  ];

  res.on('close', () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  });
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function hasToolResultMessage(body) {
  const parsed = parseJsonBody(body);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  return messages.some(
    (message) =>
      message &&
      typeof message === 'object' &&
      message.role === 'tool' &&
      typeof message.tool_call_id === 'string',
  );
}

function readLastUserMessage(body) {
  const parsed = parseJsonBody(body);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || message.role !== 'user') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((item) =>
          item && typeof item === 'object' && typeof item.text === 'string' ? item.text : '',
        )
        .join('');
    }
  }
  return '';
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/responses') {
    req.resume();
    req.on('end', () => {
      writeResponsesStream(res);
    });
    return;
  }

  if (req.url === '/chat/completions') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const lastUserMessage = readLastUserMessage(body);
      if (hasToolResultMessage(body)) {
        if (lastUserMessage.includes('真实 gateway 提问暂停恢复验证')) {
          writeQuestionResumeChatStream(res);
          return;
        }
        writePermissionResumeChatStream(res);
        return;
      }

      if (
        lastUserMessage.includes('真实 gateway 权限暂停恢复验证') ||
        lastUserMessage.includes('真实 gateway 权限拒绝验证')
      ) {
        createChatToolCallStream(res, {
          argsJson: JSON.stringify({ command: 'pwd' }),
          toolCallId: 'call_bash_permission_1',
          toolName: 'bash',
        });
        return;
      }

      if (
        lastUserMessage.includes('真实 gateway 提问暂停恢复验证') ||
        lastUserMessage.includes('真实 gateway 提问关闭验证')
      ) {
        createChatToolCallStream(res, {
          argsJson: JSON.stringify({
            questions: [
              {
                question: '请选择要查看的目录',
                header: '目录',
                options: [{ label: 'workspace', description: '查看工作目录' }],
              },
            ],
          }),
          toolCallId: 'call_question_1',
          toolName: 'question',
        });
        return;
      }

      writeChatCompletionsStream(res);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock-openai-upstream listening on http://127.0.0.1:${port}\n`);
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
