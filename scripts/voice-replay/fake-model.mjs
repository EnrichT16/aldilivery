// A stand-in for the model's Messages API, so the whole Ozi path can be watched end to end:
// which model is asked, what instructions and tools go with it, and what the person then hears.
// Every request body is appended to requests.jsonl. The reply is a plain spoken sentence that
// names the account kind the request described, so a wrong identity shows up in the words.
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 9797);
const log = process.argv[3] ?? 'requests.jsonl';
writeFileSync(log, '');

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
      ? `Stand-in owner answer, ${tier}: you said ${heardWords}.`
      : `Stand-in answer, ${tier}: you said ${heardWords}.`;
    const text = wantsJson ? JSON.stringify({ kind: 'chatter', items: [], reply: spoken }) : spoken;
    const message = {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: parsed.model ?? 'unknown',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(message));
  });
}).listen(port, () => console.log(`fake model on ${port}, logging to ${log}`));
