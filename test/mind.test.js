import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as mind from '../src/functions/mind.js';

const T = 1_000_000;
const CH = 'chan';

/** Deterministic rng: a simple LCG. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const ids = (n) => Array.from({ length: n }, (_, i) => `u${i + 1}`);

/** A started game for n players, built with the API only. */
function started(n = 3, rng = seeded()) {
  const [host, ...rest] = ids(n);
  let state = mind.newLobby({ hostId: host, channelId: CH, guildId: 'g', now: T });
  for (const u of rest) {
    state = mind.join(state, u, T).state;
  }
  return mind.begin(state, host, T, rng).state;
}

/** Overwrite hands/extra fields for a precise scenario. */
const withHands = (state, hands, extra = {}) => ({
  ...state,
  hands: { ...state.hands, ...hands },
  ...extra,
});

describe('mind: levels and rewards', () => {
  it('levelsFor matches the table for 2-8 players', () => {
    const table = { 2: 12, 3: 10, 4: 8, 5: 7, 6: 6, 7: 5, 8: 5 };
    for (const [n, levels] of Object.entries(table)) {
      expect(mind.levelsFor(Number(n))).to.equal(levels);
    }
  });

  it('rewards come at levels 2/5/8 (shuriken) and 3/6/9 (life)', () => {
    for (const l of [2, 5, 8]) {
      expect(mind.rewardsFor(l)).to.deep.equal({ shurikens: 1, lives: 0 });
    }
    for (const l of [3, 6, 9]) {
      expect(mind.rewardsFor(l)).to.deep.equal({ shurikens: 0, lives: 1 });
    }
    expect(mind.rewardsFor(1)).to.deep.equal({ shurikens: 0, lives: 0 });
  });

  it('shuffle is a permutation and honours rng', () => {
    const a = mind.shuffle([1, 2, 3, 4, 5], seeded(7));
    expect(a).to.have.members([1, 2, 3, 4, 5]);
    expect(mind.shuffle([1, 2, 3, 4, 5], seeded(7))).to.deep.equal(a);
    expect(mind.shuffle([1, 2, 3])).to.have.length(3);
  });
});

describe('mind: lobby', () => {
  const lobby = () =>
    mind.newLobby({ hostId: 'h', channelId: CH, guildId: 'g', now: T });

  it('auto-joins the host', () => {
    expect(lobby().players).to.deep.equal(['h']);
    expect(lobby().phase).to.equal('lobby');
  });

  it('rejects duplicates and a ninth player, without mutating', () => {
    const s = lobby();
    const snapshot = structuredClone(s);
    expect(mind.join(s, 'h', T).error).to.be.a('string');
    expect(s).to.deep.equal(snapshot);
    let cur = s;
    for (const u of ids(7)) {
      cur = mind.join(cur, u, T).state;
    }
    expect(cur.players).to.have.length(8);
    expect(mind.join(cur, 'late', T).error).to.match(/full/);
  });

  it('leave works for non-hosts only', () => {
    const s = mind.join(lobby(), 'a', T).state;
    expect(mind.leave(s, 'a', T).state.players).to.deep.equal(['h']);
    expect(mind.leave(s, 'h', T).error).to.be.a('string');
    expect(mind.leave(s, 'zzz', T).error).to.be.a('string');
  });

  it('begin is host only and needs 2 players', () => {
    const s = lobby();
    expect(mind.begin(s, 'h', T).error).to.match(/at least 2/);
    const two = mind.join(s, 'a', T).state;
    expect(mind.begin(two, 'a', T).error).to.match(/host/);
    const r = mind.begin(two, 'h', T, seeded());
    expect(r.state.phase).to.equal('playing');
    expect(r.state.lives).to.equal(2);
    expect(r.state.shurikens).to.equal(1);
    expect(r.state.totalLevels).to.equal(12);
    expect(mind.join(r.state, 'x', T).error).to.be.a('string');
    expect(mind.leave(r.state, 'a', T).error).to.be.a('string');
  });
});

describe('mind: dealing', () => {
  it('deals unique cards, level-many per player, sorted', () => {
    const s = started(4);
    const all = Object.values(s.hands).flat();
    expect(all).to.have.length(4);
    expect(new Set(all).size).to.equal(4);
    // Move on to level 3 and check the counts.
    let cur = withHands(s, Object.fromEntries(s.players.map((p) => [p, []])));
    cur = { ...cur, phase: 'between', level: 2 };
    cur = mind.nextLevel(cur, T, seeded(3)).state;
    expect(cur.level).to.equal(3);
    const dealt = Object.values(cur.hands);
    for (const h of dealt) {
      expect(h).to.have.length(3);
      expect(h).to.deep.equal([...h].sort((a, b) => a - b));
    }
    const flat = dealt.flat();
    expect(new Set(flat).size).to.equal(12);
    expect(flat.every((c) => c >= 1 && c <= 100)).to.equal(true);
  });
});

