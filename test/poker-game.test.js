import { expect } from 'chai';
import { describe, it } from 'mocha';
import { newDeck } from '../src/functions/poker/cards.js';
import { parseTableConfig } from '../src/functions/poker/config.js';
import {
  newTable,
  sit,
  leave,
  rebuy,
  setSittingOut,
  startHand,
  act,
  timeout,
  legalActions,
  close,
  buildSidePots,
  totalChips,
  potTotal,
  eligibleSeats,
  canStartHand,
  NEXT_HAND_DELAY_MS,
} from '../src/functions/poker/game.js';

const T0 = 1_000_000;

/** Deterministic rng (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ok = (res) => {
  expect(res.error, res.error).to.equal(undefined);
  return res;
};

/** Build a deck: hole cards in deal order (one per player per round), then the board. */
function makeDeck(variant, holes, board) {
  const hc = variant === 'plo' ? 4 : 2;
  const hs = holes.map((h) => h.split(' '));
  const out = [];
  for (let r = 0; r < hc; r++) for (const h of hs) out.push(h[r]);
  out.push(...board.split(' '));
  const used = new Set(out);
  expect(used.size).to.equal(out.length);
  out.push(...newDeck().filter((c) => !used.has(c)));
  return out;
}

/** A lobby with p0..pN-1 seated in seats 0..N-1 with the given stacks. */
function mkTable(stacks, opts = {}) {
  const { variant = 'holdem', blinds = '1/2', seats = 6, ...rest } = opts;
  const { config, error } = parseTableConfig({
    variant,
    blinds,
    seats,
    buyin: 1000,
    buyin_min: 2,
    buyin_max: 1_000_000,
    ...rest,
  });
  expect(error).to.equal(undefined);
  let state = newTable({ hostId: 'p0', channelId: 'c', guildId: 'g', config, now: T0 });
  stacks.forEach((stack, i) => {
    state = ok(sit(state, `p${i}`, i, stack, T0)).state;
  });
  return state;
}

/** Apply [user, type, amount] steps, collecting events. */
function play(state, steps, now = T0) {
  let s = state;
  const events = [];
  for (const [user, type, amount] of steps) {
    const res = act(s, user, { type, amount }, now);
    expect(res.error, `${user} ${type} ${amount ?? ''}: ${res.error}`).to.equal(undefined);
    s = res.state;
    events.push(...res.events);
  }
  return { state: s, events };
}

const ofType = (events, type) => events.filter((e) => e.type === type);
const stackOf = (state, user) => state.seats.find((s) => s && s.userId === user)?.stack;

function foldOut(state, now = T0) {
  let s = state;
  const events = [];
  while (s.phase === 'hand') {
    const res = ok(act(s, s.seats[s.toAct].userId, { type: 'fold' }, now));
    s = res.state;
    events.push(...res.events);
  }
  return { state: s, events };
}

describe('poker game: setup and seating', () => {
  it('newTable starts in the lobby with empty seats', () => {
    const s = mkTable([]);
    expect(s.phase).to.equal('lobby');
    expect(s.seats).to.have.length(6);
    expect(s.seats.every((x) => x === null)).to.equal(true);
    expect(s.messageId).to.equal(null);
    expect(s.button).to.equal(null);
    expect(s.handNumber).to.equal(0);
    expect(s.startedAt).to.equal(T0);
  });

  it('sit validates buy-in, seat and double seating, without changing state', () => {
    let s = mkTable([], { buyin: 500, buyin_min: 100, buyin_max: 800 });
    const before = JSON.stringify(s);
    expect(sit(s, 'a', undefined, 99, T0).error).to.match(/between \$100 and \$800/);
    expect(sit(s, 'a', undefined, 801, T0).error).to.be.a('string');
    expect(sit(s, 'a', undefined, 150.5, T0).error).to.be.a('string');
    expect(sit(s, 'a', 9, 500, T0).error).to.match(/does not exist/);
    expect(JSON.stringify(s)).to.equal(before);
    const r = ok(sit(s, 'a', undefined, 500, T0));
    s = r.state;
    expect(r.events).to.deep.equal([{ type: 'sit', userId: 'a', seat: 0, amount: 500 }]);
    expect(sit(s, 'a', undefined, 500, T0).error).to.match(/already seated/);
    expect(sit(s, 'b', 0, 500, T0).error).to.match(/taken/);
    s = ok(sit(s, 'b', undefined, 600, T0)).state;
    expect(s.seats[1].userId).to.equal('b');
    expect(s.seats[1].buyIns).to.equal(600);
  });

  it('refuses a full table', () => {
    let s = mkTable([100, 100], { seats: 2 });
    expect(sit(s, 'x', undefined, 100, T0).error).to.match(/full/);
  });

  it('a player who sits mid-hand waits for the next hand', () => {
    let s = mkTable([200, 200]);
    s = ok(startHand(s, T0, seeded(1))).state;
    s = ok(sit(s, 'late', undefined, 200, T0)).state;
    const late = s.seats[2];
    expect(late.status).to.equal('waiting');
    expect(late.hole).to.deep.equal([]);
    expect(totalChips(s)).to.equal(600);
    s = foldOut(s).state;
    s = ok(startHand(s, T0 + 1, seeded(2))).state;
    expect(s.seats[2].status).to.not.equal('waiting');
    expect(s.seats[2].hole).to.have.length(2);
  });

  it('startHand needs two eligible players', () => {
    let s = mkTable([200]);
    expect(startHand(s, T0).error).to.match(/two players/);
    s = ok(sit(s, 'p1', undefined, 200, T0)).state;
    s = ok(setSittingOut(s, 'p1', true, T0)).state;
    expect(canStartHand(s)).to.equal(false);
    expect(startHand(s, T0).error).to.be.a('string');
    s = ok(setSittingOut(s, 'p1', false, T0)).state;
    expect(canStartHand(s)).to.equal(true);
    expect(eligibleSeats(s)).to.deep.equal([0, 1]);
  });

  it('sitting-out players are not dealt in', () => {
    let s = mkTable([200, 200, 200]);
    s = ok(setSittingOut(s, 'p2', true, T0)).state;
    s = ok(startHand(s, T0, seeded(3))).state;
    expect(s.seats[2].status).to.equal('waiting');
    expect(s.seats[2].hole).to.deep.equal([]);
    expect(s.seats[0].hole).to.have.length(2);
  });
});

