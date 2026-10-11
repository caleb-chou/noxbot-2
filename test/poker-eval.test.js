import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  RANKS,
  SUITS,
  newDeck,
  shuffle,
  cryptoRng,
  parseCard,
  formatCard,
  formatCards,
} from '../src/functions/poker/cards.js';
import {
  evaluate,
  compareHands,
  handName,
  bestHands,
} from '../src/functions/poker/evaluate.js';

/** Deterministic rng: a simple LCG. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const cards = (str) => str.split(' ');
const hold = (hole, board) => evaluate('holdem', cards(hole), cards(board));
const plo = (hole, board) => evaluate('plo', cards(hole), cards(board));

/** Hold'em-style best five of any of the nine cards (no hole-card limit); only for contrast with PLO. */
function rankAny(hole, board) {
  const all = [...hole, ...board];
  let top = null;
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      const rest = all.filter((_, i) => i !== a && i !== b);
      // evaluate('holdem') takes 2 hole + 5 board: treat the first two of `rest` as hole.
      const r = evaluate('holdem', rest.slice(0, 2), rest.slice(2));
      if (!top || compareHands(r, top) > 0) top = r;
    }
  }
  return top;
}

describe('poker cards', () => {
  it('newDeck has 52 unique valid cards', () => {
    const deck = newDeck();
    expect(deck).to.have.length(52);
    expect(new Set(deck).size).to.equal(52);
    for (const c of deck) {
      expect(RANKS).to.include(c[0]);
      expect(SUITS).to.include(c[1]);
    }
  });

  it('shuffle is a permutation and does not mutate its input', () => {
    const deck = newDeck();
    const copy = [...deck];
    const out = shuffle(deck, seeded(7));
    expect(deck).to.deep.equal(copy);
    expect(out).to.have.length(52);
    expect([...out].sort()).to.deep.equal([...deck].sort());
    expect(out).to.not.deep.equal(deck);
  });

  it('shuffle is deterministic with a seeded rng and differs across seeds', () => {
    const a = shuffle(newDeck(), seeded(42));
    const b = shuffle(newDeck(), seeded(42));
    const c = shuffle(newDeck(), seeded(43));
    expect(a).to.deep.equal(b);
    expect(a).to.not.deep.equal(c);
  });

  it('cryptoRng returns floats in [0, 1) and the default shuffle permutes', () => {
    for (let i = 0; i < 200; i++) {
      const x = cryptoRng();
      expect(x).to.be.at.least(0);
      expect(x).to.be.below(1);
    }
    expect([...shuffle(newDeck())].sort()).to.deep.equal([...newDeck()].sort());
  });

  it('formatCard renders rank letter plus emoji-variant suit', () => {
    expect(formatCard('Ah')).to.equal('A♥️');
    expect(formatCard('Ts')).to.equal('T♠️');
    expect(formatCard('7d')).to.equal('7♦️');
    expect(formatCard('2c')).to.equal('2♣️');
    expect(formatCard('Ah')).to.include('️');
    expect(formatCards(['Ah', 'Ts', '7d'])).to.equal('A♥️ T♠️ 7♦️');
    expect(formatCards(['Ah', 'Ts'], ' | ')).to.equal('A♥️ | T♠️');
    expect(formatCards([])).to.equal('');
  });

  it('parseCard parses valid cards', () => {
    expect(parseCard('Ah')).to.deep.include({ rank: 'A', suit: 'h', value: 14 });
    expect(parseCard('2c')).to.deep.include({ rank: '2', suit: 'c', value: 2 });
    expect(parseCard('Td').value).to.equal(10);
  });

  it('parseCard rejects bad input', () => {
    for (const bad of ['', 'A', 'Ahh', '1h', 'Xs', 'Ax', 'ah', 'AH', '10h', null, undefined, 5, ['Ah']]) {
      expect(() => parseCard(bad), String(bad)).to.throw('Invalid card');
    }
    expect(() => formatCard('Zz')).to.throw('Invalid card');
  });
});

