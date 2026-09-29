import { score_guess } from '../functions/lengthwave.js';
import { MAX_REMINDERS, reminderMessage } from '../functions/remind.js';
import { sendDM } from '../util.js';

// Not stats: /get feeds the stats embed and must not leak these, and the
// admin stat commands must not overwrite or delete them.
const INTERNAL_KEYS = new Set(['mailbox', 'settings', 'reminders']);
const isInternal = (key) => INTERNAL_KEYS.has(key) || key.startsWith('chat:');

const bad = (error) => Response.json({ error }, { status: 400 });

export class UserData {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);
    const storage = this.state.storage;

    if (pathname === '/increment') {
      const data = await request.json();
      if (!data.key || isInternal(data.key)) {
        return bad('Invalid stat.');
      }
      const by = Number(data.by ?? 1);
      if (!Number.isFinite(by)) {
        return bad('Invalid amount.');
      }
      const count = ((await storage.get(data.key)) || 0) + by;
      await storage.put(data.key, count);
      return Response.json({ [data.key]: count });
    }

    if (pathname === '/get') {
      const allData = await storage.list();
      return Response.json(
        Object.fromEntries([...allData].filter(([key]) => !isInternal(key))),
      );
    }

    if (pathname === '/set') {
      const data = await request.json();
      const [key, value] = Object.entries(data)[0] ?? [];
      if (!key || value === undefined || isInternal(key)) {
        return bad('Invalid stat.');
      }
      await storage.put(key, value);
      return Response.json({ [key]: value });
    }

    // Stats only: mail, settings and chat tracking belong to the user.
    if (pathname === '/dropStats') {
      const keys = [...(await storage.list()).keys()].filter((k) => !isInternal(k));
      if (keys.length) {
        await storage.delete(keys);
      }
      return Response.json({ deleted: keys });
    }

    if (pathname === '/addToMailbox') {
      const mail = await request.json();
      const mailbox = (await storage.get('mailbox')) || [];

      if (mailbox.length >= 10) {
        return bad('Mailbox is full. Max 10 messages allowed.');
      }
      mailbox.push(mail);
      await storage.put('mailbox', mailbox);
      return Response.json({ success: true, message: 'Mail Sent.' });
    }

    if (pathname === '/getMailbox' && request.method === 'GET') {
      return Response.json({ mailbox: (await storage.get('mailbox')) || [] });
    }

    // No index clears the mailbox; otherwise a 1-based index deletes one mail.
    if (pathname === '/deleteMail' && request.method === 'POST') {
      const { index } = await request.json();
      const mailbox = (await storage.get('mailbox')) || [];

      if (index === undefined || index === null) {
        await storage.put('mailbox', []);
        return Response.json({ success: true, message: 'Mailbox cleared.' });
      }

      const n = Number(index);
      if (!Number.isInteger(n) || n < 1 || n > mailbox.length) {
        return bad('Invalid or out of bounds index.');
      }

      mailbox.splice(n - 1, 1);
      await storage.put('mailbox', mailbox);
      return Response.json({ success: true, message: 'Mail deleted.' });
    }

    if (pathname === '/getSettings') {
      return Response.json((await storage.get('settings')) || {});
    }

    if (pathname === '/updateSettings') {
      const settings = (await storage.get('settings')) || {};
      const [key, value] = Object.entries(await request.json())[0] ?? [];
      if (!key) {
        return bad('Invalid setting.');
      }
      settings[key] = value;
      await storage.put('settings', settings);
      return Response.json(settings);
    }

    if (pathname === '/lengthwave' && request.method === 'POST') {
      const { gameId, game_data } = await request.json();
      await storage.put(gameId, game_data);
      return Response.json({ [gameId]: game_data });
    }

    if (pathname === '/lengthwave' && request.method === 'GET') {
      const game_data = await storage.get(searchParams.get('gameId'));
      if (!game_data) {
        return Response.json({ error: 'Game not found' }, { status: 404 });
      }
      return Response.json(game_data);
    }

    // Claim a guess and bank its score in one step. The DO runs single-threaded,
    // so nobody can score the same gamut twice, and the claim and the score
    // can't drift apart.
    if (pathname === '/lengthwave/guess' && request.method === 'POST') {
      const { gameId, userId, guess } = await request.json();
      const game_data = await storage.get(gameId);

      if (!game_data) {
        return Response.json({ error: 'Game not found' }, { status: 404 });
      }

      const guessed = game_data.guessed ?? [];
      const already = guessed.includes(userId);
      // The creator saw the position, so their own guess must never score.
      const ownGamut = game_data.creator === userId;

      if (!already) {
        game_data.guessed = [...guessed, userId];
        await storage.put(gameId, game_data);
      }

      if (!already && !ownGamut) {
        const scores = await this.scores();
        const row = scores[userId] ?? { score: 0, games: 0 };
        scores[userId] = {
          score: row.score + score_guess(game_data, guess).score,
          games: row.games + 1,
        };
        await storage.put('scores', scores);
      }

      return Response.json({ game_data, already, ownGamut });
    }

    // ponytail: one global scoreboard, not per-guild. Split by guild if this
    // bot ever lives in more than one server.
    if (pathname === '/lengthwave/scores') {
      return Response.json(await this.scores());
    }

    // Reminders fire from this DO's single alarm, always set to the earliest one.
    if (pathname === '/addReminder' && request.method === 'POST') {
      const reminder = await request.json();
      const reminders = (await storage.get('reminders')) ?? [];
      if (reminders.length >= MAX_REMINDERS) {
        return bad(`You already have ${MAX_REMINDERS} reminders waiting.`);
      }
      reminders.push({ ...reminder, id: crypto.randomUUID() });
      reminders.sort((a, b) => a.at - b.at);
      await storage.put('reminders', reminders);
      await storage.setAlarm(reminders[0].at);
      return Response.json({ ok: true, pending: reminders.length });
    }

    if (pathname === '/getReminders') {
      return Response.json((await storage.get('reminders')) ?? []);
    }

    // Returns what's left, so the caller can redraw the list.
    if (pathname === '/cancelReminder' && request.method === 'POST') {
      const { id } = await request.json();
      const rest = ((await storage.get('reminders')) ?? []).filter((r) => r.id !== id);
      await storage.put('reminders', rest);
      if (rest.length) {
        await storage.setAlarm(rest[0].at);
      } else {
        await storage.deleteAlarm();
      }
      return Response.json(rest);
    }

    if (pathname === '/getChat') {
      const key = `chat:${searchParams.get('channelId')}`;
      return Response.json((await storage.get(key)) ?? {});
    }

    if (pathname === '/setChat' && request.method === 'POST') {
      const key = `chat:${searchParams.get('channelId')}`;
      await storage.put(key, await request.json());
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm() {
    const storage = this.state.storage;
    const reminders = (await storage.get('reminders')) ?? [];
    const now = Date.now();
    const due = reminders.filter((r) => r.at <= now);
    const rest = reminders.filter((r) => r.at > now);

    // Saved before sending: a failed DM is dropped rather than re-sent on retry.
    await storage.put('reminders', rest);
    if (rest.length) {
      await storage.setAlarm(rest[0].at);
    }
    for (const r of due) {
      await sendDM(this.env, r.userId, reminderMessage(r));
    }
  }

  /** { [userId]: { score, games } } for the lengthwave DO. */
  async scores() {
    const scores = await this.state.storage.get('scores');
    if (scores) {
      return scores;
    }

    // ponytail: one-off migration from the old `players` roster, whose scores
    // lived in each player's own DO. Delete once prod has a `scores` key.
    const players = (await this.state.storage.get('players')) ?? [];
    const migrated = Object.fromEntries(
      await Promise.all(
        players.map(async (id) => {
          const ns = this.env.NOXBOT_DATA;
          const stats = await (
            await ns.get(ns.idFromName(id)).fetch('https://dummy/get')
          ).json();
          return [id, { score: stats.gamut_score ?? 0, games: stats.gamut_games ?? 0 }];
        }),
      ),
    );
    if (players.length) {
      await this.state.storage.put('scores', migrated);
      await this.state.storage.delete('players');
    }
    return migrated;
  }
}
