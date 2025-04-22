export class UserData {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/increment') {
      const data = await request.json();
      if (!data.body) {
        return new Response('Invalid data', { status: 400 });
      }
      let count = (await this.state.storage.get(data.body)) || 0;
      count++;
      await this.state.storage.put(data.body, count);
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
      if (!key || !value) {
        return new Response('Invalid data', { status: 400 });
      }
      await this.state.storage.put(key, value);
      return new Response(JSON.stringify({ [key]: value }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