describe('mind: playing', () => {
  const base = () =>
    withHands(started(3), { u1: [5, 40], u2: [20, 60], u3: [30, 90] }, { level: 2 });

  it('a correct play grows the pile and costs nothing', () => {
    const s = base();
    const r = mind.playLowest(s, 'u1', T + 1);
    expect(r.state.pile).to.deep.equal([5]);
    expect(r.state.lives).to.equal(s.lives);
    expect(r.state.hands.u1).to.deep.equal([40]);
    expect(r.events.map((e) => e.type)).to.deep.equal(['played']);
    expect(r.state.updatedAt).to.equal(T + 1);
    expect(s.pile).to.deep.equal([]); // input untouched
  });

  it('a mistake costs one life and discards every lower card', () => {
    const s = base();
    const r = mind.playLowest(s, 'u3', T);
    expect(r.state.lives).to.equal(s.lives - 1);
    expect(r.state.lastMistake).to.deep.equal({ played: 30, discarded: [5, 20] });
    expect(r.state.hands).to.deep.equal({ u1: [40], u2: [60], u3: [90] });
    const mistake = r.events.find((e) => e.type === 'mistake');
    expect(mistake).to.deep.equal({ type: 'mistake', played: 30, discarded: [5, 20] });
  });

  it('refuses outsiders, empty hands, and finished games', () => {
    const s = base();
    expect(mind.playLowest(s, 'nobody', T).error).to.be.a('string');
    const empty = withHands(s, { u1: [] });
    expect(mind.playLowest(empty, 'u1', T).error).to.match(/no cards/);
    expect(mind.playLowest({ ...s, phase: 'lost' }, 'u1', T).error).to.be.a('string');
    expect(mind.playLowest({ ...s, phase: 'between' }, 'u1', T).error).to.be.a('string');
  });

  it('a mistake that empties every hand still clears the level', () => {
    const s = withHands(started(2), { u1: [10], u2: [5] }, { level: 1, lives: 2 });
    const r = mind.playLowest(s, 'u1', T);
    expect(r.state.lives).to.equal(1);
    expect(r.state.phase).to.equal('between');
    expect(r.events.map((e) => e.type)).to.include.members(['mistake', 'level_cleared']);
  });

  it('lives at 0 give a loss', () => {
    const s = withHands(started(2), { u1: [10, 50], u2: [5, 60] }, { level: 2, lives: 1 });
    const r = mind.playLowest(s, 'u1', T);
    expect(r.state.phase).to.equal('lost');
    expect(r.events.map((e) => e.type)).to.include('lost');
    expect(mind.playLowest(r.state, 'u2', T).error).to.be.a('string');
  });

  it('a loss takes priority over clearing the level', () => {
    const s = withHands(started(2), { u1: [10], u2: [5] }, { level: 1, lives: 1 });
    const r = mind.playLowest(s, 'u1', T);
    expect(r.state.phase).to.equal('lost');
    expect(r.events.map((e) => e.type)).to.not.include('level_cleared');
  });

  it('applies the level rewards, respecting caps', () => {
    const clear = (level, extra) =>
      mind.playLowest(
        withHands(started(3), { u1: [1], u2: [], u3: [] }, { level, ...extra }),
        'u1',
        T,
      );
    let r = clear(2, { shurikens: 1, lives: 3 });
    expect(r.state.shurikens).to.equal(2);
    expect(r.state.lives).to.equal(3);
    expect(r.events.find((e) => e.type === 'level_cleared').rewards).to.deep.equal({
      shurikens: 1,
      lives: 0,
    });
    r = clear(3, { shurikens: 1, lives: 3 });
    expect(r.state.lives).to.equal(4);
    r = clear(5, { shurikens: 3, lives: 3 });
    expect(r.state.shurikens).to.equal(3);
    expect(r.events.find((e) => e.type === 'level_cleared').rewards.shurikens).to.equal(0);
    r = clear(6, { shurikens: 1, lives: 5 });
    expect(r.state.lives).to.equal(5);
  });

  it('never takes lives away when a big team starts above the life cap', () => {
    const state = withHands(started(8), { u1: [1], u2: [], u3: [], u4: [], u5: [], u6: [], u7: [], u8: [] }, { level: 3 });
    expect(state.lives).to.equal(8);
    const r = mind.playLowest(state, 'u1', T);
    expect(r.state.lives).to.equal(8);
    expect(r.state.status).to.not.include('-');
  });

  it('nextLevel advances from between only', () => {
    const s = started(2);
    expect(mind.nextLevel(s, T).error).to.be.a('string');
    const between = { ...s, phase: 'between', hands: { u1: [], u2: [] } };
    const r = mind.nextLevel(between, T, seeded());
    expect(r.state.level).to.equal(2);
    expect(r.state.maxLevelReached).to.equal(2);
    expect(r.state.pile).to.deep.equal([]);
  });
});