describe('poker game: blinds and positions', () => {
  it('heads-up: the button posts the small blind and acts first preflop, the big blind first postflop', () => {
    let s = mkTable([200, 200]);
    const r = ok(startHand(s, T0, seeded(1)));
    s = r.state;
    expect(s.button).to.equal(0);
    expect(s.seats[0].bet).to.equal(1);
    expect(s.seats[1].bet).to.equal(2);
    expect(s.toAct).to.equal(0);
    expect(s.turnDeadline).to.equal(T0 + 60_000);
    const hs = r.events[0];
    expect(hs.type).to.equal('hand_started');
    expect(hs.smallBlind).to.deep.include({ userId: 'p0', amount: 1 });
    expect(hs.bigBlind).to.deep.include({ userId: 'p1', amount: 2 });
    s = play(s, [
      ['p0', 'call'],
      ['p1', 'check'],
    ]).state;
    expect(s.street).to.equal('flop');
    expect(s.board).to.have.length(3);
    expect(s.toAct).to.equal(1);
    expect(s.currentBet).to.equal(0);
  });

  it('three-handed: SB and BB are left of the button, UTG acts first', () => {
    const s = ok(startHand(mkTable([200, 200, 200]), T0, seeded(1))).state;
    expect(s.button).to.equal(0);
    expect(s.seats[1].bet).to.equal(1);
    expect(s.seats[2].bet).to.equal(2);
    expect(s.toAct).to.equal(0);
    expect(legalActions(s, 'p0')).to.include({ isTurn: true, callAmount: 2, canCheck: false });
    expect(legalActions(s, 'p1').isTurn).to.equal(false);
  });

  it('deals 2 hole cards in hold em and 4 in PLO, all distinct', () => {
    for (const [variant, n] of [
      ['holdem', 2],
      ['plo', 4],
    ]) {
      const s = ok(startHand(mkTable([200, 200, 200], { variant }), T0, seeded(5))).state;
      const cards = s.seats.slice(0, 3).flatMap((x) => x.hole);
      expect(cards).to.have.length(3 * n);
      expect(new Set(cards).size).to.equal(cards.length);
      expect(s.deck).to.have.length(52 - 3 * n);
    }
  });

  it('short stacks post what they can and go all-in on the blind', () => {
    // p0 button, p1 SB with 1 chip (posts 1 = all in), p2 BB with 1 (all in for less)
    // buy-in limits keep real stacks above the big blind, so shrink them directly.
    const s = structuredClone(mkTable([200, 200, 200]));
    s.seats[1].stack = 1;
    s.seats[2].stack = 1;
    const r = ok(startHand(s, T0, makeDeck('holdem', ['2c 3d', '4c 5d', '6c 7d'], '9h Th Jh Qh 8s')));
    expect(r.state.seats[1]).to.include({ stack: 0, bet: 1, status: 'allin' });
    expect(r.state.seats[2]).to.include({ stack: 0, bet: 1, status: 'allin' });
    expect(r.state.toAct).to.equal(0);
    expect(r.state.currentBet).to.equal(2);
    // p0 calls (clamped by nothing: 2 to call) then the board runs out
    const done = play(r.state, [['p0', 'call']]);
    expect(done.state.phase).to.equal('between');
    expect(totalChips(done.state)).to.equal(202);
  });

  it('button moves heads-up -> three-handed', () => {
    let s = mkTable([500, 500]);
    const rng = seeded(7);
    s = ok(startHand(s, T0, rng)).state;
    expect(s.button).to.equal(0);
    s = foldOut(s).state;
    s = ok(startHand(s, T0 + 1, rng)).state;
    expect(s.button).to.equal(1);
    expect(s.seats[1].bet).to.equal(1);
    s = foldOut(s).state;
    s = ok(sit(s, 'p2', 2, 500, T0)).state;
    s = ok(startHand(s, T0 + 2, rng)).state;
    expect(s.button).to.equal(2);
    expect(s.seats[0].bet).to.equal(1); // SB is left of the button
    expect(s.seats[1].bet).to.equal(2);
    expect(s.toAct).to.equal(2);
    s = foldOut(s).state;
    s = ok(startHand(s, T0 + 3, rng)).state;
    expect(s.button).to.equal(0);
  });

  it('blinds escalate after N hands', () => {
    let s = mkTable([5000, 5000, 5000], {
      blinds: '1/2,2/4,3/6',
      escalate: true,
      escalate_every: 2,
    });
    const rng = seeded(11);
    const seen = [];
    for (let h = 1; h <= 5; h++) {
      const r = ok(startHand(s, T0 + h, rng));
      seen.push({ ...r.state.blinds });
      const ups = ofType(r.events, 'blinds_up');
      if (h === 3) expect(ups).to.deep.equal([{ type: 'blinds_up', small: 2, big: 4, level: 1 }]);
      else if (h === 5) expect(ups).to.deep.equal([{ type: 'blinds_up', small: 3, big: 6, level: 2 }]);
      else expect(ups).to.deep.equal([]);
      s = foldOut(r.state).state;
    }
    expect(seen.map((b) => `${b.small}/${b.big}`)).to.deep.equal(['1/2', '1/2', '2/4', '2/4', '3/6']);
  });

  it('blinds stay fixed when escalate is off', () => {
    let s = mkTable([5000, 5000], { blinds: '1/2,2/4', escalate_every: 1 });
    const rng = seeded(1);
    for (let h = 0; h < 4; h++) {
      s = ok(startHand(s, T0, rng)).state;
      expect(s.blinds).to.deep.equal({ small: 1, big: 2 });
      s = foldOut(s).state;
    }
  });
});