describe('poker evaluate: categories (holdem)', () => {
  const board = '2c 7d 9h Jc Ks';

  it('high card', () => {
    expect(hold('Ah 3d', board)).to.deep.equal([0, 14, 13, 11, 9, 7]);
  });

  it('pair', () => {
    expect(hold('Ah Ad', '2c 7d 9h Jc Ks')).to.deep.equal([1, 14, 13, 11, 9]);
  });

  it('two pair', () => {
    expect(hold('Kh 9d', board)).to.deep.equal([2, 13, 9, 11]);
  });

  it('three of a kind', () => {
    expect(hold('Kh Kd', board)).to.deep.equal([3, 13, 11, 9]);
  });

  it('straight', () => {
    expect(hold('Td 8c', board)).to.deep.equal([4, 11]);
  });

  it('flush', () => {
    expect(hold('Ac 3c', '2c 7c 9h Jc Ks')).to.deep.equal([5, 14, 11, 7, 3, 2]);
  });

  it('full house', () => {
    expect(hold('Kh Kd', '2c 7d 9h 9c Ks')).to.deep.equal([6, 13, 9]);
  });

  it('four of a kind', () => {
    expect(hold('Kh Kd', '2c Kc 9h Jc Ks')).to.deep.equal([7, 13, 11]);
  });

  it('straight flush', () => {
    expect(hold('9s 8s', '7s 6s 5s Kd 2c')).to.deep.equal([8, 9]);
  });

  it('royal flush is a straight flush with ace high', () => {
    const r = hold('As Ks', 'Qs Js Ts 2d 3c');
    expect(r).to.deep.equal([8, 14]);
    expect(handName(r)).to.equal('Royal flush');
  });

  it('every category outranks the one below', () => {
    const ranks = [
      hold('Ah 3d', board),
      hold('Ah Ad', board),
      hold('Kh 9d', board),
      hold('Kh Kd', board),
      hold('Td 8c', board),
      hold('Ac 3c', '2c 7c 9h Jc Ks'),
      hold('Kh Kd', '2c 7d 9h 9c Ks'),
      hold('Kh Kd', '2c Kc 9h Jc Ks'),
      hold('9s 8s', '7s 6s 5s Kd 2c'),
    ];
    ranks.forEach((r, i) => expect(r[0]).to.equal(i));
    for (let i = 1; i < ranks.length; i++) {
      expect(compareHands(ranks[i], ranks[i - 1])).to.equal(1);
    }
  });
});

describe('poker evaluate: straights and the wheel', () => {
  it('wheel is a 5-high straight', () => {
    expect(hold('Ah 2d', '3c 4s 5h 9d Kc')).to.deep.equal([4, 5]);
  });

  it('6-high straight beats the wheel', () => {
    const wheel = hold('Ah 2d', '3c 4s 5h 9d Kc');
    const six = hold('6h 2c', '3d 4s 5d 9d Kc');
    expect(six).to.deep.equal([4, 6]);
    expect(compareHands(six, wheel)).to.equal(1);
  });

  it('a 6-high straight on the board beats the wheel of a player holding A-2', () => {
    // Board 2-3-4-5-6, player holding Ah 7d plays 7-high; Ah 2d plays the board 6-high straight.
    expect(hold('Ah 2d', '3c 4s 5h 6d Kc')).to.deep.equal([4, 6]);
  });

  it('ace-high broadway straight', () => {
    expect(hold('Ah Kd', 'Qc Js Th 2d 3c')).to.deep.equal([4, 14]);
  });

  it('ace does not wrap around (Q-K-A-2-3 is not a straight)', () => {
    expect(hold('Kh Ad', 'Qc 2s 3h 9d 7c')[0]).to.equal(0);
  });

  it('steel wheel is a 5-high straight flush', () => {
    expect(hold('As 2s', '3s 4s 5s Kd Kc')).to.deep.equal([8, 5]);
  });

  it('flush beats a straight on the same cards; straight flush picks the flush straight', () => {
    // 7 cards contain a straight and a non-straight flush.
    expect(hold('Ah 2h', '3h 4d 5c 9h Kh')[0]).to.equal(5);
  });
});