describe('mind: shuriken', () => {
  const base = () =>
    withHands(started(3), { u1: [5, 40], u2: [20, 60], u3: [30, 90] }, { level: 2 });

  it('a unanimous vote discards each lowest card and spends a shuriken', () => {
    let r = mind.startVote(base(), 'u1', T);
    expect(r.state.vote.by).to.equal('u1');
    r = mind.castVote(r.state, 'u2', true, T + 1);
    expect(r.state.shurikens).to.equal(1);
    r = mind.castVote(r.state, 'u3', true, T + 2);
    expect(r.state.shurikens).to.equal(0);
    expect(r.state.vote).to.equal(null);
    expect(r.state.hands).to.deep.equal({ u1: [40], u2: [60], u3: [90] });
    expect(r.state.lastShuriken.discarded).to.deep.equal({ u1: 5, u2: 20, u3: 30 });
    expect(r.events.find((e) => e.type === 'shuriken')).to.exist;
  });

  it('a decline leaves state alone and spends nothing', () => {
    let r = mind.startVote(base(), 'u1', T);
    const hands = r.state.hands;
    r = mind.castVote(r.state, 'u2', false, T + 1);
    expect(r.state.vote).to.equal(null);
    expect(r.state.shurikens).to.equal(1);
    expect(r.state.hands).to.deep.equal(hands);
  });

  it('blocks play lowest and a second vote while one is open', () => {
    const r = mind.startVote(base(), 'u1', T);
    expect(mind.playLowest(r.state, 'u2', T + 1).error).to.match(/vote/);
    expect(mind.startVote(r.state, 'u2', T + 1).error).to.match(/already/);
  });

  it('an expired vote lapses without spending anything', () => {
    const r = mind.startVote(base(), 'u1', T);
    const later = T + mind.VOTE_MS + 1;
    const played = mind.playLowest(r.state, 'u1', later);
    expect(played.error).to.equal(undefined);
    expect(played.state.vote).to.equal(null);
    expect(played.state.shurikens).to.equal(1);
    const expired = mind.castVote(r.state, 'u2', true, later);
    expect(expired.state.vote).to.equal(null);
    expect(expired.state.shurikens).to.equal(1);
  });

  it('excludes players with empty hands from the vote', () => {
    const s = withHands(base(), { u3: [] });
    let r = mind.startVote(s, 'u1', T);
    expect(mind.castVote(r.state, 'u3', true, T).error).to.match(/holding cards/);
    r = mind.castVote(r.state, 'u2', true, T + 1);
    expect(r.state.shurikens).to.equal(0); // resolved without u3
    expect(r.state.hands.u3).to.deep.equal([]);
  });

  it('a lone card holder resolves immediately and can clear the level', () => {
    const s = withHands(base(), { u1: [7], u2: [], u3: [] });
    const r = mind.startVote(s, 'u1', T);
    expect(r.state.shurikens).to.equal(1 + 1 - 1); // spent, then level 2 reward
    expect(r.state.phase).to.equal('between');
    expect(r.events.map((e) => e.type)).to.include('level_cleared');
  });

  it('refuses when out of shurikens, no cards, or not playing', () => {
    expect(mind.startVote({ ...base(), shurikens: 0 }, 'u1', T).error).to.match(/no shurikens/);
    expect(mind.startVote(withHands(base(), { u1: [] }), 'u1', T).error).to.match(/no cards/);
    expect(mind.startVote(base(), 'nobody', T).error).to.be.a('string');
    expect(mind.startVote({ ...base(), phase: 'between' }, 'u1', T).error).to.be.a('string');
    expect(mind.castVote(base(), 'u1', true, T).error).to.match(/no shuriken vote/);
  });
});

describe('mind: ending and stats', () => {
  it('ending a lobby counts for nothing', () => {
    const lobby = mind.newLobby({ hostId: 'h', channelId: CH, guildId: 'g', now: T });
    const r = mind.endGame(lobby, 'ended', T + 5);
    expect(r.state.phase).to.equal('ended');
    expect(r.events[0].type).to.equal('cancelled');
    expect(mind.statsFor(r.state).players).to.deep.equal([]);
    expect(mind.panelMessage(r.state).components).to.deep.equal([]);
  });

  it('ending mid-game is a loss and records the best level', () => {
    const s = { ...started(3), level: 4, maxLevelReached: 4 };
    const r = mind.endGame(s, 'timeout', T);
    expect(r.state.endReason).to.equal('timeout');
    expect(r.events[0]).to.deep.equal({ type: 'lost', reason: 'timeout' });
    expect(mind.statsFor(r.state)).to.deep.equal({
      players: ['u1', 'u2', 'u3'],
      won: false,
      bestLevel: 4,
    });
    expect(mind.endGame(r.state, 'ended', T).error).to.be.a('string');
  });
});

