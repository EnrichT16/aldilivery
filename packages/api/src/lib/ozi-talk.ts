/**
 * Ozi as a real conversation, for everybody (ruling 99, 10 November 2026).
 *
 * Anthony, 10 November 2026: "I don't want a shopping assistant that is scripted… I want the
 * full capacity, brain, intellect and intelligence… connected to the Ozi assistant", for
 * Shoppers, Runners, Shop Partners, organisations and staff, as it already is for him.
 *
 * Until now, what a Shopper said went through a long list of fixed patterns and a book of
 * ready-made answers, and reached the model only as a last resort, to be sorted into a fixed
 * shape. Here the model is the conversation: it is told who is speaking, what is in their basket
 * and on their screen and what was said before, and it has tools that really do things: look in
 * the shop, put things in the basket, change them, begin the checkout, look up their orders,
 * open a page, set a reminder. It answers in its own words, a sentence at a time as they arrive.
 *
 * What does not change: nothing is paid for, sent or set without the person's own clear yes.
 * `start_checkout` only hands over to the app's own read-back, which takes the two yeses itself
 * (Rule One); a reminder is read back in the server's exact words and waits for a yes. The model
 * never sees or says a telephone number, a card number, a PIN or a code.
 *
 * Request shape for this model family: thinking is left to the model (no `thinking` field), depth
 * is `output_config.effort`, no sampling settings, no prefill, `tool_choice` auto only, and a
 * `refusal` stop is checked before anything is read. The standing instructions are one stable,
 * cached block; everything about this moment goes in the last user turn.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { StoreConfig } from '@aldilivery/core';

import {
  askModel,
  honestyRules,
  screenWords,
  serviceFacts,
  speakerWords,
  strictWithin,
  WEB_SEARCH,
  ukNow,
  type AccountKind,
  type BrainClient,
  type PastTurn,
  type ScreenContext,
  type Speaker,
} from './language-model.js';
import { SentenceSplitter } from './sentences.js';

/** How long one whole turn may take, look-ups and all, before the app carries on without it. */
export const TALK_WAIT_MS = 40_000;
/** Room for the model's own thinking and a reply as long as the moment needs. */
export const TALK_MAX_TOKENS = 4000;
/** The most rounds of look-ups in one turn. */
const TALK_MAX_STEPS = 6;
/** How many earlier turns go back as real turns of the conversation. */
const TALK_HISTORY_TURNS = 12;

/* ------------------------------------------------------------------ pages */

/** The pages Ozi may open for each kind of person: a short word for the model, and the path. */
const SHOPPER_PAGES: Record<string, string> = {
  home: '/',
  shop: '/shop',
  basket: '/basket',
  local_shops: '/shops',
  restaurants: '/restaurants',
  convenience_shops: '/convenience',
  services: '/services',
  recipes: '/recipes',
  little_gifts: '/gifts',
  gift_cards: '/gift-cards',
  offers: '/offers',
  weekly_shop: '/weekly-shop',
  finds_it: '/find-it',
  plans: '/plus',
  my_order: '/my-order',
  past_orders: '/orders',
  messages: '/messages',
  addresses: '/addresses',
  settings: '/settings',
  help: '/help',
  more: '/more',
  become_a_runner: '/runner',
  for_businesses: '/business',
  about: '/about',
};
const PAGES: Record<AccountKind, Record<string, string>> = {
  shopper: SHOPPER_PAGES,
  visitor: { ...SHOPPER_PAGES, sign_in: '/sign-in', new_account: '/sign-up' },
  runner: {
    runner_home: '/runner/home',
    messages: '/runner/messages',
    agreement: '/runner/agreement',
    help: '/help',
  },
  partner: { dashboard: '/partner', messages: '/partner/messages', help: '/help' },
  organisation: { dashboard: '/organisation', messages: '/organisation/messages', help: '/help' },
  staff: { admin: '/staff', help: '/help' },
  // The founder runs the business and may shop for himself too: his dashboard, and the shop.
  owner: { ...SHOPPER_PAGES, founders_dashboard: '/staff' },
};

/** The path for a page word, for this kind of person; null when it is not one of theirs. */
export function pagePath(kind: AccountKind, page: string): string | null {
  return PAGES[kind][page] ?? null;
}

/* ------------------------------------------------------------------ tools */

const NO_INPUT: Anthropic.Tool['input_schema'] = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {},
};

function pageTool(kind: AccountKind): Anthropic.Tool {
  return {
    name: 'open_page',
    description:
      'Open one of the pages of the app on their phone, when they ask to go somewhere or when showing it would help. The page opens at once. Say in a few words where you have taken them.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['page'],
      properties: { page: { type: 'string', enum: Object.keys(PAGES[kind]) } },
    },
  };
}

