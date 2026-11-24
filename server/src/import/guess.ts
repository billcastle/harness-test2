import { normalizeText } from '../lib/normalize.js';

interface Group {
  /** Category names this group may land in, best first; matched case-insensitively against the user's own categories. */
  names: string[];
  /** Matched against the normalized description. */
  pattern: RegExp;
}

// Order matters: the first group that matches wins, so "grab food" is Food before "grab" is Transport.
const GROUPS: Group[] = [
  { names: ['food', 'food & dining', 'dining', 'restaurants', 'eating out'], pattern: /\b(grab ?food|foodpanda|jollibee|mcdonald'?s?|kfc|starbucks|mang inasal|chowking|greenwich|shakey'?s?|yellow cab|burger king|dunkin|tim hortons|coffee bean|bonchon|army navy|pizza hut|domino'?s?|subway|cafe|restaurant|bakery)\b/ },
  { names: ['groceries', 'grocery', 'food', 'food & dining'], pattern: /\b(puregold|landers|s&r|supermarket|7[- ]?eleven|ministop|alfamart|uncle john'?s|robinsons? (easymart|supermarket)|walter ?mart|shopwise|savemore|grocery)\b/ },
  { names: ['transport', 'transportation', 'travel', 'commute'], pattern: /\b(grab|move ?it|angkas|joyride|lalamove|uber|taxi|beep|mrt|lrt|easytrip|autosweep|petron|caltex|shell|phoenix|seaoil|cebu pacific|cebgo|airasia|philippine airlines|pal express|toll)\b/ },
  { names: ['shopping', 'online shopping'], pattern: /\b(shopee|lazada|zalora|temu|shein|amazon|uniqlo|h&m|ikea|sm store|national book store|decathlon|miniso|daiso|tiktok shop)\b/ },
  { names: ['subscriptions', 'subscription', 'streaming'], pattern: /\b(spotify|google|netflix|youtube|icloud|apple\.com|apple services|disney|hbo|openai|chatgpt|anthropic|claude|adobe|microsoft|canva|github|dropbox|notion|prime video|viu|vivamax)\b/ },
  { names: ['bills', 'bills & utilities', 'utilities'], pattern: /\b(meralco|maynilad|manila water|pldt|converge|globe|smart|dito|sky cable|bills payment|buy load)\b/ },
  { names: ['health', 'healthcare', 'medical', 'pharmacy'], pattern: /\b(mercury drug|watsons|southstar|rose pharmacy|hospital|clinic|dental|pharmacy|medical)\b/ },
  { names: ['entertainment', 'leisure'], pattern: /\b(cinema|steam|playstation|nintendo|ticketnet|smtickets|klook|bowling)\b/ },
];

/**
 * A rough guess at a category from the merchant text alone, chosen among the categories the user already has.
 * Returns null when nothing matches or the user has no fitting category, so the row stays Uncategorized.
 */
export function guessCategoryId(description: string, categories: { id: number; name: string }[]): number | null {
  const text = normalizeText(description);
  const byName = new Map(categories.map((c) => [normalizeText(c.name), c.id]));
  for (const g of GROUPS) {
    if (!g.pattern.test(text)) continue;
    for (const name of g.names) {
      const id = byName.get(name);
      if (id !== undefined) return id;
    }
  }
  return null;
}
