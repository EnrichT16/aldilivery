/**
 * A language model behind Ozi (Anthony, 17 October 2026, ruling 69): a small, current hosted
 * model, used only where the hand-built parts give up. Its maker's name appears nowhere a
 * person can see it (Anthony, 17 October 2026): not on a screen, in a message or a document.
 * The phrase book and the shopping parser stay first: they are free and instant. The model is
 * asked when a sentence is not a known phrase and the parser finds nothing in it, to turn the
 * words into shopping ("get me two kilos of flour, I've run out", "grab me a couple of crates
 * of eggs, the Lion's Gate ones") or into one short spoken answer within Ozi's purpose.
 *
 * The model never touches an order. It gives back a plain list of things and how many, or a
 * sentence; the catalogue search, the prices, the read-back and the one yes (Rule One) are the
 * same code as before. Every exchange goes into Ozi's memory marked as answered by the model
 * (ruling 68), so a person can judge it and the company's own model can learn from it later.
 *
 * Nothing waits on the model for long: after `WAIT_MS` the server goes on without it, and a
 * missing key simply switches it off (`brain` is null and the health check says so).
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { StoreConfig } from '@aldilivery/core';

/** The model used unless LANGUAGE_MODEL names another: the cheapest current one. */
export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** How long to wait for the model before carrying on with the hand-built parts alone. */
export const WAIT_MS = 4000;

const understanding = z.object({
  kind: z.enum(['items', 'question', 'done', 'stop', 'remove', 'repeat', 'chatter', 'unclear']),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().min(1).max(99),
      brand: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
  reply: z.string().nullable(),
});
export type Understanding = z.infer<typeof understanding>;

/** The same shape as JSON Schema, which the API holds the answer to. */
const UNDERSTANDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'items', 'reply'],
  properties: {
    kind: {
      type: 'string',
      enum: ['items', 'question', 'done', 'stop', 'remove', 'repeat', 'chatter', 'unclear'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'brand', 'detail'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 99 },
          brand: { type: ['string', 'null'] },
          detail: { type: ['string', 'null'] },
        },
      },
    },
    reply: { type: ['string', 'null'] },
  },
} as const;

export interface UnderstandInput {
  text: string;
  /** Whose Ozi is listening: shopper, runner, partner, organisation, staff, family, investor, owner. */
  account: string;
  channel: 'app' | 'phone' | 'text';
  /** What is in the basket so far, in words, so "take off the milk" and "more of those" make sense. */
  basket?: string[];
}

export interface OziBrain {
  readonly name: 'model';
  readonly model: string;
  /** What the words mean. Null when the model did not answer in time, or declined. */
  understand(input: UnderstandInput): Promise<Understanding | null>;
  /**
   * Something asked for that is not in the shop list (19 October 2026): what it is, where it is
   * bought, and its usual UK shelf price, so it can be added rather than left out. Optional, so
   * stand-ins in tests need not have it.
   */
  estimate?(name: string): Promise<Estimate | null>;
}

const estimateShape = z.object({
  kind: z.enum(['grocery', 'prepared', 'service', 'not_allowed', 'not_a_product']),
  name: z.string(),
  category: z.enum([
    'Fruit and vegetables',
    'Dairy',
    'Bakery',
    'Cupboard',
    'Meat and fish',
    'Frozen',
    'Household',
    'Everyday essentials',
    'Health',
    'Cards and gifts',
    'Other',
  ]),
  pricePence: z.number().int().min(0).max(100_000),
  reply: z.string().nullable(),
});
export type Estimate = z.infer<typeof estimateShape>;

const ESTIMATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'category', 'pricePence', 'reply'],
  properties: {
    kind: {
      type: 'string',
      enum: ['grocery', 'prepared', 'service', 'not_allowed', 'not_a_product'],
    },
    name: { type: 'string' },
    category: {
      type: 'string',
      enum: [
        'Fruit and vegetables',
        'Dairy',
        'Bakery',
        'Cupboard',
        'Meat and fish',
        'Frozen',
        'Household',
        'Everyday essentials',
        'Health',
        'Cards and gifts',
        'Other',
      ],
    },
    pricePence: { type: 'integer', minimum: 0, maximum: 100000 },
    reply: { type: ['string', 'null'] },
  },
} as const;

/** The standing instructions for an estimate, from configuration (Rule Nine). */
export function estimateInstructions(config: StoreConfig): string {
  return [
    `You help ${config.assistantName}, the assistant of ${config.productName}, a delivery service in Medway, England, where a Runner buys things at UK high street shops and supermarkets and brings them to the door.`,
    `You are given the name of one thing a customer asked for that is not in the shop list. Answer in the JSON shape given.`,
    `kind: "grocery" for anything a UK supermarket, corner shop or high street shop sells off the shelf (food, drink without alcohol, toiletries, household, stationery, small gifts); "prepared" for a hot or made-to-order meal from a café, restaurant or takeaway (a curry, chow mein, a pizza, a burger, fish and chips, a coffee); "service" for a service rather than a thing; "not_allowed" for alcohol, tobacco or vapes, any medicine (even paracetamol), cash or gift vouchers for money, weapons or anything age restricted; "not_a_product" when it is not a thing anyone sells.`,
    `name: the tidy shop name a shelf label would carry, in British English, with a typical size ("Plain flour, 1.5kg", "Large free range eggs, 12"). category: the closest from the list. pricePence: a typical current UK supermarket price in pence for that size, a sensible middle price, never a premium brand unless named; 0 when not "grocery".`,
    `reply: null for "grocery"; otherwise one short, kind sentence for the customer, under 25 words, British English, never naming a company: for "prepared" say it comes from a café or takeaway; for "not_allowed" say plainly the service does not carry it; for "service" say services are asked for by quote on a service's page; for "not_a_product" ask what they meant.`,
  ].join('\n');
}

