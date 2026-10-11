import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { IDLE_MS, PokerTable, parseAmount } from '../src/resources/PokerTable.js';
import { UserData } from '../src/resources/UserData.js';
import { parseTableConfig } from '../src/functions/poker/config.js';
import { formatCard } from '../src/functions/poker/cards.js';

/** Minimal stand-in for Durable Object storage. */
function fakeCtx(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => {
        if (typeof k === 'object') {
          Object.entries(k).forEach(([key, val]) => map.set(key, val));
        } else {
          map.set(k, v);
        }
      },
      list: async () => new Map(map),
      delete: async (k) => [k].flat().forEach((key) => map.delete(key)),
      setAlarm: async (t) => void (map.alarm = t),
      deleteAlarm: async () => void delete map.alarm,
      getAlarm: async () => map.alarm ?? null,
    },
  };
}

/** NOXBOT_DATA where each name gets its own in-memory UserData. */
function dataEnv() {
  const objs = new Map();
  const obj = (name) => {
    if (!objs.has(name)) objs.set(name, new UserData(fakeCtx(), {}));
    return objs.get(name);
  };
  const env = {
    DISCORD_TOKEN: 't',
    DISCORD_APPLICATION_ID: 'app',
    failBank: false,
    NOXBOT_DATA: {
      idFromName: (n) => n,
      get: (name) => ({
        fetch: (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          if (env.failBank && request.url.includes('/bankApply')) {
            throw new Error('bank down');
          }
          if (env.loseResponse && request.url.includes('/bankApply')) {
            // Applied, but the answer never reaches the table.
            return obj(name)
              .fetch(request)
              .then(() => {
                throw new Error('connection lost');
              });
          }
          return obj(name).fetch(request);
        },
      }),
    },
    balance: async (name) =>
      (
        await obj(name).fetch(
          new Request('https://dummy/bankGet', { method: 'POST', body: '{}' }),
        )
      ).json(),
    stats: async (name) =>
      (await obj(name).fetch(new Request('https://dummy/get'))).json(),
  };
  return env;
}

const CH = 'chan1';
const cfg = (o = {}) =>
  parseTableConfig({ buyin: 100, blinds: '1/2', ...o }).config;

// Heads-up deal: seat 0 (button, small blind) gets As Ad, seat 1 gets Kc Kd.
// Deal order starts left of the button, so seat 1 receives the first card.
const HOLE_0 = ['As', 'Ad'];
const HOLE_1 = ['Kc', 'Kd'];
const DECK = ['Kc', 'As', 'Kd', 'Ad', '2h', '7d', '9c', '3s', '4h'];

