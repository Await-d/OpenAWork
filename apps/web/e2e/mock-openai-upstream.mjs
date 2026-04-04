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
    req.resume();
    req.on('end', () => {
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
