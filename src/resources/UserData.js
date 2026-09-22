// Not stats: /get feeds the stats embed and must not leak these.
const INTERNAL_KEYS = new Set(['mailbox', 'settings']);
const isInternal = (key) => INTERNAL_KEYS.has(key) || key.startsWith('chat:');

export class UserData {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === '/increment') {
      const data = await request.json();
      if (!data.key) {
        return new Response('Invalid data', { status: 400 });
      }
      const by = Number(data.by ?? 1);
      if (!Number.isFinite(by)) {
        return new Response('Invalid data', { status: 400 });
      }
      const count = ((await this.state.storage.get(data.key)) || 0) + by;
      await this.state.storage.put(data.key, count);
      return new Response(JSON.stringify({ [data.key]: count }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/get') {
      const allData = await this.state.storage.list();
      const stats = Object.fromEntries(
        [...allData].filter(([key]) => !isInternal(key)),
      );
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/set') {
      const data = await request.json();
      const [key, value] = Object.entries(data)[0] ?? [];
      if (!key || value === undefined) {
        return new Response('Invalid data', { status: 400 });
      }
      await this.state.storage.put(key, value);
      return new Response(JSON.stringify({ [key]: value }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/deleteAll') {
      await this.state.storage.deleteAll();
      return new Response(JSON.stringify({ deleted: 'everything >:)' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/addToMailbox') {
      const mail = await request.json();
      const mailbox = (await this.state.storage.get('mailbox')) || [];

      if (mailbox.length >= 10) {
        return new Response(
          JSON.stringify({ error: 'Mailbox is full. Max 10 messages allowed.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      mailbox.push(mail);
      await this.state.storage.put('mailbox', mailbox);
      return new Response(JSON.stringify({ success: true, message: 'Mail Sent.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/getMailbox' && request.method === 'GET') {
      const mailbox = (await this.state.storage.get('mailbox')) || [];

      return new Response(JSON.stringify({ mailbox }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/deleteMail' && request.method === 'POST') {
      const data = await request.json();
      const index = Number(data.index) - 1;
      const mailbox = (await this.state.storage.get('mailbox')) || [];

      if (Number.isNaN(index)) {
        return new Response(JSON.stringify({ error: 'Invalid index.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (index < 0) {
        // No index provided → clear mailbox
        await this.state.storage.put('mailbox', []);
        return new Response(JSON.stringify({ success: true, message: 'Mailbox cleared.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (index >= mailbox.length) {
        return new Response(JSON.stringify({ error: 'Invalid or out of bounds index.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      mailbox.splice(index, 1); // Remove the specific mail

      await this.state.storage.put('mailbox', mailbox);

      return new Response(JSON.stringify({ success: true, message: 'Mail deleted.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/getSettings') {
      const settings = (await this.state.storage.get('settings')) || {};
      return new Response(JSON.stringify(settings), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/updateSettings') {
      const settings = (await this.state.storage.get('settings')) || {};
      const data = await request.json();
      const [key, value] = Object.entries(data)[0] ?? [];
      if (!key) {
        return new Response('Invalid data', { status: 400 });
      }

      settings[key] = value;

      await this.state.storage.put('settings', settings);

      return new Response(JSON.stringify(settings), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/lengthwave' && request.method === 'POST') {
      const data = await request.json();
      // console.log(data)
      const {gameId, game_data} = data;

      await this.state.storage.put(gameId, game_data);

      return new Response(JSON.stringify({ [gameId]: game_data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/lengthwave' && request.method === 'GET') {
      const gameId = searchParams.get('gameId');
      const game_data = await this.state.storage.get(gameId);

      if (!game_data) {
        return new Response(JSON.stringify({ error: 'Game not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(game_data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Claim a guess. The DO runs single-threaded, so the read-modify-write of
    // the guessed list is atomic and nobody can score the same gamut twice.
    if (pathname === '/lengthwave/guess' && request.method === 'POST') {
      const { gameId, userId } = await request.json();
      const game_data = await this.state.storage.get(gameId);

      if (!game_data) {
        return Response.json({ error: 'Game not found' }, { status: 404 });
      }

      const guessed = game_data.guessed ?? [];
      const already = guessed.includes(userId);
      if (!already) {
        game_data.guessed = [...guessed, userId];
        await this.state.storage.put(gameId, game_data);
      }

      return Response.json({ game_data, already });
    }

    // ponytail: one global roster, not per-guild. Split by guild if this bot
    // ever lives in more than one server.
    if (pathname === '/lengthwave/players' && request.method === 'POST') {
      const { userId } = await request.json();
      const players = (await this.state.storage.get('players')) ?? [];

      if (!players.includes(userId)) {
        await this.state.storage.put('players', [...players, userId]);
      }

      return Response.json({ ok: true });
    }

    if (pathname === '/lengthwave/players') {
      return Response.json({
        players: (await this.state.storage.get('players')) ?? [],
      });
    }

    if (pathname === '/getChat') {
      const key = `chat:${searchParams.get('channelId')}`;
      return Response.json((await this.state.storage.get(key)) ?? {});
    }

    if (pathname === '/setChat' && request.method === 'POST') {
      const key = `chat:${searchParams.get('channelId')}`;
      await this.state.storage.put(key, await request.json());
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }
}
