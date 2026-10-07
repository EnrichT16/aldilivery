/**
 * Any Node server (DigitalOcean, a VPS) or a home computer / Mac mini. One program: the admin
 * page and webhooks on a port, the timers every minute, and (if set up) reading a mailbox by IMAP.
 *
 *   npm run build && npm start
 *
 * Settings come from the environment (or a `.env` file loaded with `node --env-file=.env`):
 *   PORT                 default 8787
 *   HELPERS_CONFIG       default ./helpers.config.json
 *   HELPERS_BANNED_WORDS default ./config/banned-words.json
 *   HELPERS_DATA         default ./data/helpers.json (the memory)
 *   IMAP_HOST ...        to read a mailbox; see helpers/inbox/adapters.ts
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { handleEmail } from '../helpers/inbox/inbox.js';
import { ImapPoller, imapFlowClient } from '../helpers/inbox/adapters.js';
import { FileStore } from '../storage/file-store.js';
import { createApp, type App, type ExtraTasks } from './app.js';

const LARGEST_BODY = 5 * 1024 * 1024;

async function toRequest(incoming: IncomingMessage, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += (chunk as Buffer).length;
    if (size > LARGEST_BODY) throw new Error('Request too large.');
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = incoming.method ?? 'GET';
  const url = new URL(
    incoming.url ?? '/',
    `http://${incoming.headers.host ?? `localhost:${port}`}`,
  );
  return new Request(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

async function send(response: Response, outgoing: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

export async function startNodeServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ app: App; stop: () => void }> {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'));
  const port = Number(env.PORT ?? 8787);
  const extra: ExtraTasks = {};
  if (env.IMAP_HOST) {
    extra['read-mailbox'] = {
      cron: env.IMAP_CRON ?? '*/5 * * * *',
      run: async (runtime) => {
        const count = await new ImapPoller(
          () => imapFlowClient(env),
          (email) => handleEmail(runtime, email),
        ).poll();
        return `${count} new email(s) read.`;
      },
    };
  }
  const app = createApp(
    {
      config: readJson(env.HELPERS_CONFIG ?? 'helpers.config.json'),
      bannedWords: readJson(env.HELPERS_BANNED_WORDS ?? 'config/banned-words.json'),
      store: await FileStore.open(resolve(env.HELPERS_DATA ?? 'data/helpers.json')),
      env,
    },
    extra,
  );

  const server = createServer((incoming, outgoing) => {
    toRequest(incoming, port)
      .then((request) => app.fetch(request))
      .then((response) => send(response, outgoing))
      .catch((error: Error) => {
        outgoing.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        outgoing.end(error.message);
      });
  });
  server.listen(port, env.HOST ?? '127.0.0.1');

  // The timers: check once a minute, on the minute.
  let lastMinute = '';
  const timer = setInterval(() => {
    const now = new Date();
    const minute = now.toISOString().slice(0, 16);
    if (minute === lastMinute) return;
    lastMinute = minute;
    app.scheduled(now).then(
      (results) => results.forEach((line) => console.log(`${minute} ${line}`)),
      (error: Error) => console.error(error),
    );
  }, 15_000);

  console.log(`Tofadachi Helpers are running. The admin page is at http://localhost:${port}/admin`);
  return {
    app,
    stop: () => {
      clearInterval(timer);
      server.close();
    },
  };
}

// Started directly (npm start), not imported by a test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void startNodeServer();
}