describe('poker evaluate: ordering, kickers, ties', () => {
  it('flush beats straight, full house beats flush', () => {
    const flush = hold('Ac 3c', '2c 7c 9h Jc Ks');
    const full = hold('Kh Kd', '2c 7d 9h 9c Ks');
    expect(compareHands(full, flush)).to.equal(1);
    expect(compareHands(flush, full)).to.equal(-1);
  });

  it('higher flush wins, decided by kicker down the line', () => {
    const board = '2s 7s 9s Jd Kc';
    const a = hold('As 3s', board);
    const b = hold('Qs 3s', board);
    expect(compareHands(a, b)).to.equal(1);
    // Same top four, different fifth card.
    const b2 = '2s 7s 9s Jd Ks';
    expect(compareHands(hold('As 4s', b2), hold('As 3s', b2))).to.equal(1);
  });

  it('kicker decides equal pairs', () => {
    const board = '2c 7d 9h Jc Ks';
    const a = hold('Ah Kd', board); // pair of kings, ace kicker
    const b = hold('Qh Kh', board); // pair of kings, queen kicker
    expect(compareHands(a, b)).to.equal(1);
    expect(compareHands(b, a)).to.equal(-1);
  });

  it('pair vs pair: higher pair wins regardless of kickers', () => {
    const board = '2c 7d 9h Jc 4s';
    const a = hold('Jh 3d', board);
    const b = hold('9d Ad', board);
    expect(compareHands(a, b)).to.equal(1);
  });

  it('two pair compares high pair, low pair, then kicker', () => {
    const board = 'Kc Kd 7h 7c 2s';
    expect(compareHands(hold('Ah 3d', board), hold('Qh 3d', board))).to.equal(1);
    const b2 = 'Kc Qd 7h 2c 4s';
    expect(compareHands(hold('Kh 7d', b2), hold('Qh 2d', b2))).to.equal(1); // KK77 vs QQ22
  });

  it('full house compares trips first, then the pair', () => {
    const a = hold('Kh Kd', '2c 7d 7h 7c Ks');
    expect(a).to.deep.equal([6, 13, 7]);
    const b = hold('Kh Kd', '2c Kc 9h 9c Qs');
    const c = hold('Qh Qd', '2c Kc 9h 9c Qs');
    expect(b).to.deep.equal([6, 13, 9]);
    expect(c).to.deep.equal([6, 12, 9]);
    expect(compareHands(b, c)).to.equal(1);
  });

  it('quads compare the quad rank, then the kicker', () => {
    const board = '9c 9d 9h 9s 2c';
    expect(compareHands(hold('Ah 3d', board), hold('Kh 3d', board))).to.equal(1);
  });

  it('identical hands tie', () => {
    const board = '2c 7d 9h Jc Ks';
    expect(compareHands(hold('Ah 3d', board), hold('As 3c', board))).to.equal(0);
  });

  it('board plays: both players play the board and split', () => {
    const board = 'As Ks Qs Js Ts';
    const a = hold('2c 3d', board);
    const b = hold('4h 5d', board);
    expect(a).to.deep.equal([8, 14]);
    expect(compareHands(a, b)).to.equal(0);
    expect(
      bestHands(
        'holdem',
        [
          { id: 'a', hole: cards('2c 3d') },
          { id: 'b', hole: cards('4h 5d') },
        ],
        cards(board),
      ),
    ).to.deep.equal(['a', 'b']);
  });

  it('board plays but a hole card improves it', () => {
    const board = '2c 2d 7h 9c Ks';
    const playsBoard = hold('3h 4d', board);
    const better = hold('Ah 5d', board);
    expect(playsBoard).to.deep.equal([1, 2, 13, 9, 7]);
    expect(better).to.deep.equal([1, 2, 14, 13, 9]);
    expect(compareHands(better, playsBoard)).to.equal(1);
  });

  it('bestHands returns a single winner and handles three-way ties', () => {
    const board = cards('2c 7d 9h Jc Ks');
    expect(
      bestHands(
        'holdem',
        [
          { id: 'x', hole: cards('Ah 3d') },
          { id: 'y', hole: cards('Kh Kd') },
          { id: 'z', hole: cards('Qh 3c') },
        ],
        board,
      ),
    ).to.deep.equal(['y']);
    expect(
      bestHands(
        'holdem',
        [
          { id: 'x', hole: cards('Ah 3d') },
          { id: 'y', hole: cards('As 3c') },
          { id: 'z', hole: cards('Ad 3h') },
        ],
        board,
      ),
    ).to.deep.equal(['x', 'y', 'z']);
    expect(bestHands('holdem', [], board)).to.deep.equal([]);
  });
});

