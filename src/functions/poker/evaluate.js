// Poker hand evaluation for Hold'em and Pot-Limit Omaha. Pure, no I/O.
// A hand rank is an array of numbers compared lexicographically:
// [category, ...tie-breakers], category 8 (straight flush) .. 0 (high card).

import { parseCard } from './cards.js';

export const CATEGORIES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

const HOLE_COUNT = { holdem: 2, plo: 4 };

/** Rank array of exactly five parsed cards. */
export function rank5(cards) {
  const values = cards.map((c) => c.value).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  const counts = new Map();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // Groups by count desc, then value desc.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let straightHigh = 0;
  if (groups.length === 5) {
    if (values[0] - values[4] === 4) {
      straightHigh = values[0];
    } else if (values[0] === 14 && values[1] === 5 && values[4] === 2) {
      straightHigh = 5; // the wheel: ace plays low
    }
  }

  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return [2, groups[0][0], groups[1][0], groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  return [0, ...values];
}

/** Lexicographic compare of two rank arrays: -1, 0 or 1. */
export function compareHands(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** All k-element subsets of `items`. */
export function combos(items, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/** Best rank array over a list of candidate five-card hands. */
function bestOf(hands) {
  let top = null;
  for (const five of hands) {
    const r = rank5(five);
    if (!top || compareHands(r, top) > 0) top = r;
  }
  return top;
}

/**
 * Rank a player's hand. `variant` is 'holdem' (best 5 of hole + board) or
 * 'plo' (exactly 2 of 4 hole cards plus exactly 3 of the 5 board cards).
 * The board must be complete (5 cards).
 */
export function evaluate(variant, hole, board) {
  const holeCount = HOLE_COUNT[variant];
  if (!holeCount) throw new Error(`Unknown variant: ${variant}`);
  if (!Array.isArray(hole) || hole.length !== holeCount) {
    throw new Error(`${variant} needs ${holeCount} hole cards, got ${hole?.length}`);
  }
  if (!Array.isArray(board) || board.length !== 5) {
    throw new Error(`evaluate needs a full 5-card board, got ${board?.length}`);
  }
  if (new Set([...hole, ...board]).size !== holeCount + 5) {
    throw new Error('Duplicate cards');
  }
  const h = hole.map(parseCard);
  const b = board.map(parseCard);

  if (variant === 'plo') {
    const hands = [];
    for (const two of combos(h, 2)) {
      for (const three of combos(b, 3)) hands.push([...two, ...three]);
    }
    return bestOf(hands);
  }
  return bestOf(combos([...h, ...b], 5));
}

const NAMES = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};
const name = (v) => NAMES[v];
const plural = (v) => (v === 6 ? 'Sixes' : `${NAMES[v]}s`);

/** Human readable description of a rank array, e.g. 'Full house, Kings over Tens'. */
export function handName(rank) {
  const [cat, a, b] = rank;
  switch (cat) {
    case 8:
      return a === 14 ? 'Royal flush' : `Straight flush, ${name(a)} high`;
    case 7:
      return `Four of a kind, ${plural(a)}`;
    case 6:
      return `Full house, ${plural(a)} over ${plural(b)}`;
    case 5:
      return `Flush, ${name(a)} high`;
    case 4:
      return `Straight, ${name(a)} high`;
    case 3:
      return `Three of a kind, ${plural(a)}`;
    case 2:
      return `Two pair, ${plural(a)} and ${plural(b)}`;
    case 1:
      return `Pair of ${plural(a)}`;
    case 0:
      return `High card, ${name(a)}`;
    default:
      throw new Error(`Invalid hand rank: ${JSON.stringify(rank)}`);
  }
}

/** Ids of the winning (possibly tied) players. `players` is [{ id, hole }]. */
export function bestHands(variant, players, board) {
  let top = null;
  let winners = [];
  for (const { id, hole } of players) {
    const r = evaluate(variant, hole, board);
    const c = top ? compareHands(r, top) : 1;
    if (c > 0) {
      top = r;
      winners = [id];
    } else if (c === 0) {
      winners.push(id);
    }
  }
  return winners;
}
