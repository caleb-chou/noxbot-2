import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import { MindGame } from '../src/resources/MindGame.js';
import { UserData } from '../src/resources/UserData.js';
import { IDLE_MS, begin, join, newLobby } from '../src/functions/mind.js';

/** Minimal stand-in for Durable Object storage. */
function fakeCtx(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
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
  return {
    DISCORD_TOKEN: 't',
    NOXBOT_DATA: {
      idFromName: (n) => n,
      get: (name) => ({
        fetch: (input, init) =>
          obj(name).fetch(input instanceof Request ? input : new Request(input, init)),
      }),
    },
    stats: async (name) => (await obj(name).fetch(new Request('https://dummy/get'))).json(),
  };
}

const call = async (mind, path, body = {}) =>
  (
    await mind.fetch(
      new Request(`https://dummy/${path}`, { method: 'POST', body: JSON.stringify(body) }),
    )
  ).json();

const CH = 'chan1';
const lobby = (mind, host = 'a') =>
  call(mind, 'lobby', { hostId: host, channelId: CH, guildId: 'g' });

/** A started 2-player game with hands we control. */
function seedPlaying(hands, extra = {}) {
  let s = newLobby({ hostId: 'a', channelId: CH, guildId: 'g', now: Date.now() });
  s = join(s, 'b', Date.now()).state;
  s = begin(s, 'a', Date.now()).state;
  return { ...s, hands, messageId: 'm1', ...extra };
}