const REMINDER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'set_reminder',
    description:
      'Prepare a reminder for a signed-in person ("remind me tomorrow at ten to call the bank", "every Monday at nine, put the bins out"). Nothing is set now: the server works out the time in UK time and gives you the exact words to read back, and it is set only when they say yes in their next turn. "when" is the time exactly as they said it ("tomorrow at 10", "in 20 minutes", "every Monday at 9"). Never put a telephone number, a card number or an address in "text".',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'when', 'repeat', 'channel'],
      properties: {
        text: { type: 'string' },
        when: { type: 'string' },
        repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] },
        channel: {
          anyOf: [{ type: 'string', enum: ['notification', 'text', 'call'] }, { type: 'null' }],
        },
      },
    },
  },
  {
    name: 'list_reminders',
    description: 'Their reminders that are waiting, in words. Read-only.',
    strict: true,
    input_schema: NO_INPUT,
  },
];

const STOP_LISTENING: Anthropic.Tool = {
  name: 'stop_listening',
  description:
    'Stop listening and go quiet, when they ask you to stop, be quiet, mute or leave them be. Say one short friendly line; they press your button, or say your name, to bring you back.',
  strict: true,
  input_schema: NO_INPUT,
};

const SHOPPING_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_shop',
    description:
      'Look in the shop for products matching a few plain words ("semi skimmed milk", "brown bread", "jollof rice"). Gives up to eight matches, best first, each with its id, name, category, estimated shelf price in pence and, for a dish, the restaurant it is from. Search before you add anything, before you quote any price, and whenever they ask what there is. One search for each different thing; several searches may be made at once.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
  {
    name: 'add_to_basket',
    description:
      'Put products in their basket, by the ids a search gave you, each with how many. It happens at once on their phone, and can be undone, so do not ask permission first when it is clear what they want: add it and tell them what you added and its price. The answer says what went in and the basket as it now stands.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['product_id', 'quantity'],
            properties: { product_id: { type: 'string' }, quantity: { type: 'integer' } },
          },
        },
      },
    },
  },
  {
    name: 'change_basket',
    description:
      'Change how many of one thing is in the basket, by its id from the basket given to you: a new quantity, or 0 to take it out. For "take off the milk", "make that three", "I only want one".',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['product_id', 'quantity'],
      properties: { product_id: { type: 'string' }, quantity: { type: 'integer' } },
    },
  },
  {
    name: 'start_checkout',
    description:
      'Begin sending the order, when they say they have finished and want it sent, ordered, placed or paid for. You do not take the order yourself: the app reads the whole basket back with the total and takes their yes to the address and their yes to the payment, in its own exact words. So after calling this say at most a few words ("Right, let me read that back to you.") and nothing about payment. Only for a signed-in Shopper with something in the basket.',
    strict: true,
    input_schema: NO_INPUT,
  },
  {
    name: 'my_orders',
    description:
      'Their latest orders: where each has got to, the Runner\'s first name, what was in it and the total. For "where is my order", "has my shopping come", "what did I order last time". Read-only; signed-in Shoppers only.',
    strict: true,
    input_schema: NO_INPUT,
  },
  {
    name: 'repeat_last_order',
    description:
      'Put everything from their last order back in the basket ("same as last time", "my usual"). The app says what went in and what could not be found, so say only a few words yourself.',
    strict: true,
    input_schema: NO_INPUT,
  },
  {
    name: 'local_shops',
    description:
      'The local shops, restaurants, cafés and services that have their own page on the service, optionally of one kind ("barber", "African restaurant", "butcher", "plumber"). Gives their names and what they are. Read-only.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { type: ['string', 'null'] } },
    },
  },
];

const ACCOUNT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'start_sign_in',
    description:
      'Begin signing them in by voice, when a visitor says they have an account or wants to sign in. The app asks for what it needs itself; say only a few words.',
    strict: true,
    input_schema: NO_INPUT,
  },
  {
    name: 'start_new_account',
    description:
      'Begin opening a new account by voice, when a visitor wants one. The app asks for what it needs itself; say only a few words.',
    strict: true,
    input_schema: NO_INPUT,
  },
];

/**
 * What the founder's own conversation has besides his desk tools (11 November 2026): the shop,
 * the basket, the checkout hand-over, his orders, the local shops, any page, and going quiet.
 * His work comes first and shopping second, but one assistant does both.
 */