describe('poker game: betting rules', () => {
  const threeWay = (stacks = [200, 200, 200], variant = 'holdem') =>
    ok(
      startHand(
        mkTable(stacks, { variant }),
        T0,
        makeDeck(
          variant,
          variant === 'plo' ? ['2c 3d 4h 5s', '2d 3h 4s 5c', '2h 3s 4c 5d'] : ['2c 3d', '4c 5d', '6c 7d'],
          '9h Th Jh Qh Ks',
        ),
      ),
    ).state;

  it('no-limit min raise is the last raise size, enforced server-side', () => {
    let s = threeWay();
    expect(legalActions(s, 'p0')).to.include({ canRaise: true, minRaiseTo: 4, maxRaiseTo: 200 });
    expect(act(s, 'p0', { type: 'raise', amount: 3 }, T0).error).to.match(/minimum raise is to \$4/);
    expect(act(s, 'p0', { type: 'raise', amount: 201 }, T0).error).to.be.a('string');
    expect(act(s, 'p0', { type: 'raise', amount: 5.5 }, T0).error).to.be.a('string');
    expect(act(s, 'p0', { type: 'raise' }, T0).error).to.be.a('string');
    s = play(s, [['p0', 'raise', 6]]).state;
    expect(s.currentBet).to.equal(6);
    expect(s.minRaise).to.equal(4);
    expect(legalActions(s, 'p1')).to.include({ minRaiseTo: 10, callAmount: 5 });
    expect(act(s, 'p1', { type: 'raise', amount: 9 }, T0).error).to.be.a('string');
    s = play(s, [['p1', 'raise', 10]]).state;
    expect(s.minRaise).to.equal(4);
    expect(legalActions(s, 'p2').minRaiseTo).to.equal(14);
    s = play(s, [['p2', 'raise', 25]]).state;
    expect(s.minRaise).to.equal(15);
    expect(legalActions(s, 'p0').minRaiseTo).to.equal(40);
  });

  it('a bet on a later street has a minimum of the big blind', () => {
    let s = threeWay();
    s = play(s, [
      ['p0', 'call'],
      ['p1', 'call'],
      ['p2', 'check'],
    ]).state;
    expect(s.street).to.equal('flop');
    expect(s.toAct).to.equal(1);
    expect(legalActions(s, 'p1')).to.include({ canCheck: true, callAmount: 0, minRaiseTo: 2 });
    const r = play(s, [['p1', 'raise', 2]]);
    expect(ofType(r.events, 'action')[0].action).to.equal('bet');
  });

  it('rejects out-of-turn actions and checking into a bet', () => {
    const s = threeWay();
    const before = JSON.stringify(s);
    expect(act(s, 'p1', { type: 'fold' }, T0).error).to.match(/not your turn/);
    expect(act(s, 'nobody', { type: 'fold' }, T0).error).to.match(/not seated/);
    expect(act(s, 'p0', { type: 'check' }, T0).error).to.match(/cannot check/);
    expect(act(s, 'p0', { type: 'jump' }, T0).error).to.match(/Unknown/);
    expect(act(s, 'p0', null, T0).error).to.be.a('string');
    expect(JSON.stringify(s)).to.equal(before);
    expect(act(mkTable([200, 200]), 'p0', { type: 'fold' }, T0).error).to.match(/no hand/);
  });

  it('does not mutate its input state', () => {
    const s = threeWay();
    const frozen = JSON.stringify(s);
    ok(act(s, 'p0', { type: 'raise', amount: 10 }, T0));
    expect(JSON.stringify(s)).to.equal(frozen);
  });

  it('a short all-in raise does not reopen betting for players who already acted', () => {
    let s = threeWay([200, 200, 30]);
    s = play(s, [
      ['p0', 'raise', 20],
      ['p1', 'call'],
      ['p2', 'allin'],
    ]).state;
    expect(s.currentBet).to.equal(30);
    expect(s.minRaise).to.equal(18);
    expect(s.toAct).to.equal(0);
    expect(legalActions(s, 'p0')).to.include({ canRaise: false, callAmount: 10 });
    expect(act(s, 'p0', { type: 'raise', amount: 100 }, T0).error).to.be.a('string');
    expect(act(s, 'p0', { type: 'allin' }, T0).error).to.match(/call or fold/);
    s = play(s, [['p0', 'call']]).state;
    expect(legalActions(s, 'p1')).to.include({ canRaise: false, callAmount: 10 });
    s = play(s, [['p1', 'call']]).state;
    expect(s.street).to.equal('flop');
    expect(s.toAct).to.equal(1);
  });

  it('a full all-in raise does reopen betting', () => {
    let s = threeWay([200, 200, 40]);
    s = play(s, [
      ['p0', 'raise', 20],
      ['p1', 'call'],
      ['p2', 'allin'],
    ]).state;
    expect(s.currentBet).to.equal(40);
    expect(s.minRaise).to.equal(20);
    expect(legalActions(s, 'p0')).to.include({ canRaise: true, minRaiseTo: 60, callAmount: 20 });
    s = play(s, [['p0', 'raise', 60]]).state;
    expect(legalActions(s, 'p1')).to.include({ canRaise: true, minRaiseTo: 80 });
  });

  it('cumulative short all-ins that add up to a full raise reopen betting', () => {
    // 4 handed: p0 raises to 20 (size 18), p1 calls, then two short all-ins.
    let s = ok(startHand(mkTable([300, 300, 300, 300]), T0, seeded(1))).state;
    s.seats[2].stack = 28; // BB 2 + 28 = 30 total
    s.seats[3].stack = 29; // UTG... recalibrate below
    s = ok(startHand(mkTable([300, 300, 300, 300]), T0, seeded(1))).state;
    // button 0, SB p1, BB p2, UTG p3
    expect(s.toAct).to.equal(3);
    s = play(s, [['p3', 'raise', 20]]).state;
    // shrink p0 and p1 to force short all-ins deterministically
    s.seats[0].stack = 25; // all-in total 25 (size 5)
    s.seats[1].stack = 20; // SB posted 1, all-in total 21? (bet 1 + 20)
    s = play(s, [['p0', 'allin']]).state;
    expect(s.currentBet).to.equal(25);
    expect(s.minRaise).to.equal(18);
    s = play(s, [['p1', 'allin']]).state; // total 21 < 25: just a call-ish all-in
    expect(s.currentBet).to.equal(25);
    s = play(s, [['p2', 'call']]).state;
    // p3 raised to 20 and faces only +5: closed
    expect(legalActions(s, 'p3').canRaise).to.equal(false);
  });

  it('PLO pot-limit caps the raise at the pot after calling', () => {
    let s = threeWay([500, 500, 500], 'plo');
    // pot 3, to call 2 -> raise to at most 2 + 3 + 2 = 7
    expect(legalActions(s, 'p0')).to.include({ canRaise: true, minRaiseTo: 4, maxRaiseTo: 7 });
    expect(act(s, 'p0', { type: 'raise', amount: 8 }, T0).error).to.match(/Pot limit/);
    expect(act(s, 'p0', { type: 'allin' }, T0).error).to.match(/Pot limit/);
    expect(legalActions(s, 'p0').canAllIn).to.equal(false);
    s = play(s, [['p0', 'raise', 7]]).state;
    // pot 1+2+7 = 10, SB owes 6 -> 7 + 10 + 6 = 23
    expect(legalActions(s, 'p1')).to.include({ maxRaiseTo: 23, minRaiseTo: 12, callAmount: 6 });
    s = play(s, [['p1', 'raise', 23]]).state;
    // pot 2+7+23 = 32, BB owes 21 -> 23 + 32 + 21 = 76
    expect(legalActions(s, 'p2').maxRaiseTo).to.equal(76);
    // a short stack may still shove when that is under the cap
    const s2 = threeWay([500, 500, 5], 'plo');
    s2.seats[2].stack = 3;
    const r = play(s2, [['p0', 'raise', 4]]);
    expect(legalActions(r.state, 'p1').isTurn).to.equal(true);
  });

  it('PLO allows an all-in that is within the pot limit', () => {
    let s = threeWay([500, 500, 500], 'plo');
    s.seats[0].stack = 6;
    expect(legalActions(s, 'p0')).to.include({ canAllIn: true, maxRaiseTo: 6 });
    s = play(s, [['p0', 'allin']]).state;
    expect(s.currentBet).to.equal(6);
  });

  it('call is clamped to the stack and becomes an all-in', () => {
    let s = threeWay([200, 200, 200]);
    s.seats[0].stack = 5;
    const r = play(s, [['p0', 'raise', 4]]);
    s = r.state;
    s = play(s, [['p1', 'raise', 100]]).state;
    s = play(s, [['p2', 'fold']]).state;
    const c = play(s, [['p0', 'call']]);
    expect(legalActions(s, 'p0').callAmount).to.equal(1); // 5 stack - 4 bet = 1 left
    expect(ofType(c.events, 'action')[0]).to.include({ action: 'allin', amount: 1 });
  });

  it('a lone active player facing all-in opponents can only call', () => {
    let s = threeWay([200, 200, 30]);
    s = play(s, [
      ['p0', 'call'],
      ['p1', 'call'],
      ['p2', 'allin'],
    ]).state;
    // p0, p1 face 28 more each; both still active, so raising is legal for p0
    expect(legalActions(s, 'p0').canRaise).to.equal(true);
    s = play(s, [
      ['p0', 'call'],
      ['p1', 'call'],
    ]).state;
    s = play(s, [['p1', 'raise', 10]]).state;
    // p0 is the only opponent and has chips: can raise
    expect(legalActions(s, 'p0').canRaise).to.equal(true);
    s = play(s, [['p0', 'fold']]).state;
    expect(s.phase).to.equal('between');
  });
});

