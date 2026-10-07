/**
 * The web side of the helpers, the same on every platform:
 *
 *   GET  /admin                     the admin page (teach, review, approve, log)
 *   GET  /health                    "ok", for the Watchman to watch the helpers themselves
 *   POST /hooks/email               incoming email from an email service (needs the webhook secret)
 *   POST /api/ask/<helper>          a website's help box asks a question (public, limited)
 *   /api/...                        everything the admin page does (needs the admin key)
 */
import { TeachingRefused } from '../core/helper.js';
import type { Runtime } from '../core/runtime.js';
import type { KnowledgeEntry } from '../core/types.js';
import { fromWebhook } from '../helpers/inbox/adapters.js';
import { handleEmail, sendReply } from '../helpers/inbox/inbox.js';
import { PLANNED_HELPERS } from '../helpers/planned/index.js';
import { asString, json, problem, readBody, sameSecret, text } from './http.js';
import { adminPage } from './page.js';

/** Timed and on-demand work, by name. Filled in by `app.ts`. */
export type Tasks = Record<string, () => Promise<string>>;

/** Kinds of message each type of helper can send, for the "act alone" switches. */
export const MESSAGE_KINDS: Record<string, Array<{ kind: string; label: string }>> = {
  inbox: [
    { kind: 'taught-reply', label: 'Replies using an answer you approved before' },
    { kind: 'drafted-reply', label: 'Replies its brain wrote' },
    { kind: 'complaint-reply', label: 'Replies to complaints' },
    { kind: 'urgent-reply', label: 'Replies to urgent emails' },
  ],
  watchman: [],
  briefing: [],
  website: [{ kind: 'website-answer', label: 'Website help box answers you approved before' }],
};

