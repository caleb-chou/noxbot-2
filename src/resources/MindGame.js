// One Durable Object per channel ('mind:' + channelId) holds a game of The Mind.
// Thin on purpose: load state, call the pure logic in functions/mind.js, save,
// re-arm the idle alarm, answer. Every route replies with JSON
// { state, events, message } or { error }.
import {
  IDLE_MS,
  begin,
  castVote,
  endGame,
  handMessage,
  join,
  leave,
  newLobby,
  nextLevel,
  panelMessage,
  playLowest,
  startVote,
  statsFor,
} from '../functions/mind.js';
import { DISCORD_API } from '../util.js';

const GAME = 'game';
const TOMBSTONE_MS = 24 * 60 * 60_000;
const TERMINAL = ['won', 'lost', 'ended'];
const ACTIVE = ['lobby', 'playing', 'between'];

const reply = (body) => Response.json(body);
const fail = (error) => reply({ error });

export class MindGame {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
    // Awaiting other DOs (stats) can let requests interleave, so a local
    // queue keeps every route atomic and ordered.
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const run = this.queue.then(() => this.handle(request));
    this.queue = run.catch(() => {});
    return run;
  }

  async handle(request) {
    const { pathname } = new URL(request.url);
    const route = pathname.slice(1);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const now = Date.now();
    const game = await this.state.storage.get(GAME);

    if (route === 'lobby') {
      // A finished game's tombstone may be replaced; a live one may not.
      if (game && ACTIVE.includes(game.phase)) {
        return fail('This channel already has a game in progress.');
      }
      const lobby = newLobby({
        hostId: body.hostId,
        channelId: body.channelId,
        guildId: body.guildId,
        now,
      });
      return this.commit(lobby, [{ type: 'lobby_created' }], now);
    }

    if (!game) {
      return fail('There is no game in this channel.');
    }

    if (route === 'state') {
      return reply({ state: game, events: [], message: panelMessage(game) });
    }

    if (route === 'setMessage') {
      const next = { ...game, messageId: body.messageId };
      await this.state.storage.put(GAME, next);
      return reply({ state: next, events: [], message: panelMessage(next) });
    }

    if (!ACTIVE.includes(game.phase)) {
      return fail('This game is over.');
    }

    // A click carries the id of the message it sits on. Until /setMessage has
    // stored ours, no click can be told from a stale panel's, so ask for a retry.
    if (body.messageId) {
      if (!game.messageId) {
        return fail('The game is still being set up. Try again in a moment.');
      }
      if (body.messageId !== game.messageId) {
        return fail('This game is over. That message is out of date.');
      }
    }

    const { userId } = body;
    if (route === 'hand') {
      return reply({ state: game, events: [], message: handMessage(game, userId) });
    }

    let result;
    switch (route) {
      case 'join':
        result = join(game, userId, now);
        break;
      case 'leave':
        result = leave(game, userId, now);
        break;
      case 'begin':
        result = begin(game, userId, now);
        break;
      case 'play':
        result = playLowest(game, userId, now);
        break;
      case 'shuriken':
        result = startVote(game, userId, now);
        break;
      case 'vote':
        result = castVote(game, userId, body.agree === true, now);
        break;
      case 'next':
        result = game.players.includes(userId)
          ? nextLevel(game, now)
          : { error: 'You are not in this game.' };
        break;
      case 'cancel':
        result = this.canEnd(game, userId, body.isAdmin, true) ?? endGame(game, 'ended', now);
        break;
      case 'end':
        result = this.canEnd(game, userId, body.isAdmin, false) ?? endGame(game, 'ended', now);
        break;
      default:
        return new Response('Not found', { status: 404 });
    }
    if (result.error) {
      return fail(result.error);
    }
    return this.commit(result.state, result.events, now);
  }

  /** Host, a participant or an admin may end; Cancel is host or admin only. */
  canEnd(game, userId, isAdmin, hostOnly) {
    if (isAdmin || userId === game.hostId) {
      return null;
    }
    if (!hostOnly && game.players.includes(userId)) {
      return null;
    }
    return { error: 'Only the host or an admin can do that.' };
  }

  /** Save, re-arm the alarm, and write stats the first time a game ends. */
  async commit(next, events, now) {
    const finished = TERMINAL.includes(next.phase);
    let owed = null;
    if (finished && !next.statsWritten) {
      // Flag saved before any write: a failed write is dropped, never doubled.
      next.statsWritten = true;
      owed = statsFor(next);
    }
    await this.state.storage.put(GAME, next);
    await this.state.storage.setAlarm(
      finished ? now + TOMBSTONE_MS : next.updatedAt + IDLE_MS,
    );
    if (owed) {
      await this.later(this.writeStats(owed));
    }
    return reply({ state: next, events, message: panelMessage(next) });
  }

  /** Off the response path in production; awaited when there is no waitUntil. */
  async later(promise) {
    const safe = promise.catch((err) => console.error('mind stats failed:', err));
    if (this.state.waitUntil) {
      this.state.waitUntil(safe);
    } else {
      await safe;
    }
  }

  async data(name, path, body) {
    const ns = this.env.NOXBOT_DATA;
    const res = await ns.get(ns.idFromName(name)).fetch(`https://dummy${path}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
    return res.json();
  }

  /** games_played / games_won / best_level per player, plus the leaderboard aggregate. */
  async writeStats({ players, won, bestLevel }) {
    if (players.length === 0) {
      return;
    }
    const ns = this.env.NOXBOT_DATA;
    const get = async (name) =>
      (await ns.get(ns.idFromName(name)).fetch('https://dummy/get')).json();

    for (const id of players) {
      try {
        await this.data(id, '/increment', { key: 'mind_games_played' });
        if (won) {
          await this.data(id, '/increment', { key: 'mind_games_won' });
        }
        const stats = await get(id);
        if (bestLevel > (stats.mind_best_level ?? 0)) {
          await this.data(id, '/set', { mind_best_level: bestLevel });
        }
      } catch (err) {
        console.error('mind player stats failed:', id, err);
      }
    }

    // Leaderboard aggregate: stored under the 'mind' key of the UserData
    // instance named 'mind' (plain /get and /set, no UserData changes).
    const aggregate = (await get('mind')).mind ?? {};
    for (const id of players) {
      const row = aggregate[id] ?? { bestLevel: 0, wins: 0, games: 0 };
      aggregate[id] = {
        bestLevel: Math.max(row.bestLevel, bestLevel),
        wins: row.wins + (won ? 1 : 0),
        games: row.games + 1,
      };
    }
    await this.data('mind', '/set', { mind: aggregate });
  }

  async alarm() {
    const storage = this.state.storage;
    const game = await storage.get(GAME);
    if (!game) {
      return;
    }
    if (TERMINAL.includes(game.phase)) {
      await storage.delete(GAME);
      return;
    }
    const now = Date.now();
    // A stale alarm from before the last action: just re-arm.
    if (now < game.updatedAt + IDLE_MS) {
      await storage.setAlarm(game.updatedAt + IDLE_MS);
      return;
    }
    const result = endGame(game, 'timeout', now);
    if (result.error) {
      return;
    }
    const res = await this.commit(result.state, result.events, now);
    const { message } = await res.json();
    await this.editPanel(result.state, message);
  }

  /** Show the timeout on the panel. A deleted panel (404) just drops the state. */
  async editPanel(game, message) {
    if (!game.messageId) {
      return;
    }
    try {
      const res = await fetch(
        `${DISCORD_API}/channels/${game.channelId}/messages/${game.messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        },
      );
      if (res.status === 404) {
        await this.state.storage.delete(GAME);
      } else if (!res.ok) {
        console.error('mind panel edit failed:', res.status, await res.text());
      }
    } catch (err) {
      console.error('mind panel edit failed:', err);
    }
  }
}
