import { expect } from 'chai';
import { describe, it } from 'mocha';
import { UserData } from '../src/resources/UserData.js';
import {
  STARTING_BANKROLL,
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
  DAILY_CEILING,
} from '../src/functions/poker/bank.js';

/** Minimal stand-in for Durable Object storage. */
function fakeCtx(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      list: async () => new Map(map),
      delete: async (k) => [k].flat().forEach((key) => map.delete(key)),
    },
  };
}

const post = (obj, path, body = {}) =>
  obj.fetch(
    new Request(`https://dummy${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

const apply = async (obj, body) => {
  const res = await post(obj, '/bankApply', body);
  return { status: res.status, body: await res.json() };
};

const record = (over = {}) => ({
  balance: 100,
  lastDaily: null,
  ledger: [],
  stats: { handsWon: 0, biggestPot: 0, net: 0 },
  ...over,
});

describe('bankroll', () => {
  it('exports the documented constants', () => {
    expect(STARTING_BANKROLL).to.equal(5000);
    expect(DAILY_AMOUNT).to.equal(1000);
    expect(DAILY_COOLDOWN_MS).to.equal(86400000);
    expect(DAILY_CEILING).to.equal(5000);
  });

  it('creates a record lazily and does not store it on read', async () => {
    const ctx = fakeCtx();
    const res = await post(new UserData(ctx), '/bankGet');
    expect(await res.json()).to.deep.equal({
      balance: 5000,
      lastDaily: null,
      ledger: [],
      stats: { handsWon: 0, biggestPot: 0, net: 0 },
    });
    expect(await ctx.storage.get('bankroll')).to.equal(undefined);
  });

  it('runs a buy-in and cash-out, tracking net and stats', async () => {
    const obj = new UserData(fakeCtx());
    const buy = await apply(obj, { opId: 't1:1', delta: -500 });
    expect(buy.body.balance).to.equal(4500);
    expect(buy.body.stats.net).to.equal(0);

    const out = await apply(obj, {
      opId: 't1:2',
      delta: 800,
      net: 300,
      handsWon: 2,
      biggestPot: 400,
    });
    expect(out.body.balance).to.equal(5300);
    expect(out.body.stats).to.deep.equal({ handsWon: 2, biggestPot: 400, net: 300 });

    const later = await apply(obj, { opId: 't2:2', delta: 0, biggestPot: 100, net: -50 });
    expect(later.body.stats).to.deep.equal({ handsWon: 2, biggestPot: 400, net: 250 });
  });

  it('refuses an overdraft and leaves the record alone', async () => {
    const ctx = fakeCtx({ bankroll: record({ balance: 100 }) });
    const res = await apply(new UserData(ctx), { opId: 'a', delta: -101 });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.be.a('string');
    expect((await ctx.storage.get('bankroll')).balance).to.equal(100);

    const exact = await apply(new UserData(ctx), { opId: 'b', delta: -100 });
    expect(exact.body.balance).to.equal(0);
  });

  it('applies a repeated opId only once', async () => {
    const obj = new UserData(fakeCtx());
    await apply(obj, { opId: 'x', delta: -500 });
    const again = await apply(obj, { opId: 'x', delta: -500, net: 9 });
    expect(again.status).to.equal(200);
    expect(again.body.duplicate).to.equal(true);
    expect(again.body.balance).to.equal(4500);
    expect(again.body.stats.net).to.equal(0);
  });

  it('applies concurrent duplicate ids once', async () => {
    const ctx = fakeCtx();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        apply(new UserData(ctx), { opId: 'same', delta: -1000 }),
      ),
    );
    expect(results.filter((r) => r.body.duplicate)).to.have.lengthOf(4);
    expect((await ctx.storage.get('bankroll')).balance).to.equal(4000);
  });

  it('concurrent different ops do not lose updates', async () => {
    const ctx = fakeCtx();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        apply(new UserData(ctx), { opId: `o${i}`, delta: -10 }),
      ),
    );
    expect((await ctx.storage.get('bankroll')).balance).to.equal(4900);
  });

  it('trims the ledger to 50 and keeps recent ids idempotent', async () => {
    const obj = new UserData(fakeCtx());
    for (let i = 0; i < 60; i++) {
      await apply(obj, { opId: `op${i}`, delta: 1 });
    }
    const res = await (await post(obj, '/bankGet')).json();
    expect(res.ledger).to.have.lengthOf(50);
    expect(res.ledger[0]).to.equal('op10');
    expect(res.balance).to.equal(5060);

    const recent = await apply(obj, { opId: 'op59', delta: 1 });
    expect(recent.body.duplicate).to.equal(true);
    expect(recent.body.balance).to.equal(5060);
  });

  it('rejects bad amounts and ids', async () => {
    const ctx = fakeCtx();
    const obj = new UserData(ctx);
    const bads = [
      { opId: 'a', delta: NaN },
      { opId: 'a', delta: 1.5 },
      { opId: 'a', delta: '5' },
      { opId: 'a' },
      { opId: 'a', delta: null },
      { opId: 'a', delta: 1e9 + 1 },
      { opId: 'a', delta: -1e10 },
      { opId: 'a', delta: 1, net: 0.5 },
      { opId: 'a', delta: 1, net: '1' },
      { opId: 'a', delta: 1, handsWon: -1 },
      { opId: 'a', delta: 1, biggestPot: 2.5 },
      { delta: 1 },
      { opId: '', delta: 1 },
      { opId: 5, delta: 1 },
    ];
    for (const body of bads) {
      const res = await apply(obj, body);
      expect(res.status, JSON.stringify(body)).to.equal(400);
    }
    const nonObject = await post(obj, '/bankApply', null);
    expect(nonObject.status).to.equal(400);
    expect(await ctx.storage.get('bankroll')).to.equal(undefined);
  });

  describe('daily', () => {
    const NOW = 1_000_000_000_000;

    it('grants once, then reports the time remaining', async () => {
      const ctx = fakeCtx({ bankroll: record({ balance: 200 }) });
      const obj = new UserData(ctx);
      const ok = await post(obj, '/bankDaily', { now: NOW });
      const rec = await ok.json();
      expect(rec.balance).to.equal(1200);
      expect(rec.lastDaily).to.equal(NOW);

      const early = await post(obj, '/bankDaily', { now: NOW + 3600_000 });
      expect(early.status).to.equal(400);
      const body = await early.json();
      expect(body.remainingMs).to.equal(DAILY_COOLDOWN_MS - 3600_000);
      expect((await ctx.storage.get('bankroll')).balance).to.equal(1200);

      const edge = await post(obj, '/bankDaily', { now: NOW + DAILY_COOLDOWN_MS });
      expect((await edge.json()).balance).to.equal(2200);
    });

    it('is refused at or above the ceiling', async () => {
      for (const balance of [DAILY_CEILING, DAILY_CEILING + 1]) {
        const ctx = fakeCtx({ bankroll: record({ balance }) });
        const res = await post(new UserData(ctx), '/bankDaily', { now: NOW });
        expect(res.status).to.equal(400);
        expect((await ctx.storage.get('bankroll')).balance).to.equal(balance);
      }
      const below = fakeCtx({ bankroll: record({ balance: DAILY_CEILING - 1 }) });
      const res = await post(new UserData(below), '/bankDaily', { now: NOW });
      expect(res.status).to.equal(200);
    });

    it('does not touch net and defaults now to the clock', async () => {
      const ctx = fakeCtx({
        bankroll: record({
          balance: 10,
          stats: { handsWon: 1, biggestPot: 2, net: -490 },
        }),
      });
      const res = await post(new UserData(ctx), '/bankDaily');
      const rec = await res.json();
      expect(rec.stats).to.deep.equal({ handsWon: 1, biggestPot: 2, net: -490 });
      expect(rec.lastDaily).to.be.a('number');
    });

    it('rejects a non-numeric now', async () => {
      const res = await post(new UserData(fakeCtx()), '/bankDaily', { now: 'x' });
      expect(res.status).to.equal(400);
    });
  });

  describe('protection from stat commands', () => {
    const stored = () => record({ balance: 42 });

    it('/get hides it', async () => {
      const ctx = fakeCtx({ bankroll: stored(), kills: 1 });
      const res = await new UserData(ctx).fetch(new Request('https://dummy/get'));
      expect(await res.json()).to.deep.equal({ kills: 1 });
    });

    it('/set and /increment refuse it', async () => {
      const ctx = fakeCtx({ bankroll: stored() });
      const set = await post(new UserData(ctx), '/set', { bankroll: 999999 });
      const inc = await post(new UserData(ctx), '/increment', {
        key: 'bankroll',
        by: 5,
      });
      expect(set.status).to.equal(400);
      expect(inc.status).to.equal(400);
      expect(await ctx.storage.get('bankroll')).to.deep.equal(stored());
    });

    it('/dropStats keeps it', async () => {
      const ctx = fakeCtx({ bankroll: stored(), kills: 1 });
      await post(new UserData(ctx), '/dropStats', {});
      expect(await ctx.storage.get('bankroll')).to.deep.equal(stored());
      expect(await ctx.storage.get('kills')).to.equal(undefined);
    });
  });
});