describe('poker game: hand resolution', () => {
  it('everyone folds to one player: uncontested, no showdown, no reveal', () => {
    let s = ok(startHand(mkTable([200, 200, 200]), T0, seeded(4))).state;
    const r = play(s, [
      ['p0', 'raise', 10],
      ['p1', 'fold'],
      ['p2', 'fold'],
    ]);
    s = r.state;
    expect(s.phase).to.equal('between');
    expect(ofType(r.events, 'showdown')).to.have.length(0);
    expect(ofType(r.events, 'reveal')).to.have.length(0);
    const res = ofType(r.events, 'results')[0];
    expect(res.showdown).to.equal(false);
    expect(res.results).to.deep.equal([
      { userId: 'p0', won: 13, net: 3, handName: null, cards: null },
    ]);
    expect(s.lastHand).to.deep.include({ handNumber: 1, showdown: false, pot: 13 });
    expect(stackOf(s, 'p0')).to.equal(203);
    expect(stackOf(s, 'p1')).to.equal(199);
    expect(stackOf(s, 'p2')).to.equal(198);
    expect(s.seats.every((x) => !x || x.hole.length === 0)).to.equal(true);
    expect(s.deck).to.deep.equal([]);
    expect(s.nextHandAt).to.equal(T0 + NEXT_HAND_DELAY_MS);
    expect(s.toAct).to.equal(null);
    expect(s.turnDeadline).to.equal(null);
  });

  it('check-around reaches showdown and reveals hands', () => {
    const deck = makeDeck('holdem', ['2c 3d', 'As Ah'], '9h Th 4c Qh Ks');
    let s = ok(startHand(mkTable([200, 200]), T0, deck)).state;
    // deal order: p1 (left of the button p0) first
    expect(s.seats[1].hole).to.deep.equal(['2c', '3d']);
    expect(s.seats[0].hole).to.deep.equal(['As', 'Ah']);
    const steps = [['p0', 'call'], ['p1', 'check']];
    for (let street = 0; street < 3; street++) steps.push(['p1', 'check'], ['p0', 'check']);
    const r = play(s, steps);
    s = r.state;
    expect(s.phase).to.equal('between');
    expect(ofType(r.events, 'street').map((e) => e.street)).to.deep.equal(['flop', 'turn', 'river']);
    const sd = ofType(r.events, 'showdown')[0];
    expect(sd.hands.map((h) => h.userId).sort()).to.deep.equal(['p0', 'p1']);
    expect(s.lastHand.showdown).to.equal(true);
    expect(s.lastHand.board).to.have.length(5);
    expect(s.lastHand.results.find((x) => x.userId === 'p1')).to.deep.include({ won: 0, net: -2 });
    expect(s.lastHand.results.find((x) => x.userId === 'p0')).to.deep.include({ won: 4, net: 2 });
    expect(s.lastHand.results[0].handName).to.be.a('string');
  });

  it('three-way all-in: two side pots and a folded contributor', () => {
    const deck = makeDeck(
      'holdem',
      ['Ks Kh', '5c 4d', 'Qs Qh', 'As Ah'], // p1, p2, p3, p0 (deal order from the button)
      '2c 7d 9h 3s 8d',
    );
    let s = mkTable([50, 100, 200, 200]);
    s = ok(startHand(s, T0, deck)).state;
    const r = play(s, [
      ['p3', 'raise', 30],
      ['p0', 'allin'],
      ['p1', 'allin'],
      ['p2', 'fold'],
      ['p3', 'call'],
    ]);
    s = r.state;
    expect(ofType(r.events, 'reveal')).to.have.length(1);
    const sd = ofType(r.events, 'showdown')[0];
    expect(sd.pots).to.deep.equal([
      { amount: 152, eligible: ['p0', 'p1', 'p3'], winners: ['p0'] },
      { amount: 100, eligible: ['p1', 'p3'], winners: ['p1'] },
    ]);
    expect(stackOf(s, 'p0')).to.equal(152);
    expect(stackOf(s, 'p1')).to.equal(100);
    expect(stackOf(s, 'p2')).to.equal(198);
    expect(stackOf(s, 'p3')).to.equal(100);
    expect(totalChips(s)).to.equal(550);
    expect(ofType(r.events, 'uncalled')).to.have.length(0);
  });

  it('splits a pot evenly and gives the odd chip to the first winner left of the button', () => {
    const deck = makeDeck('holdem', ['9s 9d', '2c 3d', '4c 5d'], 'Ah Kh Qh Jh Th');
    let s = ok(startHand(mkTable([200, 200, 200]), T0, deck)).state;
    const steps = [['p0', 'call'], ['p1', 'fold'], ['p2', 'check']];
    for (let street = 0; street < 3; street++) steps.push(['p2', 'check'], ['p0', 'check']);
    const r = play(s, steps);
    s = r.state;
    // pot = 1 + 2 + 2 = 5, split between p2 and p0; p2 is first left of the button
    expect(stackOf(s, 'p2')).to.equal(201); // 198 + 3
    expect(stackOf(s, 'p0')).to.equal(200); // 198 + 2
    expect(stackOf(s, 'p1')).to.equal(199);
    expect(ofType(r.events, 'showdown')[0].pots[0].winners).to.deep.equal(['p2', 'p0']);
    expect(totalChips(s)).to.equal(600);
  });

  const uncalledHand = (aaTo) => {
    const holes = aaTo === 'p0' ? ['Ks Kh', 'As Ah'] : ['As Ah', 'Ks Kh']; // [p1, p0]
    const deck = makeDeck('holdem', holes, '2c 7d 9h 3s 8d');
    let s = mkTable([40, 500]);
    s = ok(startHand(s, T0, deck)).state;
    return play(s, [
      ['p0', 'call'],
      ['p1', 'check'],
      ['p1', 'raise', 50],
      ['p0', 'call'],
    ]);
  };

  it('returns the uncalled part of a bet', () => {
    const r = uncalledHand('p0');
    expect(ofType(r.events, 'uncalled')).to.deep.equal([{ type: 'uncalled', userId: 'p1', amount: 12 }]);
    expect(ofType(r.events, 'action').at(-1)).to.include({ action: 'allin', amount: 38 });
    expect(stackOf(r.state, 'p0')).to.equal(80);
    expect(stackOf(r.state, 'p1')).to.equal(460);
    expect(r.state.lastHand.pot).to.equal(80);
  });

  it('busted players lose their seat and the DO is told', () => {
    const r = uncalledHand('p1');
    expect(ofType(r.events, 'busted')).to.deep.equal([{ type: 'busted', userId: 'p0', buyIns: 40 }]);
    expect(r.state.seats[0]).to.equal(null);
    expect(stackOf(r.state, 'p1')).to.equal(540);
    expect(r.state.nextHandAt).to.equal(null);
    expect(canStartHand(r.state)).to.equal(false);
  });

  it('skips betting when only one player can still bet', () => {
    const deck = makeDeck('holdem', ['2c 3d', 'As Ah', '4c 5d'], '9h Th 7d Qh Ks');
    let s = mkTable([200, 30, 200]);
    s = ok(startHand(s, T0, deck)).state;
    const r = play(s, [
      ['p0', 'call'],
      ['p1', 'allin'],
      ['p2', 'call'],
      ['p0', 'call'],
    ]);
    // p2 and p0 are active vs an all-in p1: they still bet on later streets
    expect(r.state.street).to.equal('flop');
    expect(r.state.toAct).to.equal(2);
  });
});

