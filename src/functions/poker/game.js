// Poker table state machine (no-limit Hold'em / pot-limit Omaha). Pure: no I/O.
// Every transition takes a state and returns `{ state, events }` without
// mutating its input, or `{ error: string }` (no state change) when refused.
// Times are ms epoch numbers. `state.deck` and every `seat.hole` are secret:
// never send them to a client except through a per-viewer builder.
//
// STATE
//   state = {
//     config,                // from parseTableConfig (variant, mode, seats, buyin*, ladder, timer, ...)
//     phase,                 // 'lobby' (no hand yet) | 'between' | 'hand' | 'closed'
//     hostId, channelId, guildId, messageId: null,
//     seats,                 // Array(config.seats) of null | Seat
//     button,                // seat index of the dealer button, null before the first hand
//     handNumber,            // hands started so far (0 in the lobby)
//     blinds,                // { small, big } in force for the current/last hand (ladder[0] initially)
//     street,                // 'preflop'|'flop'|'turn'|'river' during a hand, else null
//     board,                 // community cards dealt so far (kept after the hand for display)
//     deck,                  // SECRET remaining deck; [] outside a hand
//     currentBet,            // highest bet on this street
//     minRaise,              // size of the last full raise (or the big blind) = minimum raise increment
//     toAct,                 // seat index whose turn it is, or null
//     turnDeadline,          // ms when toAct auto-acts, or null
//     nextHandAt,            // ms when the DO should auto-start the next hand (after a hand ends), or null
//     status,                // short text for the panel
//     lastHand,              // null | { handNumber, board, pot, showdown, results, pots }
//     updatedAt, startedAt,
//   }
//   Seat = {
//     userId, stack, bet (this street), committed (this hand, includes bet),
//     status: 'waiting'|'active'|'folded'|'allin'   // 'waiting' = not in the current hand
//     sittingOut, hole (SECRET), hasActed, timeouts (consecutive), rebuys,
//     buyIns (total chips bought, for net profit), leaving
//   }
//   Chips on the table = sum(stack) + sum(committed) (see totalChips). Cash-outs
//   remove chips from the table; busted seats hold 0.
//   lastHand.results = [{ userId, won, net, handName, cards }] (handName/cards are
//   null when the hand ended uncontested with no showdown); net = won - committed.
//   lastHand.pots = [{ amount, eligible: [userId], winners: [userId] }] (showdown only).
//
// EVENTS (all carry `type`; arrays of these are returned from every transition)
//   sit            { userId, seat, amount }
//   rebuy          { userId, amount, buyIns }
//   leaving        { userId }                       // leave requested mid-hand
//   sitting_out    { userId, value: bool, reason? } // reason 'timeouts' when automatic
//   hand_started   { handNumber, button, smallBlind: {userId, seat, amount},
//                    bigBlind: {userId, seat, amount}, blinds: {small, big}, players: [userId] }
//   blinds_up      { small, big, level }
//   action         { userId, seat, action: 'fold'|'check'|'call'|'bet'|'raise'|'allin',
//                    amount (chips added now), total (street bet after), stack, pot,
//                    auto: null|'timeout'|'leave'|'sitout' }
//   uncalled       { userId, amount }               // unmatched part of a bet returned
//   street         { street, board, cards }         // cards = the newly dealt ones
//   reveal         { players: [{ userId, cards }] } // all-in confrontation, before the run-out
//   showdown       { board, hands: [{ userId, cards, handName }], pots: [{ amount, eligible, winners }] }
//   results        { handNumber, pot, showdown: bool, board, results: [...] , winners: [userId] }
//   cashout        { userId, amount, buyIns, reason: 'leave'|'closed' }  // net = amount - buyIns
//   busted         { userId, buyIns }               // stack hit 0; seat freed (amount is 0)
//   hand_aborted   { }                              // close() during a hand: bets refunded
//   closed         { }

import { cryptoRng, newDeck, shuffle } from './cards.js';
import { evaluate, compareHands, handName } from './evaluate.js';
import { currentBlinds, ladderLevel } from './config.js';

export const NEXT_HAND_DELAY_MS = 5000;
export const MAX_CONSECUTIVE_TIMEOUTS = 2;
export const HOLE_COUNT = { holdem: 2, plo: 4 };

const STREETS = ['preflop', 'flop', 'turn', 'river'];