describe('poker evaluate: PLO', () => {
  it('uses exactly two hole cards: four spades in hand plus one on board is no flush', () => {
    const hole = 'As Ks Qs Js';
    const board = 'Ts 2d 3d 4c 9h';
    // Under "best 5 of all 9 cards" rules this is a royal flush (AsKsQsJsTs),
    // which uses four hole cards and is illegal in PLO.
    const anyFive = cards('As Ks Qs Js Ts');
    expect(anyFive.every((c) => (hole + ' ' + board).includes(c))).to.equal(true);
    expect(rankAny(cards(hole), cards(board))).to.deep.equal([8, 14]);
    expect(plo(hole, board)).to.deep.equal([0, 14, 13, 10, 9, 4]);
  });

  it('must use two hole cards: a board straight cannot be played', () => {
    // Board is a 5-9 straight; the player has no 2 cards that improve it but must still use 2 hole cards.
    const r = plo('Ac Ad 2h 2s', '5c 6d 7h 8s 9c');
    expect(r).to.deep.equal([1, 14, 9, 8, 7]); // one pair only: exactly two hole cards
    // Another player with 8x 9x hole cards makes a legal straight using exactly two.
    const s = plo('Th Jh 2c 3d', '5c 6d 7h 8s 9c');
    expect(s).to.deep.equal([4, 11]); // T J plus 7 8 9? J-high: 7 8 9 T J
    expect(compareHands(s, r)).to.equal(1);
  });

  it('four board hearts plus a single heart in hand is not a flush in PLO', () => {
    const board = '2h 5h 9h Kh 3c';
    const r = plo('Ah 4d 4c 8s', board);
    expect(r[0]).to.be.below(5);
    // Holding two hearts makes it.
    const f = plo('Ah 4h 4c 8s', board);
    expect(f).to.deep.equal([5, 14, 13, 9, 5, 4]);
  });

  it('three-of-a-kind in the hole cannot make trips with one hole card', () => {
    // Hole holds three queens; board has none. Only two queens can be used: a pair.
    const r = plo('Qh Qd Qc 2s', '3c 5d 8h Js Kc');
    expect(r).to.deep.equal([1, 12, 13, 11, 8]);
  });

  it('PLO full house and quads respect the 2+3 split', () => {
    // Quad nines on board with one in hand: cannot play four from board + one.
    const r = plo('9s Ah Kd 2c', '9c 9d 9h 3s 4d');
    // 9s + 9c 9d 9h + any other board card... uses 1 hole card only; but must use 2 hole cards.
    // Best: 9s Ah (2 hole) + 9c 9d 9h = quads with ace kicker? Uses 2 hole + 3 board = legal.
    expect(r).to.deep.equal([7, 9, 14]);
  });

  it('compares PLO players and finds the winner', () => {
    const board = cards('Ts 2d 3d 4c 9h');
    const winners = bestHands(
      'plo',
      [
        { id: 'flushy', hole: cards('As Ks Qs Js') },
        { id: 'pairs', hole: cards('Th 9d 5c 6c') },
      ],
      board,
    );
    expect(winners).to.deep.equal(['pairs']);
  });
});