describe('poker game: timers, sitting out, leaving, rebuy, close', () => {
  const lowKey = () => ok(startHand(mkTable([200, 200, 200]), T0, seeded(9))).state;

  it('timeout auto-folds when facing a bet and only after the deadline', () => {
    let s = lowKey();
    expect(timeout(s, T0 + 59_999).error).to.be.a('string');
    const r = ok(timeout(s, T0 + 60_000));
    const a = ofType(r.events, 'action')[0];
    expect(a).to.include({ userId: 'p0', action: 'fold', auto: 'timeout' });
    expect(r.state.seats[0].status).to.equal('folded');
    expect(r.state.seats[0].timeouts).to.equal(1);
    expect(r.state.toAct).to.equal(1);
    expect(r.state.turnDeadline).to.equal(T0 + 120_000);
    expect(timeout(mkTable([200, 200]), T0).error).to.be.a('string');
  });

  it('timeout auto-checks when checking is free', () => {
    let s = lowKey();
    s = play(s, [['p0', 'call'], ['p1', 'call']]).state;
    expect(s.toAct).to.equal(2);
    const r = ok(timeout(s, T0 + 100_000));
    expect(ofType(r.events, 'action')[0]).to.include({ userId: 'p2', action: 'check', auto: 'timeout' });
    expect(r.state.street).to.equal('flop');
  });

  it('two consecutive timeouts sit the player out; a real action resets the count', () => {
    let s = lowKey();
    s = ok(timeout(s, T0 + 60_000)).state; // p0 folds
    s = play(s, [['p1', 'fold']]).state; // hand over
    expect(s.seats[0].timeouts).to.equal(1);
    s = ok(startHand(s, T0 + 70_000, seeded(10))).state; // button p1, SB p2, BB p0
    s = play(s, [['p1', 'call'], ['p2', 'call']], T0 + 70_000).state;
    expect(s.toAct).to.equal(0);
    const r = ok(timeout(s, T0 + 200_000));
    expect(ofType(r.events, 'action')[0]).to.include({ userId: 'p0', action: 'check', auto: 'timeout' });
    expect(ofType(r.events, 'sitting_out')).to.deep.equal([
      { type: 'sitting_out', userId: 'p0', value: true, reason: 'timeouts' },
    ]);
    expect(r.state.seats[0].sittingOut).to.equal(true);

    // a real action in between resets it
    let t = lowKey();
    t = ok(timeout(t, T0 + 60_000)).state;
    t = play(t, [['p1', 'fold']]).state;
    t = ok(startHand(t, T0 + 70_000, seeded(10))).state;
    t = play(t, [['p1', 'call'], ['p2', 'call'], ['p0', 'check']], T0 + 70_000).state;
    expect(t.seats[0].timeouts).to.equal(0);
    expect(t.seats[0].sittingOut).to.equal(false);
  });

  it('a sitting-out player is auto-checked or folded when action reaches them mid-hand', () => {
    let s = lowKey();
    s = ok(setSittingOut(s, 'p1', true, T0)).state; // p1 is SB in the hand, not yet to act
    const r = play(s, [['p0', 'call']]);
    const auto = ofType(r.events, 'action').find((e) => e.userId === 'p1');
    expect(auto).to.include({ action: 'fold', auto: 'sitout' });
    // sitting in again resets the timeout streak
    const back = ok(setSittingOut(r.state, 'p1', false, T0)).state;
    expect(back.seats[1].timeouts).to.equal(0);
    expect(setSittingOut(back, 'p1', false, T0).error).to.be.a('string');
  });

  it('setSittingOut on the player whose turn it is acts for them immediately', () => {
    let s = lowKey();
    const r = ok(setSittingOut(s, 'p0', true, T0 + 5));
    expect(ofType(r.events, 'action')[0]).to.include({ userId: 'p0', action: 'fold', auto: 'sitout' });
    expect(r.state.toAct).to.equal(1);
  });

  it('leaving mid-hand: auto-fold when action arrives, cash-out after the hand', () => {
    let s = lowKey();
    const l = ok(leave(s, 'p1', T0));
    expect(l.events).to.deep.equal([{ type: 'leaving', userId: 'p1' }]);
    expect(l.state.seats[1].leaving).to.equal(true);
    expect(leave(l.state, 'p1', T0).error).to.match(/already/);
    const r = play(l.state, [
      ['p0', 'raise', 6],
      ['p2', 'fold'],
    ]);
    const auto = ofType(r.events, 'action').find((e) => e.userId === 'p1');
    expect(auto).to.include({ action: 'fold', auto: 'leave' });
    expect(ofType(r.events, 'cashout')).to.deep.equal([
      { type: 'cashout', userId: 'p1', amount: 199, buyIns: 200, reason: 'leave' },
    ]);
    expect(r.state.seats[1]).to.equal(null);
    expect(totalChips(r.state)).to.equal(401);
  });

  it('leaving on your own turn folds you at once', () => {
    const s = lowKey();
    const r = ok(leave(s, 'p0', T0));
    expect(ofType(r.events, 'action')[0]).to.include({ userId: 'p0', action: 'fold', auto: 'leave' });
    expect(r.state.toAct).to.equal(1);
  });

  it('leaving between hands cashes out immediately; unseated players cannot leave', () => {
    let s = mkTable([200, 300, 400]);
    const r = ok(leave(s, 'p1', T0));
    expect(r.events).to.deep.equal([
      { type: 'cashout', userId: 'p1', amount: 300, buyIns: 300, reason: 'leave' },
    ]);
    expect(r.state.seats[1]).to.equal(null);
    expect(leave(r.state, 'zzz', T0).error).to.match(/not seated/);
  });

  it('a waiting (not dealt in) player leaves at once even mid-hand', () => {
    let s = lowKey();
    s = ok(sit(s, 'late', undefined, 250, T0)).state;
    const r = ok(leave(s, 'late', T0));
    expect(r.events[0]).to.include({ type: 'cashout', amount: 250 });
  });

  it('rebuy rules', () => {
    let s = mkTable([], { buyin: 500, buyin_min: 100, buyin_max: 500, max_rebuys: 1 });
    s = ok(sit(s, 'a', undefined, 500, T0)).state;
    s = ok(sit(s, 'b', undefined, 500, T0)).state;
    expect(rebuy(s, 'a', 100, T0).error).to.match(/below \$100/);
    s.seats[0].stack = 50;
    expect(rebuy(s, 'nobody', 100, T0).error).to.match(/not seated/);
    expect(rebuy(s, 'a', 20, T0).error).to.match(/between \$100 and \$500/);
    expect(rebuy(s, 'a', 451, T0).error).to.be.a('string');
    expect(rebuy(s, 'a', 0, T0).error).to.be.a('string');
    const r = ok(rebuy(s, 'a', 200, T0));
    expect(r.events).to.deep.equal([{ type: 'rebuy', userId: 'a', amount: 200, buyIns: 700 }]);
    expect(r.state.seats[0]).to.include({ stack: 250, rebuys: 1, buyIns: 700 });
    const poor = structuredClone(r.state);
    poor.seats[0].stack = 10;
    expect(rebuy(poor, 'a', 100, T0).error).to.match(/all your rebuys/);
    // mid-hand
    let h = ok(startHand(s, T0, seeded(1))).state;
    expect(rebuy(h, 'a', 100, T0).error).to.match(/between hands/);
    // rebuys off
    const off = mkTable([], { buyin: 500, buyin_min: 100, rebuys: false });
    let o = ok(sit(off, 'a', undefined, 500, T0)).state;
    o.seats[0].stack = 10;
    expect(rebuy(o, 'a', 100, T0).error).to.match(/off/);
  });

  it('close() cashes everyone out and closes the table', () => {
    const s = mkTable([200, 300]);
    const r = ok(close(s, T0 + 5));
    expect(r.state.phase).to.equal('closed');
    expect(ofType(r.events, 'cashout').map((e) => [e.userId, e.amount, e.buyIns, e.reason])).to.deep.equal([
      ['p0', 200, 200, 'closed'],
      ['p1', 300, 300, 'closed'],
    ]);
    expect(r.events.at(-1)).to.deep.equal({ type: 'closed' });
    expect(r.state.seats.every((x) => x === null)).to.equal(true);
    expect(close(r.state, T0).error).to.be.a('string');
    expect(sit(r.state, 'x', undefined, 500, T0).error).to.match(/closed/);
    expect(startHand(r.state, T0).error).to.be.a('string');
  });

  it('close() mid-hand refunds the bets', () => {
    let s = ok(startHand(mkTable([200, 200, 200]), T0, seeded(1))).state;
    s = play(s, [['p0', 'raise', 20]]).state;
    const r = ok(close(s, T0));
    expect(ofType(r.events, 'hand_aborted')).to.have.length(1);
    expect(ofType(r.events, 'cashout').map((e) => e.amount)).to.deep.equal([200, 200, 200]);
    expect(r.state.board).to.deep.equal([]);
  });
});