const clone = (state) => structuredClone(state);
const fail = (error) => ({ error });
const mention = (id) => `<@${id}>`;
const isInt = (n) => Number.isInteger(n) && Number.isSafeInteger(n);

const inHand = (s) => s && (s.status === 'active' || s.status === 'allin');
const seatIndex = (state, userId) => state.seats.findIndex((s) => s && s.userId === userId);
const inPlay = (state) => state.phase === 'hand';
const handIdle = (state) => state.phase === 'lobby' || state.phase === 'between';

/** Next seat index clockwise after `from` (null = before seat 0) matching pred, or null. */
function nextSeat(state, from, pred) {
  const n = state.seats.length;
  const start = from === null || from === undefined ? -1 : from;
  for (let k = 1; k <= n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (pred(i, state.seats[i])) return i;
  }
  return null;
}

/** Chips on the table: stacks plus everything committed to the current hand. */
export function totalChips(state) {
  let t = 0;
  for (const s of state.seats) if (s) t += s.stack + s.committed;
  return t;
}

/** Everything committed to the pot this hand (includes the current street's bets). */
export function potTotal(state) {
  let t = 0;
  for (const s of state.seats) if (s) t += s.committed;
  return t;
}

/** Players who would be dealt into the next hand. */
export function eligibleSeats(state) {
  const out = [];
  state.seats.forEach((s, i) => {
    if (s && !s.sittingOut && !s.leaving && s.stack > 0) out.push(i);
  });
  return out;
}

export function canStartHand(state) {
  return handIdle(state) && eligibleSeats(state).length >= 2;
}

export function newTable({ hostId, channelId, guildId = null, config, now }) {
  return {
    config,
    phase: 'lobby',
    hostId,
    channelId,
    guildId,
    messageId: null,
    seats: Array.from({ length: config.seats }, () => null),
    button: null,
    handNumber: 0,
    blinds: currentBlinds(config, 0),
    street: null,
    board: [],
    deck: [],
    currentBet: 0,
    minRaise: 0,
    toAct: null,
    turnDeadline: null,
    nextHandAt: null,
    status: 'Waiting for players to sit down.',
    lastHand: null,
    updatedAt: now,
    startedAt: now,
  };
}

// ---------------------------------------------------------------- seating

export function sit(state, userId, seatIdx, buyIn, now) {
  if (state.phase === 'closed') return fail('This table is closed.');
  if (seatIndex(state, userId) >= 0) return fail('You are already seated.');
  const { buyinMin, buyinMax } = state.config;
  if (!isInt(buyIn) || buyIn < buyinMin || buyIn > buyinMax) {
    return fail(
      buyinMin === buyinMax
        ? `The buy-in is $${buyinMin}.`
        : `The buy-in must be between $${buyinMin} and $${buyinMax}.`,
    );
  }
  const s = clone(state);
  let idx = seatIdx;
  if (idx === undefined || idx === null) {
    idx = s.seats.findIndex((x) => x === null);
    if (idx < 0) return fail('The table is full.');
  } else {
    if (!isInt(idx) || idx < 0 || idx >= s.seats.length) return fail('That seat does not exist.');
    if (s.seats[idx]) return fail('That seat is taken.');
  }
  s.seats[idx] = {
    userId,
    stack: buyIn,
    bet: 0,
    committed: 0,
    status: 'waiting',
    sittingOut: false,
    hole: [],
    hasActed: false,
    timeouts: 0,
    rebuys: 0,
    buyIns: buyIn,
    leaving: false,
  };
  s.updatedAt = now;
  fixNextHand(s, now);
  return { state: s, events: [{ type: 'sit', userId, seat: idx, amount: buyIn }] };
}

function cashOut(s, idx, reason, events) {
  const seat = s.seats[idx];
  events.push({ type: 'cashout', userId: seat.userId, amount: seat.stack, buyIns: seat.buyIns, reason });
  s.seats[idx] = null;
}

export function leave(state, userId, now) {
  const idx = seatIndex(state, userId);
  if (idx < 0) return fail('You are not seated at this table.');
  const s = clone(state);
  const events = [];
  const seat = s.seats[idx];
  s.updatedAt = now;
  if (inPlay(s) && seat.status !== 'waiting') {
    if (seat.leaving) return fail('You are already leaving after this hand.');
    seat.leaving = true;
    events.push({ type: 'leaving', userId });
    if (s.toAct === idx) {
      s.toAct = null;
      autoAct(s, idx, events, now, 'leave');
      advance(s, events, now, idx);
    }
    return { state: s, events };
  }
  cashOut(s, idx, 'leave', events);
  if (s.phase !== 'hand') fixNextHand(s, now);
  return { state: s, events };
}

