// Poker cards: two-char strings `Rs` (rank in RANKS, suit in SUITS). Pure, no I/O.

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

const GLYPHS = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };

/** A fresh, ordered 52-card deck. */
export function newDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(r + s);
    }
  }
  return deck;
}

/** A float in [0, 1) from crypto.getRandomValues, with no modulo bias. */
export function cryptoRng() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 53 random bits: exact doubles, uniform over [0, 1).
  return ((buf[0] >>> 5) * 2 ** 26 + (buf[1] >>> 6)) / 2 ** 53;
}

/** Fisher-Yates. `rng` returns a float in [0, 1) so tests can be deterministic. */
export function shuffle(items, rng = cryptoRng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Validates a card string and returns `{ rank, suit, value }` (value 2-14). */
export function parseCard(str) {
  if (typeof str !== 'string' || str.length !== 2) {
    throw new Error(`Invalid card: ${JSON.stringify(str)}`);
  }
  const rank = str[0];
  const suit = str[1];
  const idx = RANKS.indexOf(rank);
  if (idx < 0 || !SUITS.includes(suit)) {
    throw new Error(`Invalid card: ${JSON.stringify(str)}`);
  }
  return { rank, suit, value: idx + 2 };
}

/** `Ah` -> `A♥️`. The only place card style is decided. */
export function formatCard(card) {
  const { rank, suit } = parseCard(card);
  return rank + GLYPHS[suit];
}

export function formatCards(cards, sep = ' ') {
  return cards.map(formatCard).join(sep);
}