/** The part of the provider's client this module uses, so tests can hand in a stand-in. */
export type BrainClient = Pick<Anthropic, 'messages'>;

/** The standing instructions, built from configuration so no name lives in code (Rule Nine). */
export function instructions(config: StoreConfig): string {
  const { assistantName: ozi, productName: product } = config;
  const shop = config.store.displayName;
  return [
    `You are ${ozi}, the voice assistant of ${product}, a grocery delivery service in Medway, England. People say their shopping; a Runner buys it at ${shop} or a listed local shop and brings it to the door. Many customers are blind, elderly or housebound and are speaking, not typing.`,
    `Your only job here is to understand one sentence and answer in the JSON shape you are given.`,
    `Shopping words: "order", "get me", "pick up", "grab", "buy", "purchase", "fetch", "bring", "add", "I need", "I've run out of", "put in", "can I have" and anything like them all mean the person wants things bought. Kind "items": list each thing: "name" is the plain product word or two a shop search needs ("flour", "eggs", "semi skimmed milk"), "quantity" how many (default 1; "a couple" is 2, "a dozen" is 12), "brand" only if they said one, and "detail" any size or variety they said ("2 kg", "large", "free range"), or null.`,
    `Kind "remove": they want something taken off; put the thing in items. Kind "done": they have finished ("that's everything", "that's all"). Kind "stop": cancel or never mind. Kind "repeat": say it again. Kind "question": a question about the service, delivery, prices in general, plans, Runners, safety or how to do something; give a short, kind, honest reply under 25 words. Kind "chatter": small talk or a remark; reply warmly in under 15 words. Kind "unclear": you cannot tell; reply with one short question.`,
    `Rules for any reply: British English; plain words; no figures you are not sure of (never invent a price, a time or a fee); never ask for a card number, a code or a password; no alcohol, tobacco, medicines or cash through the service; if they want a person, say they can say "person". Never mention being an AI model or who made you. Speak as ${ozi}.`,
  ].join('\n');
}

export function languageModel(
  settings: { apiKey: string; model?: string; config: StoreConfig },
  client: BrainClient = new Anthropic({ apiKey: settings.apiKey, timeout: WAIT_MS, maxRetries: 0 }),
): OziBrain {
  const model = settings.model ?? DEFAULT_MODEL;
  const system = instructions(settings.config);
  const estimateSystem = estimateInstructions(settings.config);
  return {
    name: 'model',
    model,
    async understand(input) {
      try {
        const basket =
          input.basket && input.basket.length > 0
            ? `\nIn the basket so far: ${input.basket.join(', ')}.`
            : '';
        const response = await client.messages.create(
          {
            model,
            max_tokens: 400,
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: UNDERSTANDING_SCHEMA },
            },
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: [
              {
                role: 'user',
                content: `Channel: ${input.channel}. Speaking to the ${input.account}'s assistant.${basket}\nThey said: "${input.text.replace(/"/g, "'").slice(0, 500)}"`,
              },
            ],
          },
          { timeout: WAIT_MS },
        );
        if (response.stop_reason === 'refusal') return null;
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
        const parsed = understanding.safeParse(JSON.parse(text));
        if (!parsed.success) return null;
        return {
          ...parsed.data,
          items: parsed.data.items.map((item) => ({
            name: item.name.trim(),
            quantity: item.quantity,
            brand: item.brand?.trim() || null,
            detail: item.detail?.trim() || null,
          })),
          reply: parsed.data.reply?.trim() || null,
        };
      } catch {
        // Too slow, rate limited, no credit, or the network: the hand-built parts carry on.
        return null;
      }
    },
    async estimate(name) {
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 300,
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: ESTIMATE_SCHEMA },
            },
            system: [{ type: 'text', text: estimateSystem, cache_control: { type: 'ephemeral' } }],
            messages: [
              {
                role: 'user',
                content: `They asked for: "${name.replace(/"/g, "'").slice(0, 120)}"`,
              },
            ],
          },
          { timeout: WAIT_MS },
        );
        if (response.stop_reason === 'refusal') return null;
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
        const parsed = estimateShape.safeParse(JSON.parse(text));
        if (!parsed.success) return null;
        return {
          ...parsed.data,
          name: parsed.data.name.trim(),
          reply: parsed.data.reply?.trim() || null,
        };
      } catch {
        return null;
      }
    },
  };
}

/** "2 flour", "12 eggs": the parser's own shape, for the catalogue search. */
export function itemWords(item: Understanding['items'][number]): string {
  return `${item.quantity} ${item.name}`.trim();
}