export function rebuy(state, userId, amount, now) {
  const idx = seatIndex(state, userId);
  if (idx < 0) return fail('You are not seated at this table.');
  if (!handIdle(state)) return fail('You can only rebuy between hands.');
  const seat = state.seats[idx];
  const { config } = state;
  if (!config.rebuys) return fail('Rebuys are off at this table.');
  if (seat.stack >= config.buyinMin) {
    return fail(`You can rebuy only when your stack is below $${config.buyinMin}.`);
  }
  if (config.maxRebuys !== null && seat.rebuys >= config.maxRebuys) {
    return fail('You have used all your rebuys.');
  }
  if (!isInt(amount) || amount < 1) return fail('Enter a whole number of chips.');
  const after = seat.stack + amount;
  if (after < config.buyinMin || after > config.buyinMax) {
    return fail(
      `Your stack after the rebuy must be between $${config.buyinMin} and $${config.buyinMax}.`,
    );
  }
  const s = clone(state);
  const me = s.seats[idx];
  me.stack = after;
  me.rebuys += 1;
  me.buyIns += amount;
  s.updatedAt = now;
  fixNextHand(s, now);
  return { state: s, events: [{ type: 'rebuy', userId, amount, buyIns: me.buyIns }] };
}

export function setSittingOut(state, userId, value, now) {
  const idx = seatIndex(state, userId);
  if (idx < 0) return fail('You are not seated at this table.');
  if (state.phase === 'closed') return fail('This table is closed.');
  const flag = Boolean(value);
  if (state.seats[idx].sittingOut === flag) {
    return fail(flag ? 'You are already sitting out.' : 'You are already sitting in.');
  }
  const s = clone(state);
  const seat = s.seats[idx];
  seat.sittingOut = flag;
  if (!flag) seat.timeouts = 0;
  s.updatedAt = now;
  const events = [{ type: 'sitting_out', userId, value: flag }];
  if (flag && inPlay(s) && s.toAct === idx) {
    s.toAct = null;
    autoAct(s, idx, events, now, 'sitout');
    advance(s, events, now, idx);
  } else if (s.phase !== 'hand') {
    fixNextHand(s, now);
  }
  return { state: s, events };
}

/** Keep nextHandAt consistent with who is eligible (between hands only). */
function fixNextHand(s, now) {
  if (s.phase !== 'between') return;
  s.nextHandAt = eligibleSeats(s).length >= 2 ? (s.nextHandAt ?? now + NEXT_HAND_DELAY_MS) : null;
}

// --------------------------------------------------------------- starting

/**
 * Start a hand. `rng` is a () => [0,1) function, or an array of cards used as
 * the deck verbatim (dealt from the front: hole cards one at a time starting
 * left of the button, then flop/turn/river with no burns). Tests use the latter.
 */
