// A stand-in for the model's Messages API, so the whole Ozi path can be watched end to end:
// which model is asked, what instructions and tools go with it, and what the person then hears.
// Every request body is appended to requests.jsonl. The reply is a plain spoken sentence that
// names the account kind the request described, so a wrong identity shows up in the words.
//
// Ruling 92: the API now streams (`stream: true` in the body, as the SDK's `messages.stream`
// sends). The stand-in then answers with server-sent events, the text in several deltas a few
// dozen milliseconds apart, so the app's sentence-by-sentence path is exercised too.
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 9797);
const log = process.argv[3] ?? 'requests.jsonl';
writeFileSync(log, '');

/** The whole text cut into pieces of a few words, as a model's deltas come. */
function deltasOf(text) {
  const words = text.split(' ');
  const pieces = [];
  for (let i = 0; i < words.length; i += 3) {
    pieces.push((i === 0 ? '' : ' ') + words.slice(i, i + 3).join(' '));
  }
  return pieces;
}

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      parsed = { raw: body };
    }
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), url: req.url, body: parsed }) + '\n');
    const userTurn = Array.isArray(parsed.messages) ? parsed.messages[parsed.messages.length - 1] : null;
    const userText = typeof userTurn?.content === 'string' ? userTurn.content : JSON.stringify(userTurn?.content ?? '');
    const isOwnerPrompt = /owner|Mr\. Anthony/i.test(JSON.stringify(parsed.system ?? ''));
    const wantsJson = parsed.output_config?.format?.type === 'json_schema';
    const heardWords = userText.match(/said: "([^"]*)"/)?.[1] ?? '(nothing)';
    const tier = /opus/.test(parsed.model) ? 'the large one' : /sonnet/.test(parsed.model) ? 'the middle one' : 'another one';
    const spoken = isOwnerPrompt
      ? `Stand-in owner answer, ${tier}: you said ${heardWords}. That is the first sentence. And this is the second.`
      : `Stand-in answer, ${tier}: you said ${heardWords}. That is the first sentence. And this is the second.`;
    const text = wantsJson ? JSON.stringify({ kind: 'chatter', items: [], reply: spoken }) : spoken;
    const model = parsed.model ?? 'unknown';

    if (parsed.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      send({
        type: 'message_start',
        message: {
          id: 'msg_fake',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      const pieces = deltasOf(text);
      let i = 0;
      const tick = () => {
        if (i < pieces.length) {
          send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: pieces[i] } });
          i += 1;
          setTimeout(tick, 40);
          return;
        }
        send({ type: 'content_block_stop', index: 0 });
        send({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 },
        });
        send({ type: 'message_stop' });
        res.end();
      };
      tick();
      return;
    }

    const message = {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(message));
  });
}).listen(port, () => console.log(`fake model on ${port}, logging to ${log}`));