export const OWNER_EXTRA_TOOLS: Anthropic.Tool[] = [
  ...SHOPPING_TOOLS,
  pageTool('owner'),
  STOP_LISTENING,
];

/** The tools for one kind of person. Shopping stays behind a Shopper's or a visitor's turn. */
export function talkToolsFor(kind: AccountKind): Anthropic.Tool[] {
  switch (kind) {
    case 'shopper':
      return [...SHOPPING_TOOLS, pageTool(kind), ...REMINDER_TOOLS, STOP_LISTENING];
    case 'visitor':
      return [...SHOPPING_TOOLS, ...ACCOUNT_TOOLS, pageTool(kind), STOP_LISTENING];
    default:
      return [pageTool(kind), ...REMINDER_TOOLS, STOP_LISTENING];
  }
}

/* ------------------------------------------------------------------ instructions */

/** The standing instructions for the conversation: stable, so they are cached. */
export function talkInstructions(config: StoreConfig, knowledge: string): string {
  const { assistantName: ozi, productName: product } = config;
  return [
    `You are ${ozi}, the voice of ${product}: a delivery service where people say what they want and a local Runner buys it at a supermarket or local shop and brings it to their door. It was built first of all for people who are blind, partially sighted, older, disabled or caring for somebody, and it works for everybody else too. People talk to you out loud and hear your answer. Many of them never look at the screen and never touch it, so you are their eyes and hands in this app as well as their company.`,

    `Be the best assistant they have ever had: warm, quick, sensible, a pleasure to talk to, and good at getting things done. This is a real conversation. Listen to what they actually said and answer that, in your own words, the way a bright and kind person would. There is no script and no set phrases: never fall back on stock lines, never say the same thing the same way twice, and do not finish every turn with the same question. Follow the thread of the conversation, remember what they told you earlier in it, pick up on their mood, and use your judgement. If they want to chat, chat. If they are in a hurry, be brisk. If they are muddled or upset, slow down and be gentle. Use everything you know about food, cooking, households, health in the everyday sense, budgets and life in general to be genuinely useful: suggest a meal, work out what goes with what, compare two things, explain how something works.`,

    `Everything you write is spoken aloud by a speech voice, so write for the ear. Plain spoken British English. No lists, bullet marks, headings, brackets, emoji or symbols, and nothing that only makes sense when seen. Answer first, then stop. Most turns are a sentence or two; take more room only when they ask for more, such as a recipe, an explanation or a comparison, and then say it as a person would say it aloud, a step at a time. Say prices the natural way. When they greet you, greet them back as suits the time of day, which you are given. Their first name, when you know it, is for a greeting or a moment that matters; not every turn.`,

    `Getting things done. You have tools, and they really act on their phone. When they name things they want, look in the shop and put the obvious match straight in the basket, then tell them what you added and what it costs; adding is free and can be undone, so do not ask permission for the obvious. When a real choice matters, such as size, type or brand, ask one short question and offer two or three of what the shop has, with prices. If the shop has nothing like it, say so plainly and offer the nearest thing, or the service that has a person look for it. Before a look-up that may take a moment you may say a few natural words first, as a person would ("Let me have a look."). Never claim to have done something a tool did not do, and never quote a price, a time or a fee you have not been given: prices are estimates of the shelf price and the till decides.`,

    `Sending an order. When they have finished, tell them roughly what the basket comes to and, when they want it sent, call start_checkout. The app then reads the order back and takes their two yeses itself, so you never take payment, never say an order has been placed, and never ask for or read out a card number, a telephone number, a PIN, a password or a code. A visitor can look around and fill a basket, and needs an account to send it: offer to sign them in or open one by voice. A reminder is the same: you prepare it, the exact words come back to you to read, and it is set only on their yes.`,

    `On the telephone (the channel is given to you each turn as "phone") they have rung the order line and can see nothing at all. Keep every answer to one or two short sentences, then stop and let them speak. Take their order as a person on the end of a line would: look in the shop, put the obvious match in their basket, say what you added and about what it costs, and ask what else. When they say they have everything, call start_checkout and say only a few words: the line itself then reads the whole order back with the total and the address and takes their yes, and you never take payment or say an order has been placed. Never read out a product id, and never offer to open a page or show them anything.`,

    `What you remember about a Shopper is given to you each turn when they are signed in: their delivery address, what they buy most by its exact name, the local shops they have used and their last order. Use it the way a good shopkeeper who knows them would. When they ask for something plainly, such as milk or bread, and their past orders show which one they always have, choose that one without asking and say which you chose. Never ask for their address: you have it, and the app reads it back before anything is sent. Ask only what you truly cannot work out, one short question at a time, in conversation: for instance whether they want it from the same shop as last time or from any shop, when that genuinely matters. Never walk them through a form or a menu.`,

    `You are generally clever, not only about shopping. Answer ordinary questions properly: sums and percentages (work them out carefully and say the answer plainly, with the working if they ask for it), spelling, facts, how to cook something, what a word means, a letter they are trying to understand. You can also search the web. Use it when they ask what something costs elsewhere, for a current fact you do not know, or for anything recent, and answer with the real figures you found and where they are from, in a sentence or two. Do not search for what you already know or for what the shop's own search answers, and never read out a web address.`,

    `Who you are talking to is given to you each turn. For a Shopper or a visitor you are their shopping assistant and guide to the service. For a Runner, a Shop Partner, an organisation or a member of staff you are the assistant for their work: their deliveries, their shop and its orders, the people they look after, the admin panel. Help with what is on their screen and how things work, never offer them a Shopper account, and never shop for them from that sign-in: shopping goes through a Shopper account.`,

    `What is on their screen is given to you when the app can see it. Use it: "this one", "the first one", "what does this say" mean what is there. You can describe the page and tell them what they can do on it. Never read out anything from the screen that looks like a number, a code or an address.`,

    `The service never brings alcohol, tobacco or vapes, medicines, cash or anything age restricted; say so kindly and suggest something else. Never talk about insurance: customer service helps with that. If somebody is in danger or seriously unwell, tell them to call 999 at once. If they are low or lonely, be kind and human about it first; mention a helpline only when what they say truly calls for one. If they want a person, tell them they can say "person".`,

    `You are ${ozi}, a computer voice assistant, and you say so if asked; you are not a person. Never say who made you or what technology you run on, and never name any company, product or model behind you. About the service itself, say only what you have been given below or what a tool tells you; when you do not know, say so and offer a person. Never invent a rule, a price, a time, a refund or a promise.`,

    honestyRules(config),
    ...(knowledge ? [`What you know about the service:\n${knowledge}`] : []),
    `The facts:\n${serviceFacts(config)}`,
  ].join('\n\n');
}

