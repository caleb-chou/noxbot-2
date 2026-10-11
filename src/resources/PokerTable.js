// One Durable Object per channel ('poker:' + channelId) runs a poker table.
// Thin on purpose, like MindGame: load state, call the pure engine in
// functions/poker/game.js, save, re-arm the single alarm, answer.
//
// PRIVACY: the stored state holds the deck and every hole card. NO route ever
// returns it. Replies are built only from messages.js (tableMessage and
// showdownMessage are public, handMessage is the caller's own cards). There is
// deliberately no /state route, and nothing here logs state or events.
//
// Every route is POST JSON and answers HTTP 200 JSON:
//   { message?, modal?, ping?, showdown?, ephemeral?: true, info?, error? }
//
// Ranked money flow: sit/rebuy debit the bankroll BEFORE the table changes
// (refused when short). A debit intent is saved first and removed in the SAME
// atomic write that saves the seat, so a crash in between leaves an intent the
// alarm refunds (it re-applies the debit with the same opId, which is a no-op if
// it already happened, then credits it back). Cash-outs and busts append a credit to
// state.pendingCredits, saved atomically with the state, then each credit is
// applied through UserData /bankApply (idempotent opId) and removed. Every
// alarm retries whatever is still pending.
import {
  act,
  canStartHand,
  close,
  leave,
  newTable,
  rebuy,
  setSittingOut,
  sit,
  startHand,
  timeout,
} from '../functions/poker/game.js';
import {
  handMessage,
  raiseModal,
  showdownMessage,
  sitModal,
  tableMessage,
  turnPing,
} from '../functions/poker/messages.js';
import {
  PANEL_TOKEN,
  editPanel,
  postMessage,
  rememberToken,
} from '../functions/panel.js';

const GAME = 'game';
// Debits whose seat has not been saved yet. See debit() and repairIntents().
const INTENTS = 'debitIntents';
export const IDLE_MS = 30 * 60_000;
export const TOMBSTONE_MS = 24 * 60 * 60_000;
export const CREDIT_RETRY_MS = 30_000;
const LABEL = 'poker';

const reply = (body) => Response.json(body);
const fail = (error) => reply({ error });

/** Whole-number amount from a number or a string like "$1,200"; else null. */
export function parseAmount(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim().replace(/^\$/, '').replace(/,/g, '');
  return /^\d{1,12}$/.test(text) ? Number(text) : null;
}