export function startHand(state, now, rng = cryptoRng) {
  if (state.phase === 'closed') return fail('This table is closed.');
  if (state.phase === 'hand') return fail('A hand is already in progress.');
  const elig = eligibleSeats(state);
  if (elig.length < 2) return fail('At least two players with chips are needed.');
  const s = clone(state);
  const events = [];
  const { config } = s;

  const prevLevel = s.handNumber > 0 ? ladderLevel(config, s.handNumber - 1) : 0;
  s.handNumber += 1;
  const level = ladderLevel(config, s.handNumber - 1);
  s.blinds = currentBlinds(config, s.handNumber - 1);
  if (s.handNumber > 1 && level > prevLevel) {
    events.push({ type: 'blinds_up', small: s.blinds.small, big: s.blinds.big, level });
  }

  const isElig = (i) => elig.includes(i);
  s.button = nextSeat(s, s.button, isElig);
  const heads = elig.length === 2;
  const sbIdx = heads ? s.button : nextSeat(s, s.button, isElig);
  const bbIdx = nextSeat(s, sbIdx, isElig);

  s.seats.forEach((seat, i) => {
    if (!seat) return;
    seat.bet = 0;
    seat.committed = 0;
    seat.hasActed = false;
    seat.hole = [];
    seat.status = isElig(i) ? 'active' : 'waiting';
  });

  s.deck = Array.isArray(rng) ? [...rng] : shuffle(newDeck(), rng);
  const holeCount = HOLE_COUNT[config.variant];
  const order = [];
  let cur = s.button;
  for (let k = 0; k < elig.length; k++) {
    cur = nextSeat(s, cur, isElig);
    order.push(cur);
  }
  for (let r = 0; r < holeCount; r++) {
    for (const i of order) s.seats[i].hole.push(s.deck.shift());
  }

  const post = (i, blind) => {
    const seat = s.seats[i];
    const amt = Math.min(seat.stack, blind);
    put(seat, amt);
    return { userId: seat.userId, seat: i, amount: amt };
  };
  const sb = post(sbIdx, s.blinds.small);
  const bb = post(bbIdx, s.blinds.big);

  s.phase = 'hand';
  s.street = 'preflop';
  s.board = [];
  s.currentBet = s.blinds.big;
  s.minRaise = s.blinds.big;
  s.toAct = null;
  s.turnDeadline = null;
  s.nextHandAt = null;
  s.updatedAt = now;
  events.unshift({
    type: 'hand_started',
    handNumber: s.handNumber,
    button: s.button,
    smallBlind: sb,
    bigBlind: bb,
    blinds: { ...s.blinds },
    players: order.map((i) => s.seats[i].userId),
  });
  advance(s, events, now, bbIdx);
  return { state: s, events };
}

function put(seat, amt) {
  seat.stack -= amt;
  seat.bet += amt;
  seat.committed += amt;
  if (seat.stack === 0) seat.status = 'allin';
}

// ---------------------------------------------------------------- actions

/** Legal-move summary for a seat, computed against the current state. */
function legalFor(state, idx) {
  const none = {
    isTurn: false,
    canFold: false,
    canCheck: false,
    callAmount: 0,
    canRaise: false,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    canAllIn: false,
  };
  const seat = state.seats[idx];
  if (!inPlay(state) || state.toAct !== idx || !seat || seat.status !== 'active') return none;
  const toCall = state.currentBet - seat.bet;
  const callAmount = Math.min(toCall, seat.stack);
  const allInTotal = seat.bet + seat.stack;
  const opponents = state.seats.some((o, i) => i !== idx && o && o.status === 'active');
  const reopened = !seat.hasActed || state.currentBet - seat.bet >= state.minRaise;
  const canRaise = opponents && reopened && allInTotal > state.currentBet;
  let maxRaiseTo = allInTotal;
  if (state.config.variant === 'plo') {
    maxRaiseTo = Math.min(maxRaiseTo, state.currentBet + potTotal(state) + toCall);
  }
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);
  return {
    isTurn: true,
    canFold: true,
    canCheck: toCall === 0,
    callAmount,
    canRaise,
    minRaiseTo: canRaise ? minRaiseTo : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
    canAllIn: seat.stack > 0 && (seat.stack <= toCall || (canRaise && allInTotal <= maxRaiseTo)),
  };
}

/**
 * What the given player may do right now:
 * { isTurn, canFold, canCheck, callAmount, canRaise, minRaiseTo, maxRaiseTo, canAllIn }
 * Everything is false/0 when it is not their turn. callAmount is clamped to the stack.
 */
export function legalActions(state, userId) {
  const idx = seatIndex(state, userId);
  return legalFor(state, idx);
}