describe('poker game: side pot builder', () => {
  it('builds main and side pots from contributions', () => {
    expect(
      buildSidePots([
        { id: 'a', committed: 50, folded: false },
        { id: 'b', committed: 100, folded: false },
        { id: 'c', committed: 2, folded: true },
        { id: 'd', committed: 100, folded: false },
      ]),
    ).to.deep.equal([
      { amount: 152, eligible: ['a', 'b', 'd'] },
      { amount: 100, eligible: ['b', 'd'] },
    ]);
  });

  it('lets a folded over-contribution sit in the top pot', () => {
    expect(
      buildSidePots([
        { id: 'a', committed: 30, folded: false },
        { id: 'b', committed: 80, folded: true },
        { id: 'c', committed: 60, folded: false },
      ]),
    ).to.deep.equal([
      { amount: 90, eligible: ['a', 'c'] },
      { amount: 80, eligible: ['c'] },
    ]);
  });

  it('handles empty input', () => {
    expect(buildSidePots([])).to.deep.equal([]);
  });
});

// ------------------------------------------------------------- simulation

describe('poker game: randomized simulation', function () {
  this.timeout(120_000);

  function pickAction(state, userId, rng) {
    const la = legalActions(state, userId);
    expect(la.isTurn).to.equal(true);
    const options = [];
    if (la.canCheck) options.push({ type: 'check' }, { type: 'check' });
    else options.push({ type: 'call' }, { type: 'call' }, { type: 'fold' });
    if (la.canCheck) options.push({ type: 'fold' });
    if (la.canRaise) {
      const span = la.maxRaiseTo - la.minRaiseTo;
      const r = rng();
      const amount =
        r < 0.4 ? la.minRaiseTo : r < 0.7 ? la.minRaiseTo + Math.floor(rng() * (span + 1)) : la.maxRaiseTo;
      options.push({ type: 'raise', amount });
      options.push({ type: 'raise', amount: Math.min(la.maxRaiseTo, la.minRaiseTo * 2) });
    }
    if (la.canAllIn) options.push({ type: 'allin' });
    return options[Math.floor(rng() * options.length)];
  }

  function checkInvariants(state, expectedTotal, cashed) {
    for (const s of state.seats) {
      if (!s) continue;
      expect(s.stack, 'stack').to.be.at.least(0);
      expect(s.bet).to.be.at.least(0);
      expect(s.committed).to.be.at.least(s.bet);
      expect(Number.isInteger(s.stack) && Number.isInteger(s.committed)).to.equal(true);
    }
    expect(totalChips(state) + cashed.total).to.equal(expectedTotal.total);
    if (state.phase === 'hand') {
      expect(potTotal(state)).to.be.at.least(0);
      const cards = [...state.board, ...state.deck, ...state.seats.flatMap((s) => (s ? s.hole : []))];
      expect(new Set(cards).size).to.equal(cards.length);
    }
  }

  it('conserves chips and always terminates over thousands of hands', () => {
    let hands = 0;
    let showdowns = 0;
    let uncontested = 0;
    for (let game = 0; game < 90; game++) {
      const rng = seeded(1000 + game);
      const variant = game % 2 ? 'plo' : 'holdem';
      const n = 2 + (game % 8);
      const cfgOpts = {
        variant,
        seats: Math.max(n, 2 + Math.floor(rng() * 8)),
        blinds: rng() < 0.5 ? '1/2' : '5/10,10/20,25/50',
        escalate: rng() < 0.5,
        escalate_every: 3,
        buyin: 400,
        buyin_min: 50,
        buyin_max: 2000,
        rebuys: true,
        timer: 30,
      };
      const { config, error } = parseTableConfig(cfgOpts);
      expect(error).to.equal(undefined);
      let state = newTable({ hostId: 'u0', channelId: 'c', guildId: null, config, now: 0 });
      const expectedTotal = { total: 0 };
      const cashed = { total: 0 };
      let now = 1000;
      let nextUser = 0;
      const buy = (state0) => {
        const amount = 50 + Math.floor(rng() * 1950);
        const r = sit(state0, `u${nextUser}`, undefined, amount, now);
        if (r.error) return state0;
        nextUser += 1;
        expectedTotal.total += amount;
        return r.state;
      };
      const absorb = (events) => {
        for (const e of events) {
          if (e.type === 'cashout') {
            cashed.total += e.amount;
            expect(e.buyIns).to.be.at.least(1);
          } else if (e.type === 'busted') {
            expect(e.buyIns).to.be.at.least(1);
          }
        }
      };
      for (let i = 0; i < n; i++) state = buy(state);
      checkInvariants(state, expectedTotal, cashed);

      for (let h = 0; h < 40; h++) {
        // random table housekeeping between hands
        for (const seat of state.seats) {
          if (!seat) continue;
          const x = rng();
          if (x < 0.05) {
            const r = leave(state, seat.userId, now);
            if (!r.error) {
              state = r.state;
              absorb(r.events);
            }
          } else if (x < 0.12) {
            const r = setSittingOut(state, seat.userId, !seat.sittingOut, now);
            if (!r.error) state = r.state;
          } else if (seat.stack < config.buyinMin && x < 0.8) {
            const amt = config.buyinMin - seat.stack + Math.floor(rng() * 300);
            const r = rebuy(state, seat.userId, amt, now);
            if (!r.error) {
              state = r.state;
              expectedTotal.total += amt;
            }
          }
        }
        while (state.seats.some((x) => x === null) && eligibleSeats(state).length < 2) state = buy(state);
        for (const seat of state.seats) {
          if (seat && seat.sittingOut && eligibleSeats(state).length < 2) {
            state = ok(setSittingOut(state, seat.userId, false, now)).state;
          }
        }
        if (!canStartHand(state)) continue;
        checkInvariants(state, expectedTotal, cashed);

        now += 5000;
        let res = startHand(state, now, rng);
        expect(res.error, res.error).to.equal(undefined);
        state = res.state;
        absorb(res.events);
        hands += 1;
        checkInvariants(state, expectedTotal, cashed);

        let steps = 0;
        while (state.phase === 'hand') {
          steps += 1;
          expect(steps, 'hand did not terminate').to.be.below(400);
          expect(state.toAct).to.be.a('number');
          const seat = state.seats[state.toAct];
          expect(seat.status).to.equal('active');
          now += 1000;
          const roll = rng();
          let txNow = now;
          if (roll < 0.04) {
            res = timeout(state, state.turnDeadline);
            expect(res.error, res.error).to.equal(undefined);
            txNow = state.turnDeadline;
          } else if (roll < 0.06) {
            const victim = state.seats.filter((x) => x && x.status !== 'waiting' && !x.leaving);
            const v = victim[Math.floor(rng() * victim.length)];
            if (!v) continue;
            res = leave(state, v.userId, now);
            expect(res.error, res.error).to.equal(undefined);
          } else if (roll < 0.08) {
            // an illegal out-of-turn action never changes anything
            const other = state.seats.find((x, i) => x && i !== state.toAct);
            const bad = act(state, other.userId, { type: 'fold' }, now);
            expect(bad.error).to.be.a('string');
            continue;
          } else {
            const action = pickAction(state, seat.userId, rng);
            res = act(state, seat.userId, action, now);
            expect(res.error, `${JSON.stringify(action)}: ${res.error}`).to.equal(undefined);
          }
          if (res.state.phase === 'hand' && res.state.turnDeadline !== state.turnDeadline) {
            expect(res.state.turnDeadline).to.equal(txNow + config.timer * 1000);
          }
          state = res.state;
          absorb(res.events);
          checkInvariants(state, expectedTotal, cashed);
        }

        expect(state.phase).to.equal('between');
        expect(state.seats.every((x) => !x || (x.committed === 0 && x.bet === 0 && x.hole.length === 0))).to.equal(true);
        const last = state.lastHand;
        expect(last.results.reduce((a, r) => a + r.won, 0)).to.equal(last.pot);
        for (const r of last.results) expect(r.won).to.be.at.least(0);
        if (last.showdown) showdowns += 1;
        else uncontested += 1;
        expect(state.seats.every((x) => !x || x.stack > 0)).to.equal(true);
      }

      const closed = ok(close(state, now));
      absorb(closed.events);
      expect(totalChips(closed.state)).to.equal(0);
      expect(cashed.total).to.equal(expectedTotal.total);
    }
    expect(hands).to.be.above(2500);
    expect(showdowns).to.be.above(200);
    expect(uncontested).to.be.above(200);
  });
});