/* ------------------------------------------------------------------ what may be spoken */

/** The makers and their products: the only words that are never said, whatever the sentence. */
const MAKERS =
  /\b(anthropic|claude|open ?ai|chat ?gpt|gpt-?\d[\w.]*|large language model|language model|ai model|llm|(?:sonnet|opus|haiku|gemini|llama|mistral|copilot)\s+(?:model|ai|\d))\b/i;
const INSURANCE = /\binsur(?:ance|ed|er|ers|ing|e)\b/i;
/** Anything that could be a telephone or card number: nine digits or more. */
const LONG_NUMBER = /\+?\d(?:[\s-]?\d){8,}/g;

/**
 * One sentence fit to be spoken (ruling 99). A sentence naming a maker is left out; insurance is
 * handed to customer service; a long number is never read. Nothing else is touched, and nothing
 * is cut short: how long to speak is the model's judgement.
 */
export function spokenSentence(text: string, config: StoreConfig): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return '';
  if (MAKERS.test(clean))
    return `I'm ${config.assistantName}, ${config.productName}'s own assistant.`;
  if (INSURANCE.test(clean)) {
    return 'For anything about insurance, our customer service team will help you.';
  }
  return clean.replace(LONG_NUMBER, "a number I won't read out");
}

/* ------------------------------------------------------------------ one turn */

/** What a tool did, as the model is told; with words to read back when a yes is awaited. */
export interface TalkToolOutcome {
  result: unknown;
  /** The server's exact read-back (a reminder): the turn ends on it and waits for their yes. */
  readBack?: string;
}

export interface TalkInput {
  text: string;
  who: Speaker;
  channel: 'app' | 'phone' | 'text';
  history: PastTurn[];
  /** The basket as it stands, in words with ids, quantities and prices; '' when not shopping. */
  basket: string;
  screen?: ScreenContext;
  /** Carries out one tool by name. A failure is told to the model, never to the person. */
  run(name: string, input: unknown): Promise<TalkToolOutcome>;
  onSentence?: (sentence: string) => void;
  /** How long the whole turn may take; the telephone line must answer sooner than the app. */
  waitMs?: number;
  /** Only these tools, by name, and no web search: the telephone line's own short list. */
  only?: readonly string[];
}

/** What the telephone line's conversation may do (13 November 2026). */
export const PHONE_TOOL_NAMES = [
  'search_shop',
  'add_to_basket',
  'change_basket',
  'start_checkout',
] as const;