/** Mutates `s`. Returns an error string or null; pushes an 'action' event. */
function applyAction(s, idx, action, events, auto) {
  const seat = s.seats[idx];
  const legal = legalFor(s, idx);
  const toCall = s.currentBet - seat.bet;
  let kind = action.type;
  let target = null; // street total after a raise

  if (kind === 'check') {
    if (toCall > 0) return 'You cannot check, there is a bet to call.';
  } else if (kind === 'call') {
    if (toCall === 0) kind = 'check';
  } else if (kind === 'allin') {
    if (seat.stack <= toCall) {
      kind = 'call';
    } else {
      if (!legal.canRaise) return 'You can only call or fold here.';
      if (seat.bet + seat.stack > legal.maxRaiseTo) return 'Pot limit: you cannot bet that much.';
      target = seat.bet + seat.stack;
    }
  } else if (kind === 'raise') {
    if (!legal.canRaise) return 'You cannot raise here.';
    if (!isInt(action.amount)) return 'Enter a whole number of chips.';
    if (action.amount > legal.maxRaiseTo) {
      return s.config.variant === 'plo' && legal.maxRaiseTo < seat.bet + seat.stack
        ? `Pot limit: the most you can raise to is $${legal.maxRaiseTo}.`
        : `You only have $${seat.stack} behind (raise to at most $${legal.maxRaiseTo}).`;
    }
    if (action.amount < legal.minRaiseTo) {
      return `The minimum raise is to $${legal.minRaiseTo}.`;
    }
    target = action.amount;
  } else if (kind !== 'fold') {
    return 'Unknown action.';
  }

  let chips = 0;
  let label = kind;
  if (kind === 'fold') {
    seat.status = 'folded';
  } else if (kind === 'call') {
    chips = Math.min(toCall, seat.stack);
    put(seat, chips);
    if (seat.status === 'allin') label = 'allin';
  } else if (target !== null) {
    chips = target - seat.bet;
    const size = target - s.currentBet;
    label = action.type === 'allin' || target === seat.bet + seat.stack ? 'allin' : s.currentBet === 0 ? 'bet' : 'raise';
    put(seat, chips);
    if (size >= s.minRaise) s.minRaise = size;
    s.currentBet = target;
  }
  seat.hasActed = true;
  events.push({
    type: 'action',
    userId: seat.userId,
    seat: idx,
    action: label,
    amount: chips,
    total: seat.bet,
    stack: seat.stack,
    pot: potTotal(s),
    auto,
  });
  return null;
}

/** Fold if facing a bet (or always when `mode` is 'leave'), else check. */
function autoAct(s, idx, events, now, mode) {
  const seat = s.seats[idx];
  const facing = s.currentBet - seat.bet > 0;
  const type = mode === 'leave' || facing ? 'fold' : 'check';
  const auto = mode;
  applyAction(s, idx, { type }, events, auto);
}

export function act(state, userId, action, now) {
  if (!inPlay(state)) return fail('There is no hand in progress.');
  const idx = seatIndex(state, userId);
  if (idx < 0) return fail('You are not seated at this table.');
  if (state.toAct !== idx) return fail('It is not your turn.');
  if (!action || typeof action !== 'object') return fail('Unknown action.');
  const s = clone(state);
  const events = [];
  const err = applyAction(s, idx, action, events, null);
  if (err) return fail(err);
  s.seats[idx].timeouts = 0;
  s.toAct = null;
  s.turnDeadline = null;
  s.updatedAt = now;
  advance(s, events, now, idx);
  return { state: s, events };
}

/** Called by the alarm. No-op error unless the current turn has expired. */
export function timeout(state, now) {
  if (!inPlay(state) || state.toAct === null || state.turnDeadline === null) {
    return fail('No turn is running.');
  }
  if (now < state.turnDeadline) return fail('The turn has not timed out yet.');
  const s = clone(state);
  const events = [];
  const idx = s.toAct;
  const seat = s.seats[idx];
  s.toAct = null;
  s.turnDeadline = null;
  s.updatedAt = now;
  autoAct(s, idx, events, now, 'timeout');
  seat.timeouts += 1;
  if (seat.timeouts >= MAX_CONSECUTIVE_TIMEOUTS && !seat.sittingOut) {
    seat.sittingOut = true;
    events.push({ type: 'sitting_out', userId: seat.userId, value: true, reason: 'timeouts' });
  }
  advance(s, events, now, idx);
  return { state: s, events };
}

// ------------------------------------------------------------ hand engine

const liveIdx = (s) => s.seats.flatMap((x, i) => (inHand(x) ? [i] : []));

/** Next seat after `from` that still has to act this street. */
function nextNeeding(s, from) {
  const activeCount = s.seats.filter((x) => x && x.status === 'active').length;
  return nextSeat(s, from, (i, seat) => {
    if (!seat || seat.status !== 'active') return false;
    if (seat.bet < s.currentBet) return true;
    return !seat.hasActed && activeCount > 1;
  });
}

