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

/**
 * A product's picture by the words in its name (20 October 2026: "the picture of milk does not
 * match the name cheese"). The most particular words come first, so "Baking potatoes" is a
 * potato, not bread, and "Chopped tomatoes" is a tin. Whole words only. Decoration: the name
 * is always written beside it.
 */
const PRODUCT_EMOJI: Array<[RegExp, string]> = [
  [/\b(toilet roll|kitchen roll|tissue)/i, '🧻'],
  [/\b(chopped tomato|baked beans?|tinned|tin of|soup)/i, '🥫'],
  [/\bpotato/i, '🥔'],
  [/\b(cheese|cheddar|brie|mozzarella|parmesan)/i, '🧀'],
  [/\bbutter\b/i, '🧈'],
  [/\begg/i, '🥚'],
  [/\b(yoghurt|yogurt|porridge|oats|cereal|cornflakes|muesli)/i, '🥣'],
  [/\bmilk\b(?! chocolate)|\bcream\b/i, '🥛'],
  [/\b(choc|chocolate)/i, '🍫'],
  [/\b(biscuit|cookie|digestive)/i, '🍪'],
  [/\bcroissant/i, '🥐'],
  [/\b(bread|loaf|rolls?|buns?|baguette|bagel)\b/i, '🍞'],
  [/\b(cake|scone|muffin|pastr)/i, '🧁'],
  [/\bbanana/i, '🍌'],
  [/\bapple/i, '🍎'],
  [/\b(orange|satsuma|clementine)/i, '🍊'],
  [/\blemon|\blime/i, '🍋'],
  [/\bgrape/i, '🍇'],
  [/\bstrawberr|\bberr/i, '🍓'],
  [/\bpear\b|\bpears\b/i, '🍐'],
  [/\bcarrot/i, '🥕'],
  [/\bonion/i, '🧅'],
  [/\bgarlic/i, '🧄'],
  [/\bbroccoli/i, '🥦'],
  [/\b(lettuce|salad|spinach|cabbage|greens)/i, '🥬'],
  [/\btomato/i, '🍅'],
  [/\bmushroom/i, '🍄'],
  [/\b(peas|frozen)\b/i, '🧊'],
  [/\b(chicken|turkey)/i, '🍗'],
  [/\bbacon/i, '🥓'],
  [/\b(beef|mince|steak|lamb|pork)/i, '🥩'],
  [/\bsausage/i, '🌭'],
  [/\b(prawn|shrimp)/i, '🦐'],
  [/\b(fish|salmon|cod|tuna|haddock)/i, '🐟'],
  [/\b(spaghetti|pasta|penne|noodle)/i, '🍝'],
  [/\brice\b/i, '🍚'],
  [/\b(curry|stew|wok)/i, '🍜'],
  [/\bpizza/i, '🍕'],
  [/\b(flour)\b/i, '🌾'],
  [/\b(lentil|chickpea|kidney beans?)/i, '🫘'],
  [/\bhoney/i, '🍯'],
  [/\bolive/i, '🫒'],
  [/\b(herb|bay leaves|basil|parsley|oregano)/i, '🌿'],
  [/\b(stock cube|salt|pepper|spice)/i, '🧂'],
  [/\b(tea bags?|tea)\b/i, '🍵'],
  [/\b(coffee|latte|cappuccino)/i, '☕'],
  [/\bjuice/i, '🧃'],
  [/\b(water|cola|lemonade|fizzy|drink|soda)\b/i, '🥤'],
  [/\b(wine)\b/i, '🍷'],
  [/\b(washing|laundry|soap|shampoo|bleach|cleaner|detergent|liquid)\b/i, '🧴'],
  [/\b(toothpaste|toothbrush)/i, '🪥'],
  [/\b(paracetamol|ibuprofen|tablets|plasters?)\b/i, '🩹'],
  [/\bbatter(y|ies)/i, '🔋'],
  [/\b(cable|charger|charging|plug)/i, '🔌'],
  [/\b(light bulb|bulb)/i, '💡'],
  [/\b(tape|glue|scissors)/i, '✂️'],
  [/\bcandle/i, '🕯️'],
  [/\b(teddy|toy)/i, '🧸'],
  [/\b(colouring|crayon|pencil|pen)\b/i, '🖍️'],
  [/\b(flower|bouquet|plant)/i, '💐'],
  [/\b(card)\b/i, '💌'],
  [/\b(gift|present)/i, '🎁'],
  [/\b(haircut|hair|trim|beard|shave)/i, '✂️'],
];

/** The picture for a category, when no word in the name says more. */
export const CATEGORY_EMOJI: Record<string, string> = {
  'Fruit and vegetables': '🥕',
  Dairy: '🥛',
  Bakery: '🍞',
  Cupboard: '🥫',
  Household: '🧻',
  'Everyday essentials': '🛍️',
  'Meat and fish': '🍗',
  Frozen: '🧊',
  Health: '🩹',
  'Cards and gifts': '🎁',
};

/** A catalogue item's picture: by its name first, then its category. */
export function itemEmoji(name: string, category: string): string {
  for (const [pattern, emoji] of PRODUCT_EMOJI) if (pattern.test(name)) return emoji;
  return CATEGORY_EMOJI[category] ?? '🛍️';
}

/** A Shop Partner's product: by its name and tags, then the shop's kind. */
export function productEmoji(words: string, kind: PartnerKind | string): string {
  for (const [pattern, emoji] of PRODUCT_EMOJI) if (pattern.test(words)) return emoji;
  return shopLook(kind).emoji === '🛒' ? '🛍️' : shopLook(kind).emoji;
}