describe('PokerTable', () => {
  let ctx;
  let env;
  let table;
  let clock;
  let leaks;

  const post = async (route, body = {}, withMessage = true) => {
    const res = await table.fetch(
      new Request(`https://dummy/${route}`, {
        method: 'POST',
        body: JSON.stringify({
          channelId: CH,
          guildId: 'g',
          token: 'tok',
          ...(withMessage ? { messageId: 'm1' } : {}),
          ...body,
        }),
      }),
    );
    expect(res.status).to.equal(200);
    const json = await res.json();
    if (route !== 'hand') {
      leaks.push(JSON.stringify(json));
    }
    return json;
  };

  const open = async (options = {}, host = 'u1') => {
    const out = await post(
      'table',
      { hostId: host, userId: host, config: cfg(options) },
      false,
    );
    if (!out.error) {
      await post('setMessage', { messageId: 'm1' }, false);
    }
    return out;
  };

  const saved = () => ctx.map.get('game');

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });
    ctx = fakeCtx();
    env = dataEnv();
    table = new PokerTable(ctx, env);
    table.rng = DECK;
    leaks = [];
    sinon.stub(globalThis, 'fetch').resolves(new Response('{}'));
  });

  afterEach(() => sinon.restore());

  const assertNoHoleCards = (cards) => {
    for (const json of leaks) {
      for (const c of cards) {
        expect(json).to.not.include(c);
        expect(json).to.not.include(formatCard(c));
      }
    }
  };

  it('parses amounts leniently but safely', () => {
    expect(parseAmount('$1,200')).to.equal(1200);
    expect(parseAmount(50)).to.equal(50);
    expect(parseAmount('1e3')).to.equal(null);
    expect(parseAmount('-5')).to.equal(null);
    expect(parseAmount(1.5)).to.equal(null);
  });

  describe('creating a table', () => {
    it('creates a casual table and seats the host without touching the bank', async () => {
      const out = await open();
      expect(out.message.embeds).to.have.length(1);
      expect(saved().seats[0]).to.include({ userId: 'u1', stack: 100 });
      expect((await env.balance('u1')).balance).to.equal(5000);
    });

    it('refuses a second live table, but replaces a tombstone', async () => {
      await open();
      expect((await open()).error).to.match(/already has/);
      await post('end', { userId: 'u1' }, false);
      expect(saved().phase).to.equal('closed');
      expect((await open()).error).to.equal(undefined);
      expect(saved().phase).to.equal('lobby');
    });

    it('debits the host in ranked mode', async () => {
      await open({ mode: 'ranked' });
      expect((await env.balance('u1')).balance).to.equal(4900);
    });

    it('refuses to create a ranked table the host cannot afford', async () => {
      const out = await open({ mode: 'ranked', buyin: 6000, blinds: '50/100' });
      expect(out.error).to.match(/Not enough bankroll/);
      expect(saved()).to.equal(undefined);
      expect((await env.balance('u1')).balance).to.equal(5000);
    });

    it('rejects routes with no table', async () => {
      expect((await post('sit', { userId: 'u2' })).error).to.match(/no poker table/);
    });
  });

  describe('seating', () => {
    it('sit, rebuy limits and leave in casual mode', async () => {
      await open();
      expect((await post('sit', { userId: 'u2', buyIn: 100 })).message).to.exist;
      expect((await post('sit', { userId: 'u2', buyIn: 100 })).error).to.match(/already/);
      expect((await post('sit', { userId: 'u3', buyIn: 5 })).error).to.match(/buy-in/);
      expect((await post('rebuy', { userId: 'u2' })).error).to.match(/rebuy only/);
      expect((await post('leave', { userId: 'u2' })).error).to.equal(undefined);
      expect(saved().seats[1]).to.equal(null);
      expect((await env.balance('u2')).balance).to.equal(5000);
    });

    it('answers sitModal with a modal for a range, or sits at once when fixed', async () => {
      await open({ buyin_min: 50, buyin_max: 200 });
      expect((await post('sitModal', { userId: 'u2' })).modal.type).to.equal(9);
      await post('end', { userId: 'u1' }, false);
      await open();
      const fixed = await post('sitModal', { userId: 'u2' });
      expect(fixed.modal).to.equal(undefined);
      expect(fixed.message).to.exist;
      expect(saved().seats[1].userId).to.equal('u2');
    });

    it('ranked sit debits, leave credits, and short bankrolls are refused', async () => {
      await open({ mode: 'ranked' });
      await post('sit', { userId: 'u2', buyIn: 100 });
      expect((await env.balance('u2')).balance).to.equal(4900);
      await post('leave', { userId: 'u2' });
      const bank = await env.balance('u2');
      expect(bank.balance).to.equal(5000);
      expect(bank.stats.net).to.equal(0);
      expect(saved().pendingCredits).to.deep.equal([]);

      await post('end', { userId: 'u1' }, false);
      await open({ mode: 'ranked', buyin: 4000, blinds: '50/100' });
      const short = await post('sit', { userId: 'u3', buyIn: 4000 });
      expect(short.message).to.exist;
      const poor = await post('sit', { userId: 'u1', buyIn: 4000 });
      expect(poor.error).to.match(/already/);
      // u1 holds 1000 after the host buy-in; a second table seat is not possible,
      // so check the refusal on a fresh user with a drained bankroll.
      await env.NOXBOT_DATA.get('u4').fetch('https://dummy/bankApply', {
        method: 'POST',
        body: JSON.stringify({ opId: 'drain', delta: -4500 }),
      });
      const broke = await post('sit', { userId: 'u4', buyIn: 4000 });
      expect(broke.error).to.match(/Not enough bankroll.*\$500/);
      expect(saved().seats.filter(Boolean)).to.have.length(2);
    });

    it('rebuy tops up to the buy-in and debits (ranked)', async () => {
      await open({ mode: 'ranked', buyin: 100, buyin_min: 50, rebuys: true });
      await post('sit', { userId: 'u2', buyIn: 100 });
      ctx.map.set('game', {
        ...saved(),
        seats: saved().seats.map((s) => (s?.userId === 'u2' ? { ...s, stack: 20 } : s)),
      });
      const out = await post('rebuy', { userId: 'u2' });
      expect(out.error).to.equal(undefined);
      expect(saved().seats[1].stack).to.equal(100);
      expect((await env.balance('u2')).balance).to.equal(5000 - 100 - 80);
    });
  });

  describe('a hand through the routes', () => {
    beforeEach(async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
    });

    it('plays to showdown without leaking hole cards in any public response', async () => {
      const started = await post('start', { userId: 'u1' });
      expect(started.ping.content).to.include('<@u1>');
      expect(saved().phase).to.equal('hand');

      expect((await post('call', { userId: 'u2' })).error).to.match(/not your turn/);
      expect((await post('call', { userId: 'u3' })).error).to.match(/not seated/);
      expect((await post('call', { userId: 'u1', messageId: 'old' })).error).to.match(
        /out of date/,
      );

      // Each player sees their own cards, and only theirs.
      const mine = await post('hand', { userId: 'u1' });
      expect(mine.ephemeral).to.equal(true);
      expect(mine.message.content).to.include(formatCard('As'));
      expect(mine.message.content).to.not.include(formatCard('Kc'));
      const stranger = await post('hand', { userId: 'u9' });
      expect(stranger.message.content).to.not.include(formatCard('As'));

      let out = await post('call', { userId: 'u1' });
      expect(out.ping.content).to.include('<@u2>');
      out = await post('call', { userId: 'u2' });
      for (let i = 0; i < 3; i++) {
        const state = saved();
        const actor = state.seats[state.toAct].userId;
        out = await post('call', { userId: actor });
        out = await post('call', { userId: actor === 'u1' ? 'u2' : 'u1' });
      }
      expect(saved().phase).to.equal('between');
      expect(saved().seats[0].stack).to.equal(102);
      expect(saved().seats[1].stack).to.equal(98);
      expect(saved().nextHandAt).to.be.a('number');
      expect(saved().lastHand.showdown).to.equal(true);

      // Hole cards only appear in showdown follow-ups, never before. The
      // collected pre-showdown responses must be clean:
      const beforeShowdown = leaks.filter((j) => !j.includes('"showdown"'));
      for (const json of beforeShowdown) {
        for (const c of [...HOLE_0, ...HOLE_1]) {
          expect(json).to.not.include(c);
          expect(json).to.not.include(formatCard(c));
        }
      }
      expect(leaks.some((j) => j.includes('"showdown"'))).to.equal(true);
      // Never exposed in any response: the deck leftovers.
      assertNoHoleCards(['3s', '4h'].filter((c) => !saved().board.includes(c)));
    });

    it('does not leak after an uncontested fold, and never routes /state', async () => {
      await post('start', { userId: 'u2' });
      const out = await post('fold', { userId: 'u1' });
      expect(out.showdown).to.exist;
      assertNoHoleCards([...HOLE_0, ...HOLE_1]);
      const res = await table.fetch(
        new Request('https://dummy/state', { method: 'POST', body: '{}' }),
      );
      expect(res.status).to.equal(404);
    });

    it('raises via the modal and validates amounts', async () => {
      await post('start', { userId: 'u1' });
      expect((await post('raiseModal', { userId: 'u1' })).modal.type).to.equal(9);
      expect((await post('raiseModal', { userId: 'u2' })).error).to.match(/turn/);
      expect((await post('raise', { userId: 'u1', amount: '3' })).error).to.match(/minimum/);
      expect((await post('raise', { userId: 'u1', amount: 'abc' })).error).to.match(/whole/);
      const ok = await post('raise', { userId: 'u1', amount: '$6' });
      expect(ok.message).to.exist;
      expect(saved().currentBet).to.equal(6);
    });

    it('only the host or a seated player may start; unseated users are refused', async () => {
      expect((await post('start', { userId: 'u9' })).error).to.match(/host or a seated/);
      expect((await post('start', { userId: 'u2' })).message).to.exist;
      expect((await post('start', { userId: 'u1' })).error).to.match(/already/);
    });

    it('refuses clicks until the panel message is stored', async () => {
      await post('end', { userId: 'u1' }, false);
      await post(
        'table',
        { hostId: 'u1', userId: 'u1', config: cfg() },
        false,
      );
      const early = await post('sit', { userId: 'u2', buyIn: 100 });
      expect(early.error).to.match(/still being set up/);
    });
  });

  describe('sit out button', () => {
    it('toggles when the button sends no value', async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('sitout', { userId: 'u2' });
      expect(saved().seats[1].sittingOut).to.equal(true);
      const back = await post('sitout', { userId: 'u2' });
      expect(back.error).to.equal(undefined);
      expect(saved().seats[1].sittingOut).to.equal(false);
      await post('sitout', { userId: 'u2', value: false });
      expect(saved().seats[1].sittingOut).to.equal(false);
    });
  });

  describe('late clicks', () => {
    it('rejects an action after the turn expired but before the alarm ran', async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
      clock.tick(61_000);
      const out = await post('call', { userId: 'u1' });
      expect(out.info).to.match(/timed out/);
      // The click did not call: the timeout folded u1 instead.
      expect(saved().seats[0].timeouts).to.equal(1);
      expect(saved().seats[1].stack).to.equal(101);
      expect(saved().phase).to.equal('between');
    });

    it('also refuses the raise modal after the deadline', async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
      clock.tick(61_000);
      const out = await post('raiseModal', { userId: 'u1' });
      expect(out.modal).to.equal(undefined);
      expect(saved().phase).to.equal('between');
    });
  });

  describe('alarm', () => {
    beforeEach(async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
    });

    it('arms for the turn deadline and folds an idle player', async () => {
      expect(ctx.map.alarm).to.equal(saved().turnDeadline);
      clock.tick(61_000);
      await table.alarm();
      // u1 faced the big blind: auto-fold, u2 wins.
      expect(saved().phase).to.equal('between');
      expect(saved().seats[1].stack).to.equal(101);
      expect(saved().seats[0].timeouts).to.equal(1);
      const patched = globalThis.fetch.getCalls().map((c) => c.args[0]);
      expect(patched.some((u) => u.includes('/channels/chan1/messages/m1'))).to.equal(true);
      const posts = globalThis.fetch
        .getCalls()
        .filter((c) => c.args[1].method === 'POST')
        .map((c) => c.args[1].body);
      posts.forEach((b) => {
        for (const c of [...HOLE_0, ...HOLE_1]) {
          expect(b).to.not.include(formatCard(c));
        }
      });
    });

    it('starts the next hand at nextHandAt', async () => {
      clock.tick(61_000);
      await table.alarm();
      const at = saved().nextHandAt;
      expect(ctx.map.alarm).to.equal(at);
      clock.tick(5_000);
      await table.alarm();
      expect(saved().phase).to.equal('hand');
      expect(saved().handNumber).to.equal(2);
    });

    it('does nothing when called early', async () => {
      const before = saved();
      await table.alarm();
      expect(saved()).to.deep.equal(before);
    });

    it('closes an idle table and cashes everyone out; tombstone is cleaned up', async () => {
      clock.tick(IDLE_MS + 1_000);
      await table.alarm();
      expect(saved().phase).to.equal('closed');
      expect(saved().seats.every((s) => s === null)).to.equal(true);
      clock.tick(24 * 60 * 60_000);
      await table.alarm();
      expect(saved()).to.equal(undefined);
    });
  });

  describe('closing', () => {
    it('/end during a hand closes after it, and only for host or admin', async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
      expect((await post('end', { userId: 'u2' }, false)).error).to.match(/host or an admin/);
      const out = await post('end', { userId: 'u2', isAdmin: true }, false);
      expect(out.info).to.match(/after this hand/);
      expect(saved().phase).to.equal('hand');
      await post('fold', { userId: 'u1' });
      expect(saved().phase).to.equal('closed');
      expect(saved().seats.every((s) => s === null)).to.equal(true);
    });

    it('/end between hands closes at once and redraws the panel for a slash command', async () => {
      await open();
      const out = await post('end', { userId: 'u1' }, false);
      expect(out.message.components).to.deep.equal([]);
      expect(globalThis.fetch.called).to.equal(true);
    });
  });

  describe('ranked money', () => {
    const play = async () => {
      await open({ mode: 'ranked' });
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
      await post('fold', { userId: 'u1' }); // u2 wins the blinds
    };

    it('conserves chips: bankroll changes sum to zero and match the table net', async () => {
      await play();
      await post('end', { userId: 'u1' }, false);
      const a = await env.balance('u1');
      const b = await env.balance('u2');
      expect(a.balance + b.balance).to.equal(10_000);
      expect(a.balance).to.equal(4999);
      expect(b.balance).to.equal(5001);
      expect(a.stats.net + b.stats.net).to.equal(0);
      expect(b.stats.net).to.equal(1);
      expect(b.stats.handsWon).to.equal(1);
      expect(saved().pendingCredits).to.deep.equal([]);
      const board = (await env.stats('poker')).poker;
      expect(board.u2.net).to.equal(1);
      expect(board.u1.net).to.equal(-1);
      expect(board.u2.hands).to.equal(1);
    });

    it('credits stacks when an idle ranked table closes', async () => {
      await play();
      clock.tick(IDLE_MS + 1_000);
      await table.alarm();
      expect((await env.balance('u1')).balance + (await env.balance('u2')).balance).to.equal(
        10_000,
      );
    });

    it('keeps failed credits pending and retries without double-crediting', async () => {
      await play();
      env.failBank = true;
      await post('end', { userId: 'u1' }, false);
      expect(saved().pendingCredits).to.have.length(2);
      // Debits already happened, credits have not.
      expect((await env.balance('u1')).balance).to.equal(4900);
      expect(ctx.map.alarm).to.be.a('number');

      env.failBank = false;
      clock.tick(31_000);
      await table.alarm();
      expect(saved().pendingCredits).to.deep.equal([]);
      expect((await env.balance('u1')).balance).to.equal(4999);
      expect((await env.balance('u2')).balance).to.equal(5001);

      // A crash after the bank applied but before the entry was removed:
      // replaying the same opId must not credit again.
      const state = saved();
      const replay = {
        opId: `${state.tableId}:${state.seq}`,
        userId: 'u2',
        delta: 101,
        net: 1,
        handsWon: 1,
        biggestPot: 4,
        hands: 1,
        attempts: 0,
      };
      ctx.map.set('game', { ...state, pendingCredits: [replay] });
      await table.alarm();
      expect(saved().pendingCredits).to.deep.equal([]);
      expect((await env.balance('u2')).balance).to.equal(5001);
      expect((await env.stats('poker')).poker.u2.net).to.equal(1);
    });

    it('never drops a pending credit however long the bank is down', async () => {
      await play();
      env.failBank = true;
      await post('end', { userId: 'u1' }, false);
      for (let i = 0; i < 150; i++) {
        clock.tick(31_000);
        await table.alarm();
      }
      expect(saved().pendingCredits).to.have.length(2);
      env.failBank = false;
      clock.tick(31_000);
      await table.alarm();
      expect(saved().pendingCredits).to.deep.equal([]);
      expect((await env.balance('u1')).balance).to.equal(4999);
      expect((await env.balance('u2')).balance).to.equal(5001);
    });

    it('records a bust as zero credit with the full loss as net', async () => {
      await open({ mode: 'ranked', buyin: 4, blinds: '1/2' });
      await post('sit', { userId: 'u2', buyIn: 4 });
      await post('start', { userId: 'u1' });
      await post('allin', { userId: 'u1' });
      await post('call', { userId: 'u2' });
      expect(saved().seats.filter(Boolean)).to.have.length(1);
      const loser = await env.balance('u2');
      expect(loser.balance).to.equal(4996);
      expect(loser.stats.net).to.equal(-4);
      await post('end', { userId: 'u1' }, false);
      const winner = await env.balance('u1');
      expect(winner.balance).to.equal(5004);
      expect(winner.balance + loser.balance).to.equal(10_000);
    });

    describe('debit crash window', () => {
      const intents = () => ctx.map.get('debitIntents') ?? [];

      it('refunds a debit whose seat was never saved, then lets the player sit again', async () => {
        await open({ mode: 'ranked' });
        const realPut = ctx.storage.put;
        let armed = true;
        ctx.storage.put = async (k, v) => {
          if (armed && typeof k === 'object' && 'game' in k) {
            armed = false;
            throw new Error('simulated crash after the debit');
          }
          return realPut(k, v);
        };
        let crashed = false;
        try {
          await table.fetch(
            new Request('https://dummy/sit', {
              method: 'POST',
              body: JSON.stringify({ userId: 'u2', buyIn: 100, messageId: 'm1', channelId: CH }),
            }),
          );
        } catch {
          crashed = true;
        }
        expect(crashed).to.equal(true);
        expect((await env.balance('u2')).balance).to.equal(4900);
        expect(saved().seats[1]).to.equal(null);
        expect(intents()).to.have.length(1);
        expect(ctx.map.alarm).to.be.a('number');

        clock.tick(31_000);
        await table.alarm();
        await table.alarm(); // a duplicate delivery must not refund twice
        expect((await env.balance('u2')).balance).to.equal(5000);
        expect(intents()).to.deep.equal([]);

        const out = await post('sit', { userId: 'u2', buyIn: 100 });
        expect(out.error).to.equal(undefined);
        expect((await env.balance('u2')).balance).to.equal(4900);
        expect(intents()).to.deep.equal([]);
      });

      it('does not refund a debit that was saved with its seat', async () => {
        await open({ mode: 'ranked' });
        await post('sit', { userId: 'u2', buyIn: 100 });
        expect(intents()).to.deep.equal([]);
        clock.tick(31_000);
        await table.alarm();
        expect((await env.balance('u2')).balance).to.equal(4900);
      });

      it('recovers when the bank applied the debit but its answer was lost', async () => {
        await open({ mode: 'ranked' });
        env.loseResponse = true;
        const out = await post('sit', { userId: 'u2', buyIn: 100 });
        expect(out.error).to.match(/unavailable/);
        env.loseResponse = false;
        expect((await env.balance('u2')).balance).to.equal(4900);
        clock.tick(31_000);
        await table.alarm();
        expect((await env.balance('u2')).balance).to.equal(5000);
        expect(intents()).to.deep.equal([]);
      });

      it('recovers when the bank was down for the debit, without creating chips', async () => {
        await open({ mode: 'ranked' });
        env.failBank = true;
        await post('sit', { userId: 'u2', buyIn: 100 });
        env.failBank = false;
        clock.tick(31_000);
        await table.alarm();
        expect((await env.balance('u2')).balance).to.equal(5000);
        expect(intents()).to.deep.equal([]);
      });

      it('drops the intent when the bank refuses for lack of funds', async () => {
        await open({ mode: 'ranked' });
        await env.NOXBOT_DATA.get('u2').fetch('https://dummy/bankApply', {
          method: 'POST',
          body: JSON.stringify({ opId: 'drain', delta: -4950 }),
        });
        const out = await post('sit', { userId: 'u2', buyIn: 100 });
        expect(out.error).to.match(/Not enough bankroll/);
        expect(intents()).to.deep.equal([]);
        clock.tick(31_000);
        await table.alarm();
        expect((await env.balance('u2')).balance).to.equal(50);
      });
    });

    it('never writes bank or leaderboard data for casual tables', async () => {
      await open();
      await post('sit', { userId: 'u2', buyIn: 100 });
      await post('start', { userId: 'u1' });
      await post('fold', { userId: 'u1' });
      await post('end', { userId: 'u1' }, false);
      expect((await env.balance('u2')).balance).to.equal(5000);
      expect((await env.balance('u2')).stats.net).to.equal(0);
      expect((await env.stats('poker')).poker).to.equal(undefined);
    });
  });
});
