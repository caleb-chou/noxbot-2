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
      let count = (await this.state.storage.get(data.key)) || 0;
      count++;
      await this.state.storage.put(data.key, count);
      return new Response(JSON.stringify({ count }));
    }

    if (pathname === '/get') {
      const allData = await this.state.storage.list();
      return new Response(JSON.stringify(Object.fromEntries(allData)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/set') {
      const data = await request.json();
      const [key, value] = Object.entries(data)[0];
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
      console.log(mailbox)
      await this.state.storage.put('mailbox', mailbox);
      return new Response(JSON.stringify({ success: true, message: 'Mail Sent.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/getMailbox' && request.method === 'GET') {
      const mailbox = (await this.state.storage.get('mailbox')) || [];

      return new Response(JSON.stringify({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        mailbox: mailbox
      }));
    }

    if (pathname === '/deleteMail' && request.method === 'POST') {
      const data = await request.json();
      const index = data.index - 1;

      let mailbox = (await this.state.storage.get('mailbox')) || [];

      if (index < 0) {
        // No index provided → clear mailbox
        await this.state.storage.put('mailbox', []);
        return new Response(JSON.stringify({ success: true, message: 'Mailbox cleared.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (typeof index !== 'number' || index < 0 || index >= mailbox.length) {
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
      const settings = await (this.state.storage.get('settings')) || {};
      return new Response(JSON.stringify(settings))
    }

    if (pathname === '/updateSettings') {
      const settings = await (this.state.storage.get('settings')) || {};
      const data = await request.json()
      const [key, value] = Object.entries(data)[0];

      settings[key] = value;

      await this.state.storage.put('settings', settings);

      return new Response(JSON.stringify(settings))
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

    if (pathname === '/chattrack' && request.method === 'POST') {
      const userId = searchParams.get('userId');
    }

    return new Response('Not found', { status: 404 });
  }
}
