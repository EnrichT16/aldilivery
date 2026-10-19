import type { PartnerKind } from './api';

/**
 * How a shop looks without a photo of its own (19 October 2026): a soft coloured banner and a
 * big picture for its kind. Light colours, so navy words on them pass WCAG AA (over 7 to 1 on
 * each end of every gradient). The picture is decoration only: the words say the kind.
 */
export interface ShopLook {
  gradient: string;
  emoji: string;
}

const LOOKS: Record<PartnerKind, ShopLook> = {
  shop: { gradient: 'linear-gradient(135deg, #7BE0A6 0%, #CFF5DE 100%)', emoji: '🛒' },
  food: { gradient: 'linear-gradient(135deg, #F8B26A 0%, #FDE3C2 100%)', emoji: '🍜' },
  service: { gradient: 'linear-gradient(135deg, #8EC1F2 0%, #D6E9FB 100%)', emoji: '✂️' },
};

export function shopLook(kind: PartnerKind | string): ShopLook {
  return LOOKS[kind as PartnerKind] ?? LOOKS.shop;
}

/** A product's picture by the words in its name or tags, for a row with no photo. */
const PRODUCT_EMOJI: Array<[RegExp, string]> = [
  [/bread|loaf|roll|bun|bak|cake|scone|croissant|pastr/i, '🍞'],
  [/milk|cheese|yog|butter|cream|dairy/i, '🥛'],
  [/fruit|apple|banana|orange|grape|berr|pear/i, '🍎'],
  [/veg|potato|carrot|onion|salad|tomato|greens/i, '🥕'],
  [/meat|chicken|beef|pork|lamb|sausage|bacon/i, '🍗'],
  [/fish|prawn|salmon|cod/i, '🐟'],
  [/rice|noodle|curry|wok|soup|stew/i, '🍜'],
  [/coffee|tea|latte|cappuccino/i, '☕'],
  [/drink|juice|water|pop|soda|cola/i, '🥤'],
  [/sweet|choc|candy|biscuit|cookie/i, '🍫'],
  [/egg/i, '🥚'],
  [/flower|plant|bouquet/i, '💐'],
  [/clean|soap|household|wash|tissue|toilet/i, '🧻'],
  [/hair|cut|trim|beard|shave/i, '✂️'],
  [/gift|card|present/i, '🎁'],
];

export function productEmoji(words: string, kind: PartnerKind | string): string {
  for (const [pattern, emoji] of PRODUCT_EMOJI) if (pattern.test(words)) return emoji;
  return shopLook(kind).emoji === '🛒' ? '🛍️' : shopLook(kind).emoji;
}