export interface TalkOutcome {
  /** Everything said this turn, in order. */
  reply: string;
  awaitingYes: boolean;
}

/** Earlier turns as real turns of the conversation, oldest first, ending before this one. */
export function pastMessages(
  history: PastTurn[],
  limits: { turns: number; heard: number; said: number } = {
    turns: TALK_HISTORY_TURNS,
    heard: 2000,
    said: 4000,
  },
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of history.slice(-limits.turns)) {
    const heard = turn.heard.replace(/\s+/g, ' ').trim().slice(0, limits.heard);
    const said = turn.said.replace(/\s+/g, ' ').trim().slice(0, limits.said);
    if (heard === '' || said === '') continue;
    messages.push({ role: 'user', content: heard }, { role: 'assistant', content: said });
  }
  return messages;
}

/**
 * One turn of the conversation. Null when the model could not answer in time or at all, so the
 * app carries on with its hand-built parts; the reason is on the health record.
 */
export async function talk(
  client: BrainClient,
  settings: { model: string; system: string; config: StoreConfig },
  input: TalkInput,
): Promise<TalkOutcome | null> {
  const { config } = settings;
  const deadline = Date.now() + (input.waitMs ?? TALK_WAIT_MS);
  const who = speakerWords(config, input.who);
  const screen = screenWords(input.screen);
  const now = [who, `Channel: ${input.channel}. It is ${ukNow()} in the UK.`, input.basket, screen]
    .filter((part) => part !== '')
    .join('\n');
  const messages: Anthropic.MessageParam[] = [
    ...pastMessages(input.history),
    {
      role: 'user',
      content: `[For you, not said by them]\n${now}\n[They said]\n${input.text.replace(/\s+/g, ' ').slice(0, 4000)}`,
    },
  ];
  const only = input.only;
  const tools: Anthropic.ToolUnion[] = only
    ? talkToolsFor('shopper').filter((tool) => only.includes(tool.name))
    : [...strictWithin(talkToolsFor(input.who.kind)), WEB_SEARCH];
  const said: string[] = [];
  const say = (sentence: string): void => {
    const safe = spokenSentence(sentence, config);
    if (safe === '' || said[said.length - 1] === safe) return;
    said.push(safe);
    input.onSentence?.(safe);
  };
  try {
    for (let step = 0; step < TALK_MAX_STEPS; step += 1) {
      const remaining = deadline - Date.now();
      if (remaining < 800) break;
      const splitter = new SentenceSplitter();
      const response = await askModel(
        client,
        {
          model: settings.model,
          max_tokens: TALK_MAX_TOKENS,
          // Proper thought on every turn (13 November 2026: Anthony asked for real reasoning
          // from everybody's assistant, not only his own).
          output_config: { effort: 'medium' },
          tools,
          tool_choice: { type: 'auto' },
          system: [{ type: 'text', text: settings.system, cache_control: { type: 'ephemeral' } }],
          messages,
        },
        remaining,
        {
          onText: (delta: string) => {
            for (const sentence of splitter.push(delta)) say(sentence);
          },
        },
      );
      if (response.stop_reason === 'refusal') {
        if (said.length === 0)
          say("I can't help with that one, I'm sorry. Is there something else?");
        return { reply: said.join(' '), awaitingYes: false };
      }
      for (const sentence of splitter.flush()) say(sentence);
      const uses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      // A web search still under way at the provider: the same turn is carried on as it stands.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        return said.length > 0 ? { reply: said.join(' '), awaitingYes: false } : null;
      }
      // Thinking and tool calls go back exactly as they came.
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      let readBack: string | null = null;
      // Every call is answered, all in one turn, so calls made together stay together.
      for (const use of uses) {
        try {
          const outcome = await input.run(use.name, use.input);
          if (outcome.readBack && readBack === null) readBack = outcome.readBack;
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(outcome.result),
          });
        } catch {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'That could not be done just now.',
            is_error: true,
          });
        }
      }
      // Something read back for a yes: the server's exact words end the turn (Rule One).
      if (readBack !== null) {
        say(readBack);
        return { reply: said.join(' '), awaitingYes: true };
      }
      messages.push({ role: 'user', content: results });
    }
    // Out of time or rounds with something already said: what was said stands.
    return said.length > 0 ? { reply: said.join(' '), awaitingYes: false } : null;
  } catch {
    // Too slow, refused, no credit or the network. Words already spoken are kept as the reply.
    return said.length > 0 ? { reply: said.join(' '), awaitingYes: false } : null;
  }
}
