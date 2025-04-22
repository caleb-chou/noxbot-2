export class UserData {
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/increment') {
      const key = 'count';
      let count = (await this.state.storage.get(key)) || 0;
      count++;
      await this.state.storage.put(key, count);
      return new Response(JSON.stringify({ count }));
    }

    if (pathname === '/get') {
      const allData = await this.state.storage.list();
      return new Response(JSON.stringify(Object.fromEntries(allData)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