describe('poker evaluate: validation and names', () => {
  it('throws a clear error for boards that are not five cards', () => {
    expect(() => evaluate('holdem', cards('Ah Kd'), cards('2c 7d 9h'))).to.throw('5-card board');
    expect(() => evaluate('holdem', cards('Ah Kd'), [])).to.throw('5-card board');
  });

  it('throws on wrong hole size, unknown variant, duplicates and bad cards', () => {
    const board = cards('2c 7d 9h Jc Ks');
    expect(() => evaluate('holdem', cards('Ah Kd Qs'), board)).to.throw('hole cards');
    expect(() => evaluate('plo', cards('Ah Kd'), board)).to.throw('hole cards');
    expect(() => evaluate('stud', cards('Ah Kd'), board)).to.throw('Unknown variant');
    expect(() => evaluate('holdem', cards('Ah 2c'), board)).to.throw('Duplicate');
    expect(() => evaluate('holdem', cards('Ah Zz'), board)).to.throw('Invalid card');
  });

  it('handName is human readable', () => {
    expect(handName([6, 13, 10])).to.equal('Full house, Kings over Tens');
    expect(handName([6, 6, 2])).to.equal('Full house, Sixes over Twos');
    expect(handName([8, 9])).to.equal('Straight flush, Nine high');
    expect(handName([7, 14, 2])).to.equal('Four of a kind, Aces');
    expect(handName([5, 14, 11, 7, 3, 2])).to.equal('Flush, Ace high');
    expect(handName([4, 5])).to.equal('Straight, Five high');
    expect(handName([3, 12, 9, 2])).to.equal('Three of a kind, Queens');
    expect(handName([2, 13, 9, 11])).to.equal('Two pair, Kings and Nines');
    expect(handName([1, 14, 13, 11, 9])).to.equal('Pair of Aces');
    expect(handName([0, 14, 13, 11, 9, 7])).to.equal('High card, Ace');
    expect(() => handName([9])).to.throw('Invalid hand rank');
  });
});

describe('poker evaluate: properties', function () {
  // Thousands of random hands: well over mocha's 2s default on a slow runner.
  this.timeout(60_000);

  /** Deals n random players plus a board from a seeded shuffle. */
  function randomSpot(rng, variant, n) {
    const deck = shuffle(newDeck(), rng);
    const holeSize = variant === 'plo' ? 4 : 2;
    const board = deck.splice(0, 5);
    const hands = [];
    for (let i = 0; i < n; i++) hands.push(deck.splice(0, holeSize));
    return { board, hands };
  }

  it('compareHands is antisymmetric and transitive over thousands of random hands', () => {
    const rng = seeded(2024);
    const ranks = [];
    for (let i = 0; i < 1500; i++) {
      const { board, hands } = randomSpot(rng, 'holdem', 4);
      for (const h of hands) ranks.push(evaluate('holdem', h, board));
    }
    for (let i = 0; i < 300; i++) {
      const { board, hands } = randomSpot(rng, 'plo', 2);
      for (const h of hands) ranks.push(evaluate('plo', h, board));
    }
    expect(ranks.length).to.be.above(6000);

    // Antisymmetry and reflexivity over pairs.
    for (let i = 0; i < ranks.length; i += 1) {
      expect(compareHands(ranks[i], ranks[i])).to.equal(0);
      const j = (i * 7 + 13) % ranks.length;
      expect(compareHands(ranks[i], ranks[j])).to.equal(-compareHands(ranks[j], ranks[i]));
    }

    // Transitivity over a sample of triples.
    const sample = ranks.filter((_, i) => i % 60 === 0);
    for (const a of sample) {
      for (const b of sample) {
        for (const c of sample) {
          if (compareHands(a, b) >= 0 && compareHands(b, c) >= 0) {
            expect(compareHands(a, c)).to.be.at.least(0);
          }
        }
      }
    }

    // Sorting with the comparator yields a non-decreasing sequence.
    const sorted = [...sample].sort(compareHands);
    for (let i = 1; i < sorted.length; i++) {
      expect(compareHands(sorted[i - 1], sorted[i])).to.be.at.most(0);
    }
  });

  it('evaluate does not depend on card order', () => {
    const rng = seeded(99);
    for (let i = 0; i < 1000; i++) {
      for (const variant of ['holdem', 'plo']) {
        const { board, hands } = randomSpot(rng, variant, 1);
        const base = evaluate(variant, hands[0], board);
        const again = evaluate(variant, shuffle(hands[0], rng), shuffle(board, rng));
        expect(again).to.deep.equal(base);
      }
    }
  });

  it('category frequencies are in the plausible range for 7-card hold em', () => {
    const rng = seeded(5);
    const counts = Array(9).fill(0);
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const { board, hands } = randomSpot(rng, 'holdem', 1);
      counts[evaluate('holdem', hands[0], board)[0]]++;
    }
    // Pair (~43.8%) and high card (~17.4%) dominate; quads or better are rare.
    expect(counts[1] / n).to.be.within(0.38, 0.5);
    expect(counts[0] / n).to.be.within(0.12, 0.23);
    expect((counts[7] + counts[8]) / n).to.be.below(0.01);
  });
});