export class PokerTable {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
    // Awaiting other DOs (bank) can let requests interleave, so a local queue
    // keeps every route atomic and ordered.
    this.queue = Promise.resolve();
    // Tests may set an array of cards (or an rng) to control the deal.
    this.rng = undefined;
  }

  fetch(request) {
    const run = this.queue.then(() => this.handle(request));
    this.queue = run.catch(() => {});
    return run;
  }

  async handle(request) {
    const { pathname } = new URL(request.url);
    const route = pathname.slice(1);
    const body =
      request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const now = Date.now();
    const table = await this.state.storage.get(GAME);

    if (route === 'table') {
      return this.create(table, body, now);
    }
    if (!table) {
      return fail('There is no poker table in this channel.');
    }

    if (route === 'setMessage') {
      const next = { ...table, messageId: body.messageId };
      await this.state.storage.put(GAME, next);
      await rememberToken(this.state.storage, body.token, now);
      return reply({ message: tableMessage(next) });
    }

    // A click carries the id of the message it sits on. Until /setMessage has
    // stored ours, no click can be told from a stale panel's: ask for a retry.
    if (body.messageId) {
      if (!table.messageId) {
        return fail('The table is still being set up. Try again in a moment.');
      }
      if (body.messageId !== table.messageId) {
        return fail('This table is closed. That message is out of date.');
      }
      await rememberToken(this.state.storage, body.token, now);
    }

    const { userId } = body;
    if (route === 'hand') {
      const message = handMessage(table, userId);
      return reply({ message, ephemeral: true });
    }
    if (table.phase === 'closed') {
      return fail('This table is closed.');
    }

    // A click that lands after the turn expired but before the alarm ran must
    // not get through: apply the timeout first, then answer with the new panel.
    if (
      ['fold', 'call', 'allin', 'raise', 'raiseModal'].includes(route) &&
      table.phase === 'hand' &&
      table.turnDeadline !== null &&
      now >= table.turnDeadline
    ) {
      return this.expireTurn(table, now);
    }

    switch (route) {
      case 'sitModal':
        return this.sitModalRoute(table, userId, now);
      case 'sit':
        return this.sitRoute(table, userId, body.buyIn, now);
      case 'rebuy':
        return this.rebuyRoute(table, userId, now);
      case 'raiseModal': {
        const modal = raiseModal(table, userId);
        return modal.type === 9 ? reply({ modal }) : fail(modal.content);
      }
      case 'leave':
        return this.finish(table, leave(table, userId, now), now);
      case 'sitout': {
        // The button carries no state: without an explicit value, toggle.
        const mine = table.seats.find((s) => s && s.userId === userId);
        const value =
          body.value === undefined ? !mine?.sittingOut : body.value !== false;
        return this.finish(table, setSittingOut(table, userId, value, now), now);
      }
      case 'start':
        return this.startRoute(table, userId, now);
      case 'fold':
        return this.finish(table, act(table, userId, { type: 'fold' }, now), now);
      case 'call':
        return this.finish(table, act(table, userId, { type: 'call' }, now), now);
      case 'allin':
        return this.finish(table, act(table, userId, { type: 'allin' }, now), now);
      case 'raise': {
        const amount = parseAmount(body.amount);
        if (amount === null) {
          return fail('Enter a whole number of chips.');
        }
        return this.finish(
          table,
          act(table, userId, { type: 'raise', amount }, now),
          now,
        );
      }
      case 'end':
        return this.endRoute(table, body, now);
      case 'bye':
        return this.bye(table, userId, now);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  // ------------------------------------------------------------------ routes

  async create(existing, body, now) {
    // A closed table's tombstone may be replaced; a live one may not.
    if (existing && existing.phase !== 'closed') {
      return fail('This channel already has a poker table.');
    }
    const { config, hostId, channelId } = body;
    if (!config || !hostId || !channelId) {
      return fail('Invalid table request.');
    }
    const fresh = {
      ...newTable({ hostId, channelId, guildId: body.guildId ?? null, config, now }),
      tableId: `${channelId}.${now}`,
      seq: 0,
      lastActionAt: now,
      closeAfterHand: false,
      session: {},
      // Credits still owed from the previous table are kept so they are retried.
      pendingCredits: existing?.pendingCredits ?? [],
    };
    const seated = await this.seat(fresh, hostId, config.buyin, undefined, now);
    if (seated.error) {
      return fail(seated.error);
    }
    await this.state.storage.delete(PANEL_TOKEN);
    return this.finish(fresh, seated, now);
  }

  async expireTurn(table, now) {
    const res = await this.finish(table, timeout(table, now), now, false);
    const out = await res.json();
    return reply({ ...out, info: 'That turn had already timed out.' });
  }

  async sitModalRoute(table, userId, now) {
    const modal = sitModal(table);
    if (modal) {
      return reply({ modal });
    }
    // Fixed buy-in: no input is needed, so sit straight away.
    return this.sitRoute(table, userId, table.config.buyin, now);
  }

  async sitRoute(table, userId, rawBuyIn, now) {
    const buyIn = parseAmount(rawBuyIn ?? table.config.buyin);
    if (buyIn === null) {
      return fail('Enter a whole number of chips.');
    }
    return this.finish(table, await this.seat(table, userId, buyIn, undefined, now), now);
  }

  async rebuyRoute(table, userId, now) {
    const seat = table.seats.find((s) => s && s.userId === userId);
    if (!seat) {
      return fail('You are not seated at this table.');
    }
    const amount = table.config.buyin - seat.stack;
    const result = rebuy(table, userId, amount, now);
    if (result.error) {
      return fail(result.error);
    }
    const debited = await this.debit(table, result, userId, amount);
    return debited.error ? fail(debited.error) : this.finish(table, result, now);
  }

  async startRoute(table, userId, now) {
    const seated = table.seats.some((s) => s && s.userId === userId);
    if (userId !== table.hostId && !seated) {
      return fail('Only the host or a seated player can start a hand.');
    }
    if (!canStartHand(table)) {
      return fail(
        table.phase === 'hand'
          ? 'A hand is already in progress.'
          : 'At least two players with chips are needed.',
      );
    }
    return this.finish(table, startHand(table, now, this.rng), now);
  }

  async endRoute(table, body, now) {
    if (!body.isAdmin && body.userId !== table.hostId) {
      return fail('Only the host or an admin can close the table.');
    }
    if (table.phase === 'hand') {
      const next = { ...table, closeAfterHand: true };
      const res = await this.finish(table, { state: next, events: [] }, now);
      const out = await res.json();
      return reply({
        ...out,
        info: 'The table will close after this hand and everyone will be cashed out.',
      });
    }
    const res = await this.finish(table, close(table, now), now);
    if (!body.messageId) {
      // A slash command: nothing redraws the panel for it.
      const out = await res.clone().json();
      await this.later(this.redraw(out.message));
    }
    return res;
  }

  async bye(table, userId, now) {
    return this.finish(table, leave(table, userId, now), now);
  }

  // ----------------------------------------------------------------- seating

  /** sit() plus the ranked debit. Returns the sit result or { error }. */
  async seat(table, userId, buyIn, seatIdx, now) {
    const result = sit(table, userId, seatIdx, buyIn, now);
    if (result.error) {
      return result;
    }
    const debited = await this.debit(table, result, userId, buyIn);
    return debited.error ? debited : result;
  }

  /**
   * Ranked only: take `amount` from the bankroll before the table changes.
   * Crash safety: an intent is stored first and finish() drops it in the same
   * atomic write as the new state. If anything fails in between, the intent
   * stays and repairIntents() refunds it.
   */
  async debit(table, result, userId, amount) {
    if (table.config.mode !== 'ranked') {
      return {};
    }
    const opId = `${table.tableId}:d${crypto.randomUUID()}`;
    const storage = this.state.storage;
    const intents = (await storage.get(INTENTS)) ?? [];
    await storage.put(INTENTS, [...intents, { opId, userId, amount, stage: 'debit' }]);
    await this.armRepair();
    const out = await this.bank(userId, { opId, delta: -amount });
    if (out.ok) {
      result.intentOp = opId;
      return {};
    }
    if (out.definite) {
      // Refused: nothing was taken, so there is nothing to refund.
      await this.dropIntent(opId);
    }
    if (out.error === 'Not enough bankroll.') {
      const rec = await this.bank(userId, {}, '/bankGet');
      const have = rec.ok && Number.isFinite(rec.balance) ? ` (you have $${rec.balance})` : '';
      return { error: `Not enough bankroll to buy in for $${amount}${have}.` };
    }
    return { error: 'The bank is unavailable right now. Try again in a moment.' };
  }

  async dropIntent(opId) {
    const storage = this.state.storage;
    const intents = (await storage.get(INTENTS)) ?? [];
    await storage.put(
      INTENTS,
      intents.filter((i) => i.opId !== opId),
    );
  }

  /** Make sure an alarm is due soon to repair an intent, without delaying an earlier one. */
  async armRepair() {
    const storage = this.state.storage;
    const at = Date.now() + CREDIT_RETRY_MS;
    const current = await storage.getAlarm?.();
    if (current === null || current === undefined || current > at) {
      await storage.setAlarm(at);
    }
  }

  /**
   * Refund every debit whose seat never got saved. Re-applying the debit with
   * the same opId is idempotent: it is skipped when it already happened and
   * applied (so the refund below is exact) when its response was lost.
   */
  async repairIntents() {
    const storage = this.state.storage;
    const intents = (await storage.get(INTENTS)) ?? [];
    if (intents.length === 0) {
      return;
    }
    const left = [];
    for (const intent of intents) {
      const { opId, userId, amount } = intent;
      if (intent.stage === 'debit') {
        const out = await this.bank(userId, { opId, delta: -amount });
        if (out.definite) {
          continue; // refused, so it was never applied
        }
        if (!out.ok) {
          left.push(intent);
          continue;
        }
      }
      const back = await this.bank(userId, { opId: `${opId}:refund`, delta: amount });
      if (!back.ok) {
        left.push({ ...intent, stage: 'refund' });
      }
    }
    await storage.put(INTENTS, left);
  }

  async bank(userId, payload, path = '/bankApply') {
    try {
      const ns = this.env.NOXBOT_DATA;
      const res = await ns.get(ns.idFromName(userId)).fetch(`https://dummy${path}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      // definite: the bank answered and refused, so nothing was applied.
      return { ...data, ok: res.ok, definite: !res.ok && res.status < 500 };
    } catch (err) {
      console.error(`${LABEL} bank call failed:`, err?.message);
      return { ok: false, error: 'unavailable' };
    }
  }

  // ------------------------------------------------------------------ commit

  /**
   * Apply an engine result: close after the hand if asked, queue ranked
   * credits, save, settle credits, re-arm the alarm, answer.
   */
  async finish(prev, result, now, human = true) {
    if (result.error) {
      return fail(result.error);
    }
    const { next, events } = this.settleState(prev, result, now, human);
    await this.save(next, result.intentOp);
    await this.payCredits(next);
    await this.arm(next, now);
    return reply(this.payload(prev, next, events));
  }

  /** Save the table; drops the resolved debit intent in the same atomic write. */
  async save(next, intentOp) {
    if (!intentOp) {
      await this.state.storage.put(GAME, next);
      return;
    }
    const intents = (await this.state.storage.get(INTENTS)) ?? [];
    await this.state.storage.put({
      [GAME]: next,
      [INTENTS]: intents.filter((i) => i.opId !== intentOp),
    });
  }

  /** Pure-ish bookkeeping shared by routes and the alarm. */
  settleState(prev, result, now, human) {
    let next = result.state;
    const events = [...result.events];
    if (next.closeAfterHand && next.phase === 'between') {
      const closed = close(next, now);
      next = { ...closed.state, closeAfterHand: false };
      events.push(...closed.events);
    }
    if (human) {
      next.lastActionAt = now;
    }
    if (next.config.mode === 'ranked') {
      this.queueCredits(next, events);
    }
    return { next, events };
  }

  /** Track per-session stats and turn cash-outs/busts into pending credits. */
  queueCredits(next, events) {
    const session = (next.session ??= {});
    const row = (id) => (session[id] ??= { hands: 0, handsWon: 0, biggestPot: 0 });
    for (const e of events) {
      if (e.type === 'hand_started') {
        for (const id of e.players) row(id).hands += 1;
      } else if (e.type === 'results') {
        for (const id of e.winners) {
          const r = row(id);
          r.handsWon += 1;
          r.biggestPot = Math.max(r.biggestPot, e.pot);
        }
      } else if (e.type === 'cashout' || e.type === 'busted') {
        const amount = e.type === 'cashout' ? e.amount : 0;
        const stats = session[e.userId] ?? { hands: 0, handsWon: 0, biggestPot: 0 };
        delete session[e.userId];
        next.seq = (next.seq ?? 0) + 1;
        next.pendingCredits = [
          ...(next.pendingCredits ?? []),
          {
            opId: `${next.tableId}:${next.seq}`,
            userId: e.userId,
            delta: amount,
            net: amount - e.buyIns,
            handsWon: stats.handsWon,
            biggestPot: stats.biggestPot,
            hands: stats.hands,
            attempts: 0,
          },
        ];
      }
    }
  }

  /** The reply body for a human request. Never contains hole cards. */
  payload(prev, next, events) {
    const out = { message: tableMessage(next) };
    if (events.some((e) => e.type === 'results')) {
      const showdown = showdownMessage(next);
      if (showdown) {
        out.showdown = showdown;
      }
    }
    const ping = this.pingFor(prev, next);
    if (ping) {
      out.ping = ping;
    }
    return out;
  }

  pingFor(prev, next) {
    if (
      !next.config.ping ||
      next.phase !== 'hand' ||
      next.toAct === null ||
      (prev && prev.toAct === next.toAct && prev.handNumber === next.handNumber)
    ) {
      return null;
    }
    return turnPing(next);
  }

  /** Apply each pending credit; keep the ones that fail for the next sweep. */
  async payCredits(next) {
    const pending = next.pendingCredits ?? [];
    if (pending.length === 0) {
      return;
    }
    const left = [];
    for (const credit of pending) {
      const { opId, userId, delta, net, handsWon, biggestPot } = credit;
      const out = await this.bank(userId, { opId, delta, net, handsWon, biggestPot });
      if (out.ok) {
        if (!out.duplicate) {
          await this.writeAggregate(credit);
        }
      } else {
        // Never drop a credit just because the bank has been down for a while:
        // that would destroy the player's chips. Keep retrying every sweep.
        left.push({ ...credit, attempts: credit.attempts + 1 });
        if (out.definite) {
          console.error(`${LABEL} bank refused credit ${opId}:`, out.error);
        }
      }
    }
    next.pendingCredits = left;
    await this.state.storage.put(GAME, next);
  }

  /** Ranked leaderboard: the 'poker' key of the UserData instance 'poker'. */
  async writeAggregate({ userId, net, biggestPot, hands }) {
    try {
      const ns = this.env.NOXBOT_DATA;
      const stub = ns.get(ns.idFromName('poker'));
      const all = await (await stub.fetch('https://dummy/get')).json();
      const aggregate = all.poker ?? {};
      const row = aggregate[userId] ?? { net: 0, biggestPot: 0, hands: 0 };
      aggregate[userId] = {
        net: row.net + net,
        biggestPot: Math.max(row.biggestPot, biggestPot),
        hands: row.hands + hands,
      };
      await stub.fetch('https://dummy/set', {
        method: 'POST',
        body: JSON.stringify({ poker: aggregate }),
      });
    } catch (err) {
      console.error(`${LABEL} leaderboard write failed:`, err?.message);
    }
  }

  // ------------------------------------------------------------------- alarm

  /** One alarm for the earliest of: turn deadline, next hand, idle, retries. */
  async arm(table, now) {
    const times = [];
    if (table.phase === 'closed') {
      times.push(table.updatedAt + TOMBSTONE_MS);
    } else {
      times.push(table.lastActionAt + IDLE_MS);
      if (table.phase === 'hand' && table.turnDeadline !== null) {
        times.push(table.turnDeadline);
      }
      if (table.nextHandAt !== null) {
        times.push(table.nextHandAt);
      }
    }
    const intents = (await this.state.storage.get(INTENTS)) ?? [];
    if ((table.pendingCredits ?? []).length > 0 || intents.length > 0) {
      times.push(now + CREDIT_RETRY_MS);
    }
    await this.state.storage.setAlarm(Math.min(...times));
  }

  // Runs behind the same queue as requests so it never interleaves with a
  // route that is awaiting the bank.
  alarm() {
    const run = this.queue.then(() => this.runAlarm());
    this.queue = run.catch(() => {});
    return run;
  }

  async runAlarm() {
    const storage = this.state.storage;
    await this.repairIntents();
    let table = await storage.get(GAME);
    if (!table) {
      return;
    }
    const now = Date.now();
    await this.payCredits(table);

    if (table.phase === 'closed') {
      if (
        now >= table.updatedAt + TOMBSTONE_MS &&
        (table.pendingCredits ?? []).length === 0
      ) {
        await storage.delete(GAME);
        return;
      }
      await this.arm(table, now);
      return;
    }

    const first = table;
    const events = [];
    for (let guard = 0; guard < 50; guard++) {
      const step = this.dueStep(table, now);
      if (!step) {
        break;
      }
      if (step.error) {
        break;
      }
      const { next, events: evs } = this.settleState(table, step, now, false);
      table = next;
      events.push(...evs);
    }

    if (events.length === 0 && table === first) {
      await this.arm(table, now);
      return;
    }
    await storage.put(GAME, table);
    await this.payCredits(table);
    await this.arm(table, now);

    const out = this.payload(first, table, events);
    await this.later(this.redraw(out.message, table));
    if (out.showdown) {
      await this.later(this.post(table, out.showdown));
    }
    if (out.ping) {
      await this.later(this.post(table, out.ping));
    }
  }

  /** The next engine step that is due at `now`, or null. */
  dueStep(table, now) {
    if (now >= table.lastActionAt + IDLE_MS) {
      const result = close(table, now);
      if (!result.error) {
        result.state.status =
          'The table closed after 30 minutes without activity. Everyone has been cashed out.';
      }
      return result;
    }
    if (
      table.phase === 'hand' &&
      table.turnDeadline !== null &&
      now >= table.turnDeadline
    ) {
      return timeout(table, now);
    }
    if (table.nextHandAt !== null && now >= table.nextHandAt && table.phase !== 'hand') {
      if (canStartHand(table)) {
        return startHand(table, now, this.rng);
      }
      return { state: { ...table, nextHandAt: null }, events: [] };
    }
    return null;
  }

  // ---------------------------------------------------------------- outbound

  /** Off the response path in production; awaited when there is no waitUntil. */
  async later(promise) {
    const safe = promise.catch((err) =>
      console.error(`${LABEL} background task failed:`, err?.message),
    );
    if (this.state.waitUntil) {
      this.state.waitUntil(safe);
    } else {
      await safe;
    }
  }

  async redraw(message, table) {
    const current = table ?? (await this.state.storage.get(GAME));
    if (!current) {
      return;
    }
    await editPanel({
      env: this.env,
      storage: this.state.storage,
      channelId: current.channelId,
      messageId: current.messageId,
      message,
      label: LABEL,
    });
  }

  async post(table, message) {
    await postMessage({
      env: this.env,
      channelId: table.channelId,
      message,
      label: LABEL,
    });
  }
}