describe('MindGame', () => {
  afterEach(() => sinon.restore());

  it('refuses a second lobby while a game exists, allows one after it ends', async () => {
    const mind = new MindGame(fakeCtx(), dataEnv());
    expect((await lobby(mind)).state.phase).to.equal('lobby');
    expect((await lobby(mind)).error).to.match(/already/);
    await call(mind, 'end', { userId: 'a' });
    expect((await lobby(mind)).state.phase).to.equal('lobby');
  });

  it('stores the panel message id and rejects stale buttons', async () => {
    const mind = new MindGame(fakeCtx(), dataEnv());
    await lobby(mind);
    // No stored id yet: a click cannot be verified, so it is told to retry.
    expect((await call(mind, 'join', { userId: 'b', messageId: 'any' })).error).to.match(/still being set up/);
    expect((await call(mind, 'join', { userId: 'b' })).error).to.equal(undefined);
    await call(mind, 'setMessage', { messageId: 'm1' });
    const stale = await call(mind, 'join', { userId: 'c', messageId: 'old' });
    expect(stale.error).to.match(/over/);
    expect((await call(mind, 'join', { userId: 'c', messageId: 'm1' })).state.players).to.include('c');
  });

  it('does not let a non-participant advance the level', async () => {
    const state = { ...seedPlaying({ a: [], b: [] }), phase: 'between', level: 1 };
    const mind = new MindGame(fakeCtx({ game: state }), dataEnv());
    expect((await call(mind, 'next', { userId: 'zed', messageId: 'm1' })).error).to.match(/not in this game/);
    expect((await call(mind, 'next', { userId: 'a', messageId: 'm1' })).state.level).to.equal(2);
  });

  it('returns the panel message and keeps the hand route read-only', async () => {
    const ctx = fakeCtx({ game: seedPlaying({ a: [5], b: [9] }) });
    const mind = new MindGame(ctx, dataEnv());
    const res = await call(mind, 'hand', { userId: 'a', messageId: 'm1' });
    expect(res.message.content).to.include('5');
    expect(res.message.flags).to.equal(64);
    const out = await call(mind, 'hand', { userId: 'zed', messageId: 'm1' });
    expect(out.message.content).to.match(/not in this game/);
  });

  it('resolves two simultaneous plays in arrival order', async () => {
    const ctx = fakeCtx({ game: seedPlaying({ a: [5, 20], b: [9, 30] }) });
    const mind = new MindGame(ctx, dataEnv());
    const [first, second] = await Promise.all([
      call(mind, 'play', { userId: 'b', messageId: 'm1' }),
      call(mind, 'play', { userId: 'a', messageId: 'm1' }),
    ]);
    // b goes first with 9 while a holds 5: a mistake, and 5 is discarded.
    expect(first.events.map((e) => e.type)).to.include('mistake');
    expect(first.state.lives).to.equal(1);
    // a's second play then sees the updated state: 20 is correct.
    expect(second.state.pile).to.deep.equal([9, 20]);
    expect(second.state.lives).to.equal(1);
  });

  it('writes stats once on a win and tracks the aggregate', async () => {
    const env = dataEnv();
    const game = seedPlaying({ a: [], b: [7] }, { level: 1, totalLevels: 1 });
    const mind = new MindGame(fakeCtx({ game }), env);
    const res = await call(mind, 'play', { userId: 'b', messageId: 'm1' });
    expect(res.state.phase).to.equal('won');
    expect(await env.stats('a')).to.include({ mind_games_played: 1, mind_games_won: 1, mind_best_level: 1 });
    expect((await env.stats('mind')).mind.b).to.deep.equal({ bestLevel: 1, wins: 1, games: 1 });
    // Already over: further calls and the alarm cannot write again.
    expect((await call(mind, 'end', { userId: 'a' })).error).to.match(/over/);
    expect((await env.stats('a')).mind_games_played).to.equal(1);
  });

  it('counts /mind end after the game started as a loss, but a cancelled lobby as nothing', async () => {
    const env = dataEnv();
    const mind = new MindGame(fakeCtx({ game: seedPlaying({ a: [1], b: [2] }) }), env);
    const res = await call(mind, 'end', { userId: 'b', messageId: 'm1' });
    expect(res.state.phase).to.equal('ended');
    const stats = await env.stats('a');
    expect(stats.mind_games_played).to.equal(1);
    expect(stats.mind_games_won).to.equal(undefined);

    const env2 = dataEnv();
    const m2 = new MindGame(fakeCtx(), env2);
    await lobby(m2);
    await call(m2, 'cancel', { userId: 'a' });
    expect((await env2.stats('a')).mind_games_played).to.equal(undefined);
  });

  it('only lets the host, a participant or an admin end the game', async () => {
    const mind = new MindGame(fakeCtx({ game: seedPlaying({ a: [1], b: [2] }) }), dataEnv());
    expect((await call(mind, 'end', { userId: 'x' })).error).to.match(/host or an admin/);
    expect((await call(mind, 'end', { userId: 'x', isAdmin: true })).state.phase).to.equal('ended');
  });

  it('mind_best_level only increases', async () => {
    const env = dataEnv();
    const play = async (level) => {
      const game = seedPlaying({ a: [], b: [7] }, { level, totalLevels: level, maxLevelReached: level });
      await call(new MindGame(fakeCtx({ game }), env), 'play', { userId: 'b', messageId: 'm1' });
    };
    await play(4);
    await play(2);
    expect((await env.stats('a')).mind_best_level).to.equal(4);
    expect((await env.stats('mind')).mind.a.bestLevel).to.equal(4);
    expect((await env.stats('mind')).mind.a.games).to.equal(2);
  });

  it('resets the idle alarm on every state change', async () => {
    const ctx = fakeCtx();
    const mind = new MindGame(ctx, dataEnv());
    const res = await lobby(mind);
    expect(ctx.map.alarm).to.equal(res.state.updatedAt + IDLE_MS);
  });

  describe('alarm', () => {
    it('ends an idle game as a timeout, edits the panel and records stats once', async () => {
      const env = dataEnv();
      const old = Date.now() - IDLE_MS - 1000;
      const game = seedPlaying({ a: [1], b: [2] }, { updatedAt: old });
      const ctx = fakeCtx({ game });
      const fetchStub = sinon.stub(globalThis, 'fetch').resolves(new Response('{}'));
      const mind = new MindGame(ctx, env);

      await mind.alarm();

      const saved = ctx.map.get('game');
      expect(saved).to.include({ phase: 'ended', endReason: 'timeout' });
      expect(fetchStub.calledOnce).to.equal(true);
      const [url, init] = fetchStub.firstCall.args;
      expect(url).to.include(`/channels/${CH}/messages/m1`);
      expect(init.method).to.equal('PATCH');
      expect((await env.stats('a')).mind_games_played).to.equal(1);
      // The next alarm only sweeps the tombstone; stats are not rewritten.
      await mind.alarm();
      expect(ctx.map.get('game')).to.equal(undefined);
      expect((await env.stats('a')).mind_games_played).to.equal(1);
    });

    it('records nothing for a lobby timeout', async () => {
      const env = dataEnv();
      const lobbyState = newLobby({ hostId: 'a', channelId: CH, guildId: 'g', now: 0 });
      const ctx = fakeCtx({ game: { ...lobbyState, messageId: 'm1' } });
      sinon.stub(globalThis, 'fetch').resolves(new Response('{}'));
      await new MindGame(ctx, env).alarm();
      expect(ctx.map.get('game').phase).to.equal('ended');
      expect((await env.stats('a')).mind_games_played).to.equal(undefined);
    });

    it('clears state when the panel was deleted (404)', async () => {
      const game = seedPlaying({ a: [1], b: [2] }, { updatedAt: 0 });
      const ctx = fakeCtx({ game });
      sinon.stub(globalThis, 'fetch').resolves(new Response('gone', { status: 404 }));
      await new MindGame(ctx, dataEnv()).alarm();
      expect(ctx.map.get('game')).to.equal(undefined);
    });

    it('survives a failing Discord call', async () => {
      const ctx = fakeCtx({ game: seedPlaying({ a: [1], b: [2] }, { updatedAt: 0 }) });
      sinon.stub(globalThis, 'fetch').rejects(new Error('offline'));
      await new MindGame(ctx, dataEnv()).alarm();
      expect(ctx.map.get('game').phase).to.equal('ended');
    });

    it('re-arms instead of ending when the game was touched recently', async () => {
      const game = seedPlaying({ a: [1], b: [2] }, { updatedAt: Date.now() });
      const ctx = fakeCtx({ game });
      await new MindGame(ctx, dataEnv()).alarm();
      expect(ctx.map.get('game').phase).to.equal('playing');
      expect(ctx.map.alarm).to.equal(game.updatedAt + IDLE_MS);
    });

    it('sweeps a finished game on the next alarm', async () => {
      const ctx = fakeCtx({ game: { ...seedPlaying({ a: [], b: [] }), phase: 'lost' } });
      await new MindGame(ctx, dataEnv()).alarm();
      expect(ctx.map.get('game')).to.equal(undefined);
    });
  });
});