describe('mind: messages', () => {
  it('lobby message has four buttons, Begin disabled below 2 players', () => {
    const lobby = mind.newLobby({ hostId: 'h', channelId: CH, guildId: 'g', now: T });
    const msg = mind.lobbyMessage(lobby);
    const buttons = msg.components[0].components;
    expect(buttons.map((b) => b.custom_id)).to.deep.equal([
      'mind_join|chan',
      'mind_leave|chan',
      'mind_begin|chan',
      'mind_cancel|chan',
    ]);
    expect(buttons[2].disabled).to.equal(true);
    expect(msg.embeds[0].description).to.include('<@h>');
  });

  it('panel never reveals card values and shows buttons per phase', () => {
    const s = withHands(started(2), { u1: [41], u2: [77] }, { level: 1 });
    const msg = mind.panelMessage(s);
    const text = JSON.stringify(msg);
    expect(text).to.not.include('41');
    expect(text).to.not.include('77');
    expect(msg.components[0].components.map((b) => b.custom_id)).to.deep.equal([
      'mind_play|chan',
      'mind_hand|chan',
      'mind_shuriken|chan',
    ]);
    const noStars = mind.panelMessage({ ...s, shurikens: 0 });
    expect(noStars.components[0].components[2].disabled).to.equal(true);
    const between = mind.panelMessage({ ...s, phase: 'between' });
    expect(between.components[0].components[0].custom_id).to.equal('mind_next|chan');
    expect(mind.panelMessage({ ...s, phase: 'won' }).components).to.deep.equal([]);
  });

  it('panel truncates a long pile and shows the Missed line', () => {
    const s = withHands(started(2), { u1: [1], u2: [2] });
    const msg = mind.panelMessage({
      ...s,
      pile: Array.from({ length: 30 }, (_, i) => i + 1),
      lastMistake: { played: 30, discarded: [3, 4] },
    });
    const fields = msg.embeds[0].fields;
    expect(fields.find((f) => f.name === 'Pile').value).to.match(/^… → 21 → /);
    expect(fields.find((f) => f.name === 'Missed').value).to.equal('3, 4');
  });

  it('vote message carries yes/no buttons on the panel', () => {
    const s = mind.startVote(
      withHands(started(2), { u1: [5], u2: [9] }, { level: 1 }),
      'u1',
      T,
    ).state;
    const msg = mind.panelMessage(s);
    expect(msg.components[0].components.map((b) => b.custom_id)).to.deep.equal([
      'mind_vote|chan|yes',
      'mind_vote|chan|no',
    ]);
    expect(msg.embeds.at(-1).description).to.include('<@u2>');
  });

  it('hand message is ephemeral and sorted; outsiders are rejected', () => {
    const s = withHands(started(2), { u1: [3, 9], u2: [] });
    expect(mind.handMessage(s, 'u1')).to.deep.equal({
      content: 'Your hand: **3, 9**',
      flags: 64,
    });
    expect(mind.handMessage(s, 'u2').content).to.match(/no cards/);
    expect(mind.handMessage(s, 'zzz').flags).to.equal(64);
  });
});

describe('mind: full game', () => {
  it('a 4-player game can be played from start to win with the API only', () => {
    const rng = seeded(42);
    let state = mind.newLobby({ hostId: 'u1', channelId: CH, guildId: 'g', now: T });
    for (const u of ['u2', 'u3', 'u4']) {
      state = mind.join(state, u, T).state;
    }
    state = mind.begin(state, 'u1', T, rng).state;
    expect(state.totalLevels).to.equal(8);
    let now = T;
    let won = false;
    while (state.phase !== 'won') {
      expect(state.phase).to.not.equal('lost');
      if (state.phase === 'between') {
        state = mind.nextLevel(state, ++now, rng).state;
        continue;
      }
      // Play in global ascending order: the player holding the lowest card plays.
      const owner = state.players
        .filter((p) => state.hands[p].length)
        .sort((a, b) => state.hands[a][0] - state.hands[b][0])[0];
      const r = mind.playLowest(state, owner, ++now);
      expect(r.error).to.equal(undefined);
      expect(r.events.map((e) => e.type)).to.not.include('mistake');
      state = r.state;
      won ||= r.events.some((e) => e.type === 'won');
    }
    expect(won).to.equal(true);
    expect(state.lives).to.be.at.least(4);
    expect(mind.statsFor(state)).to.deep.equal({
      players: ['u1', 'u2', 'u3', 'u4'],
      won: true,
      bestLevel: 8,
    });
  });
});