function corsHeaders(runtime: Runtime, request: Request): Record<string, string> | null {
  // Only the websites listed in the configuration may use the help box.
  const origin = request.headers.get('origin');
  if (!origin || !(runtime.config.allowedOrigins ?? []).includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

export function createHandler(
  runtime: Runtime,
  tasks: Tasks = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      if (path === '/' && method === 'GET')
        return Response.redirect(new URL('/admin', url).toString(), 302);
      if (path === '/admin' && method === 'GET') {
        return new Response(adminPage(), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy':
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
          },
        });
      }
      if (path === '/health' && method === 'GET')
        return json({ ok: true, helpers: runtime.all().length });

      // Incoming email from an email service.
      if (path === '/hooks/email' && method === 'POST') {
        const expected = runtime.env.INBOX_WEBHOOK_SECRET;
        if (!expected)
          return problem('Incoming email is switched off: INBOX_WEBHOOK_SECRET is not set.', 503);
        const given = request.headers.get('x-helpers-secret') ?? url.searchParams.get('secret');
        if (!sameSecret(given, expected)) return problem('Wrong or missing webhook secret.', 401);
        const email = fromWebhook(await readBody(request));
        if (!email.from) return problem('The email has no sender.');
        const result = await handleEmail(runtime, email);
        return json({
          ok: true,
          action: result.action,
          category: result.category,
          urgent: result.urgent,
        });
      }

      // A website's help box. Public, so it says little and keeps only clean questions.
      const ask = /^\/api\/ask\/([a-z0-9-]+)$/.exec(path);
      if (ask) {
        const cors = corsHeaders(runtime, request);
        if (cors === null) return problem('This website may not use the help box.', 403);
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method !== 'POST') return problem('Use POST.', 405);
        const helper = runtime.helper(ask[1]!);
        if (!helper || !helper.can('answer-website'))
          return json({ ok: false, message: 'Not available.' }, 404, cors);
        const question = (asString((await readBody(request)).question) ?? '').slice(0, 500).trim();
        if (question.split(/\s+/).length < 2) {
          return json({ ok: false, message: 'Please ask a whole question.' }, 400, cors);
        }
        const answer = await helper.answer(question, 'chat');
        if (answer.source === 'refused')
          return json({ ok: true, answer: null, message: "Let's keep it kind." }, 200, cors);
        const taught = answer.source === 'exact' || answer.source === 'keyword';
        if (taught && (await helper.mayActAlone('website-answer'))) {
          await helper.log(
            'website.answered',
            `${helper.name} answered a website question from what it was taught: "${answer.entry?.question ?? ''}".`,
          );
          return json({ ok: true, answer: answer.text }, 200, cors);
        }
        if (answer.cleaned && answer.removed.length === 0) {
          await helper.askForReview({
            kind: 'question',
            messageKind: 'website-answer',
            question: answer.cleaned,
            suggestedAnswer: answer.text,
            suggestedBy: answer.text ? (taught ? 'taught' : 'brain') : null,
          });
        }
        return json(
          {
            ok: true,
            answer: null,
            message: 'Thank you. A person will look at your question soon.',
          },
          200,
          cors,
        );
      }

      // Everything else needs the admin key.
      if (!path.startsWith('/api/')) return problem('Not found.', 404);
      const key = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!runtime.env.ADMIN_TOKEN)
        return problem('The admin page is switched off: ADMIN_TOKEN is not set.', 503);
      if (!sameSecret(key, runtime.env.ADMIN_TOKEN))
        return problem('Wrong or missing admin key.', 401);
      const body = method === 'GET' ? {} : await readBody(request);
      const by = (asString(body.by) ?? request.headers.get('x-person') ?? runtime.ownerName).slice(
        0,
        60,
      );

      if (path === '/api/overview' && method === 'GET') {
        const helpers = await Promise.all(
          runtime.all().map(async (helper) => ({
            id: helper.id,
            name: helper.name,
            type: helper.config.type,
            business: helper.business.name,
            brain: helper.brain.description,
            permissions: helper.config.permissions,
            voice: helper.config.voice ?? null,
            waiting: (await helper.waiting()).length,
            knows: (await helper.knowledge()).length,
            actAlone: (await helper.settings()).actAlone,
            messageKinds: [
              ...(MESSAGE_KINDS[helper.config.type] ?? []),
              ...(helper.can('answer-website') ? (MESSAGE_KINDS.website ?? []) : []),
            ],
          })),
        );
        return json({
          ok: true,
          owner: runtime.ownerName,
          emailSender: runtime.email.description,
          textSender: runtime.sms.description,
          helpers,
          planned: PLANNED_HELPERS,
          tasks: Object.keys(tasks),
        });
      }

      if (path === '/api/log' && method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 500);
        return json({ ok: true, log: await runtime.records.recentLog(limit) });
      }

      const run = /^\/api\/run\/([a-z-]+)$/.exec(path);
      if (run && method === 'POST') {
        const task = tasks[run[1]!];
        if (!task) return problem('There is no task with that name.', 404);
        return json({ ok: true, result: await task() });
      }

      if (path === '/api/briefing/latest' && method === 'GET') {
        const latest = await runtime.records.state<{ text: string; at: string }>('briefing/latest');
        if (!latest) return problem('There is no briefing yet.', 404);
        return url.searchParams.get('format') === 'text'
          ? text(latest.text)
          : json({ ok: true, ...latest });
      }

      if (path === '/api/outbox' && method === 'GET') {
        const items = (await Promise.all(runtime.all().map((helper) => helper.reviews())))
          .flat()
          .filter(
            (item) =>
              item.status === 'approved' &&
              item.email &&
              /outbox|person needs to send/i.test(item.outcome ?? ''),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return json({ ok: true, outbox: items });
      }

      const helperRoute = /^\/api\/helpers\/([a-z0-9-]+)(\/.*)?$/.exec(path);
      if (helperRoute) {
        const helper = runtime.helper(helperRoute[1]!);
        if (!helper) return problem('There is no helper with that name.', 404);
        const rest = helperRoute[2] ?? '';

        if (rest === '/knowledge' && method === 'GET') {
          const entries = (await helper.knowledge()).sort((a, b) => b.timesUsed - a.timesUsed);
          return json({ ok: true, knowledge: entries });
        }
        if (rest === '/knowledge' && method === 'POST') {
          const alternatives = Array.isArray(body.alternatives)
            ? body.alternatives.filter((a): a is string => typeof a === 'string')
            : (asString(body.alternatives) ?? '').split('\n');
          const kind = asString(body.kind) as KnowledgeEntry['kind'] | undefined;
          const entry = await helper.teach({
            kind: kind && ['answer', 'rule', 'example'].includes(kind) ? kind : 'answer',
            question: asString(body.question),
            alternatives,
            answer: asString(body.answer) ?? '',
            by,
          });
          return json({ ok: true, entry, message: 'Taught.' }, 201);
        }
        const forget = /^\/knowledge\/([\w-]+)$/.exec(rest);
        if (forget && method === 'DELETE') {
          return (await helper.forget(forget[1]!, by))
            ? json({ ok: true, message: 'Forgotten.' })
            : problem('Not found.', 404);
        }
        if (rest === '/review' && method === 'GET') {
          const status = url.searchParams.get('status') ?? 'waiting';
          const items =
            status === 'waiting'
              ? await helper.waiting()
              : (await helper.reviews()).filter((i) => i.status === status);
          return json({ ok: true, review: items });
        }
        const decide = /^\/review\/([\w-]+)\/(approve|reject)$/.exec(rest);
        if (decide && method === 'POST') {
          if (decide[2] === 'reject') {
            return json({
              ok: true,
              item: await helper.reject(decide[1]!, by, asString(body.reason)),
              message: 'Turned down.',
            });
          }
          const { item, taught } = await helper.approve(decide[1]!, {
            answer: asString(body.answer),
            question: asString(body.question),
            teach: body.teach !== false && body.teach !== 'false',
            by,
          });
          const done =
            item.kind === 'reply' && item.email ? await sendReply(runtime, helper, item) : item;
          return json({
            ok: true,
            item: done,
            taught,
            message: done.outcome ?? 'Approved and taught.',
          });
        }
        if (rest === '/ask' && method === 'POST') {
          const result = await helper.answer(asString(body.question) ?? '', 'chat');
          return json({
            ok: true,
            source: result.source,
            answer: result.text,
            matched: result.entry?.question ?? null,
          });
        }
        if (rest === '/act-alone' && method === 'PUT') {
          const kind = asString(body.kind);
          if (!kind || !/^[a-z-]+$/.test(kind)) return problem('Say which kind of message.');
          const on = body.on === true || body.on === 'true';
          return json({ ok: true, settings: await helper.setActAlone(kind, on, by) });
        }
      }
      return problem('Not found.', 404);
    } catch (error) {
      if (error instanceof TeachingRefused) return problem(error.message, 422);
      console.error(error);
      return problem('Something went wrong. It has been noted.', 500);
    }
  };
}