function advance(s, events, now, from) {
  for (let guard = 0; guard < 500; guard++) {
    if (liveIdx(s).length <= 1) return endUncontested(s, events, now);
    const next = nextNeeding(s, from);
    if (next === null) {
      if (endStreet(s, events, now)) return;
      from = s.button;
      continue;
    }
    const seat = s.seats[next];
    if (seat.leaving || seat.sittingOut) {
      s.toAct = next;
      autoAct(s, next, events, now, seat.leaving ? 'leave' : 'sitout');
      s.toAct = null;
      from = next;
      continue;
    }
    s.toAct = next;
    s.turnDeadline = now + s.config.timer * 1000;
    s.status = `${mention(seat.userId)} to act.`;
    return;
  }
  throw new Error('poker: betting loop did not terminate');
}

/** Return the unmatched part of the highest bet, then sweep bets into the pot. */
function collectBets(s, events) {
  let top = null;
  let topBet = 0;
  let second = 0;
  let ties = 0;
  s.seats.forEach((seat, i) => {
    if (!seat || seat.bet === 0) return;
    if (seat.bet > topBet) {
      second = topBet;
      topBet = seat.bet;
      top = i;
      ties = 1;
    } else if (seat.bet === topBet) {
      ties += 1;
      second = topBet;
    } else if (seat.bet > second) {
      second = seat.bet;
    }
  });
  if (top !== null && ties === 1 && topBet > second) {
    const seat = s.seats[top];
    const refund = topBet - second;
    seat.stack += refund;
    seat.bet -= refund;
    seat.committed -= refund;
    events.push({ type: 'uncalled', userId: seat.userId, amount: refund });
  }
  for (const seat of s.seats) if (seat) seat.bet = 0;
  s.currentBet = 0;
}

function dealStreet(s, events) {
  const next = STREETS[STREETS.indexOf(s.street) + 1];
  const count = next === 'flop' ? 3 : 1;
  const cards = s.deck.splice(0, count);
  s.board.push(...cards);
  s.street = next;
  events.push({ type: 'street', street: next, board: [...s.board], cards });
}

/** Returns true if the hand is over. */
function endStreet(s, events, now) {
  collectBets(s, events);
  s.toAct = null;
  s.turnDeadline = null;
  if (s.street === 'river') {
    showdown(s, events, now);
    return true;
  }
  const active = s.seats.filter((x) => x && x.status === 'active').length;
  if (active < 2) {
    const live = liveIdx(s);
    events.push({
      type: 'reveal',
      players: live.map((i) => ({ userId: s.seats[i].userId, cards: [...s.seats[i].hole] })),
    });
    while (s.street !== 'river') dealStreet(s, events);
    showdown(s, events, now);
    return true;
  }
  dealStreet(s, events);
  for (const seat of s.seats) if (seat) seat.hasActed = false;
  s.minRaise = s.blinds.big;
  return false;
}

/**
 * Split contributions into main/side pots.
 * contribs: [{ id, committed, folded }] -> [{ amount, eligible: [id] }]
 * Folded players' chips stay in the pots they fed but they cannot win them.
 */
export function buildSidePots(contribs) {
  const live = contribs.filter((c) => !c.folded && c.committed > 0);
  if (!live.length) return [];
  const levels = [...new Set(live.map((c) => c.committed))].sort((a, b) => a - b);
  const maxAll = Math.max(...contribs.map((c) => c.committed));
  const pots = [];
  let prev = 0;
  levels.forEach((level, k) => {
    // The top pot also absorbs any excess a folded player put in beyond every live player.
    const cap = k === levels.length - 1 ? Math.max(level, maxAll) : level;
    let amount = 0;
    for (const c of contribs) amount += Math.min(c.committed, cap) - Math.min(c.committed, prev);
    if (amount > 0) {
      pots.push({ amount, eligible: live.filter((c) => c.committed >= level).map((c) => c.id) });
    }
    prev = cap;
  });
  return pots;
}

