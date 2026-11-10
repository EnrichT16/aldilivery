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

    // Ruling 99: the conversation has tools. The stand-in plays a short, real exchange with
    // them, so the whole path is watched: a look in the shop, something put in the basket, the
    // checkout handed over. What it "says" still names the tier and whose instructions it had.
    const toolNames = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t.name) : [];
    const lastContent = userTurn?.content;
    const toolResults = Array.isArray(lastContent)
      ? lastContent.filter((block) => block?.type === 'tool_result')
      : [];
    const theySaid = (typeof lastContent === 'string' ? lastContent : '').split('[They said]')[1]?.trim() ?? '';
    let plan = null; // { say, uses: [{name, input}] }
    if (toolNames.includes('search_shop')) {
      const resultText = toolResults.map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join(' ');
      if (toolResults.length > 0 && /"products"/.test(resultText)) {
        const found = JSON.parse(resultText.slice(resultText.indexOf('{')));
        const first = found.products?.[0];
        plan = first
          ? { say: '', uses: [{ name: 'add_to_basket', input: { items: [{ product_id: first.id, quantity: 2 }] } }] }
          : { say: 'I could not find that in the shop.', uses: [] };
      } else if (toolResults.length > 0 && /"added"/.test(resultText)) {
        const done = JSON.parse(resultText.slice(resultText.indexOf('{')));
        plan = { say: `I have put ${done.added?.[0]?.quantity} of ${done.added?.[0]?.name} in your basket. Would you like anything else?`, uses: [] };
      } else if (toolResults.length > 0) {
        plan = { say: /"ok":false/.test(resultText) ? 'You will need an account before I can send that.' : 'Right, let me read that back to you.', uses: [] };
      } else if (/\b(send|place|checkout|that's all|that is all)\b/i.test(theySaid)) {
        plan = { say: '', uses: [{ name: 'start_checkout', input: {} }] };
      } else if (/\b(milk|bread|beans|banana)/i.test(theySaid)) {
        const thing = /milk|bread|beans|banana/i.exec(theySaid)[0].toLowerCase();
        plan = { say: 'Let me have a look.', uses: [{ name: 'search_shop', input: { query: thing } }] };
      } else if (/basket/i.test(theySaid) && /open|show|go to/i.test(theySaid)) {
        plan = { say: 'Here is your basket.', uses: [{ name: 'open_page', input: { page: 'basket' } }] };
      }
    }
    if (toolNames.includes('open_page') && !plan) {
      plan = { say: `Stand-in conversation, ${tier}, tools ${toolNames.length}: you said ${theySaid || heardWords}. That is the first sentence. And this is the second.`, uses: [] };
    }
    if (plan) {
      const content = [];
      if (plan.say) content.push({ type: 'text', text: plan.say });
      plan.uses.forEach((use, n) => content.push({ type: 'tool_use', id: `toolu_fake_${Date.now()}_${n}`, name: use.name, input: use.input }));
      const stop = plan.uses.length > 0 ? 'tool_use' : 'end_turn';
      if (parsed.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const send = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        send({ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
        content.forEach((block, index) => {
          if (block.type === 'text') {
            send({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
            for (const piece of deltasOf(block.text)) send({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
          } else {
            send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
            send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
          }
          send({ type: 'content_block_stop', index });
        });
        send({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
        send({ type: 'message_stop' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
      return;
    }

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