function showdown(s, events, now) {
  const { variant } = s.config;
  const live = liveIdx(s);
  const order = [];
  let cur = s.button;
  for (let k = 0; k < s.seats.length; k++) {
    cur = nextSeat(s, cur, () => true);
    if (live.includes(cur)) order.push(cur);
  }
  const ranks = new Map();
  for (const i of live) ranks.set(i, evaluate(variant, s.seats[i].hole, s.board));

  const pots = buildSidePots(
    s.seats.flatMap((seat, i) => (seat && seat.committed > 0 ? [{ id: i, committed: seat.committed, folded: seat.status === 'folded' }] : [])),
  );
  const won = new Map(live.map((i) => [i, 0]));
  const potInfo = [];
  for (const pot of pots) {
    let best = null;
    let winners = [];
    for (const i of order) {
      if (!pot.eligible.includes(i)) continue;
      const c = best ? compareHands(ranks.get(i), best) : 1;
      if (c > 0) {
        best = ranks.get(i);
        winners = [i];
      } else if (c === 0) winners.push(i);
    }
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const w of winners) {
      let get = share;
      if (odd > 0) {
        get += 1;
        odd -= 1;
      }
      won.set(w, won.get(w) + get);
    }
    potInfo.push({
      amount: pot.amount,
      eligible: pot.eligible.map((i) => s.seats[i].userId),
      winners: winners.map((i) => s.seats[i].userId),
    });
  }
  events.push({
    type: 'showdown',
    board: [...s.board],
    hands: order.map((i) => ({
      userId: s.seats[i].userId,
      cards: [...s.seats[i].hole],
      handName: handName(ranks.get(i)),
    })),
    pots: potInfo,
  });
  const results = order.map((i) => ({
    userId: s.seats[i].userId,
    won: won.get(i),
    net: won.get(i) - s.seats[i].committed,
    handName: handName(ranks.get(i)),
    cards: [...s.seats[i].hole],
  }));
  finishHand(s, events, now, results, true, potInfo, won);
}

function endUncontested(s, events, now) {
  const [w] = liveIdx(s);
  const total = potTotal(s);
  const winner = s.seats[w];
  const results = [
    { userId: winner.userId, won: total, net: total - winner.committed, handName: null, cards: null },
  ];
  finishHand(s, events, now, results, false, [], new Map([[w, total]]));
}

/** Pay out `won` (seat index -> chips), record lastHand, free leavers and busted seats. */
function finishHand(s, events, now, results, wasShowdown, pots, won) {
  const pot = potTotal(s);
  for (const [i, amt] of won) s.seats[i].stack += amt;
  for (const seat of s.seats) if (seat) seat.committed = 0;
  s.lastHand = {
    handNumber: s.handNumber,
    board: [...s.board],
    pot,
    showdown: wasShowdown,
    results,
    pots,
  };
  events.push({
    type: 'results',
    handNumber: s.handNumber,
    pot,
    showdown: wasShowdown,
    board: [...s.board],
    results,
    winners: results.filter((r) => r.won > 0).map((r) => r.userId),
  });
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i];
    if (!seat) continue;
    seat.bet = 0;
    seat.hole = [];
    seat.hasActed = false;
    seat.status = 'waiting';
    if (seat.stack === 0) {
      events.push({ type: 'busted', userId: seat.userId, buyIns: seat.buyIns });
      s.seats[i] = null;
    } else if (seat.leaving) {
      cashOut(s, i, 'leave', events);
    }
  }
  s.phase = 'between';
  s.street = null;
  s.deck = [];
  s.currentBet = 0;
  s.minRaise = 0;
  s.toAct = null;
  s.turnDeadline = null;
  s.updatedAt = now;
  const winners = results.filter((r) => r.won > 0);
  const text = winners.map((r) => `${mention(r.userId)} wins $${r.won}`).join(', ');
  s.status = `Hand #${s.handNumber}: ${text}.`;
  s.nextHandAt = eligibleSeats(s).length >= 2 ? now + NEXT_HAND_DELAY_MS : null;
}

// ------------------------------------------------------------------ close

export function close(state, now) {
  if (state.phase === 'closed') return fail('This table is already closed.');
  const s = clone(state);
  const events = [];
  if (s.phase === 'hand') {
    for (const seat of s.seats) {
      if (!seat) continue;
      seat.stack += seat.committed;
      seat.committed = 0;
      seat.bet = 0;
      seat.hole = [];
      seat.status = 'waiting';
    }
    events.push({ type: 'hand_aborted' });
  }
  for (let i = 0; i < s.seats.length; i++) {
    if (s.seats[i]) cashOut(s, i, 'closed', events);
  }
  events.push({ type: 'closed' });
  Object.assign(s, {
    phase: 'closed',
    street: null,
    deck: [],
    board: s.phase === 'hand' ? [] : s.board,
    currentBet: 0,
    minRaise: 0,
    toAct: null,
    turnDeadline: null,
    nextHandAt: null,
    status: 'This table is closed.',
    updatedAt: now,
  });
  return { state: s, events };
}
