import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  InteractionType,
  InteractionResponseType,
} from 'discord-interactions';
import {
  ALL_PROMPTS,
  calculate_score,
  generate_guess_response_message_embed,
} from '../src/functions/lengthwave.js';
import { UserData } from '../src/resources/UserData.js';
import { createMailboxEmbed } from '../src/functions/mailbox.js';
import { createChatStatsEmbed } from '../src/functions/chattrack.js';
import { deferred, sendMailNotification } from '../src/util.js';
import * as commands from '../src/commands.js';
import server from '../src/server.js';
import sinon from 'sinon';

/** Minimal stand-in for Durable Object storage. */
function fakeCtx(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      list: async () => new Map(map),
      deleteAll: async () => map.clear(),
    },
  };
}

const post = (obj, path, body) =>
  obj.fetch(
    new Request(`https://dummy${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

describe('lengthwave', () => {
  it('marks the guess at the guess, not at the answer', () => {
    const body = generate_guess_response_message_embed(
      'game-1',
      { prompt: { left: 'a', right: 'b' }, position: 0.1 },
      0.9,
      { username: 'nox', id: '1', avatar: null },
    );
    const lines = body.data.embeds[0].description.split('\n');
    const actual = lines.find((l) => l.includes('Actual'));
    const guess = lines.find((l) => l.includes('Your guess'));

    expect(actual).to.not.include('Your guess');
    expect(guess).to.include('0.9');
    expect(lines.indexOf(actual)).to.not.equal(lines.indexOf(guess));
  });

  it('scores by distance', () => {
    expect(calculate_score(0)).to.equal(4);
    expect(calculate_score(0.05)).to.equal(3);
    expect(calculate_score(0.5)).to.equal(0);
  });

  it('exposes every category as a list of prompt pairs', () => {
    expect(ALL_PROMPTS).to.have.lengthOf(2);
    for (const category of ALL_PROMPTS) {
      for (const pair of category) expect(pair).to.have.lengthOf(2);
    }
  });
});

describe('UserData', () => {
  it('/increment echoes the stat key the caller asked for', async () => {
    const res = await post(new UserData(fakeCtx({ kills: 2 })), '/increment', {
      key: 'kills',
    });
    expect(await res.json()).to.deep.equal({ kills: 3 });
  });

  it('/get returns stats without mailbox or settings', async () => {
    const ctx = fakeCtx({ kills: 3, mailbox: [{}], settings: { a: 1 } });
    const res = await new UserData(ctx).fetch(new Request('https://dummy/get'));
    expect(await res.json()).to.deep.equal({ kills: 3 });
  });

  it('/deleteMail rejects out of bounds and non-numeric indexes', async () => {
    const mailbox = [{ sender: 'a' }, { sender: 'b' }];
    const tooHigh = await post(new UserData(fakeCtx({ mailbox })), '/deleteMail', {
      index: 5,
    });
    expect(tooHigh.status).to.equal(400);

    const notANumber = await post(
      new UserData(fakeCtx({ mailbox })),
      '/deleteMail',
      { index: 'oops' },
    );
    expect(notANumber.status).to.equal(400);
  });

  it('/deleteMail removes the 1-indexed entry', async () => {
    const ctx = fakeCtx({ mailbox: [{ sender: 'a' }, { sender: 'b' }] });
    await post(new UserData(ctx), '/deleteMail', { index: 1 });
    expect(await ctx.storage.get('mailbox')).to.deep.equal([{ sender: 'b' }]);
  });
});

describe('sendmail recipient validation', () => {
  it('refuses a recipient that is not a user id', async () => {
    const stub = sinon.stub(server, 'verifyDiscordRequest').resolves({
      isValid: true,
      interaction: {
        type: InteractionType.MODAL_SUBMIT,
        member: { user: { username: 'nox' } },
        data: {
          custom_id: 'mailbox_modal',
          components: [
            { components: [{ custom_id: 'recipient_input', value: 'nox' }] },
            { components: [{ custom_id: 'subject_input', value: 'hi' }] },
            { components: [{ custom_id: 'message_input', value: 'hello' }] },
          ],
        },
      },
    });

    try {
      const env = {
        NOXBOT_DATA: {
          idFromName: () => {
            throw new Error('must not touch storage for an invalid recipient');
          },
        },
      };
      const response = await server.fetch(
        { method: 'POST', url: new URL('/', 'http://discordo.example') },
        env,
      );
      const body = await response.json();
      expect(body.data.content).to.include('not a user ID');
    } finally {
      stub.restore();
    }
  });
});

describe('deferred responses', () => {
  const interaction = { token: 'tok' };
  const env = { DISCORD_APPLICATION_ID: 'app' };

  it('acks within the window and edits the original afterwards', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), ...init });
      return new Response('{}');
    };

    try {
      const res = await deferred(env, null, interaction, async () => ({
        content: 'done',
      }));
      expect((await res.json()).type).to.equal(
        InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      );
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].url).to.include('/webhooks/app/tok/messages/@original');
      expect(calls[0].method).to.equal('PATCH');
      expect(JSON.parse(calls[0].body).content).to.equal('done');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('reports a thrown error back to the user instead of hanging', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response('{}');
    };

    try {
      await deferred(env, null, interaction, async () => {
        throw new Error('7tv is down');
      });
      expect(calls[0].content).to.include('7tv is down');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('hands the task to waitUntil when a context exists', async () => {
    const pending = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}');

    try {
      await deferred(
        env,
        { waitUntil: (p) => pending.push(p) },
        interaction,
        async () => ({ content: 'x' }),
      );
      expect(pending).to.have.lengthOf(1);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('lengthwave scoring', () => {
  it('/increment adds `by` so a 0-4 score can be banked in one call', async () => {
    const ctx = fakeCtx({ gamut_score: 10 });
    const res = await post(new UserData(ctx), '/increment', {
      key: 'gamut_score',
      by: 3,
    });
    expect(await res.json()).to.deep.equal({ gamut_score: 13 });
  });

  it('claims a guess once, so the same gamut cannot be farmed', async () => {
    const ctx = fakeCtx({ g1: { position: 0.5, prompt: { left: 'a', right: 'b' } } });
    const obj = new UserData(ctx);

    const first = await post(obj, '/lengthwave/guess', { gameId: 'g1', userId: 'u1' });
    expect((await first.json()).already).to.equal(false);

    const second = await post(obj, '/lengthwave/guess', { gameId: 'g1', userId: 'u1' });
    expect((await second.json()).already).to.equal(true);

    const other = await post(obj, '/lengthwave/guess', { gameId: 'g1', userId: 'u2' });
    expect((await other.json()).already).to.equal(false);
  });

  it('tracks the player roster without duplicates', async () => {
    const ctx = fakeCtx();
    const obj = new UserData(ctx);
    await post(obj, '/lengthwave/players', { userId: 'u1' });
    await post(obj, '/lengthwave/players', { userId: 'u1' });
    await post(obj, '/lengthwave/players', { userId: 'u2' });

    const res = await obj.fetch(new Request('https://dummy/lengthwave/players'));
    expect((await res.json()).players).to.deep.equal(['u1', 'u2']);
  });
});

describe('mailbox rendering', () => {
  const longMail = {
    sender: 'nox',
    subject: 'a subject',
    message: 'x'.repeat(2000),
  };

  it('shows the subject it collects', () => {
    const body = createMailboxEmbed({ username: 'a', id: '1' }, [longMail]);
    expect(body.data.embeds[0].fields[0].name).to.include('a subject');
  });

  it('keeps a full mailbox inside Discord field and embed limits', () => {
    const body = createMailboxEmbed(
      { username: 'a', id: '1' },
      Array(10).fill(longMail),
    );
    const [embed] = body.data.embeds;
    let total = 0;
    for (const f of embed.fields) {
      expect(f.name.length).to.be.at.most(256);
      expect(f.value.length).to.be.at.most(1024);
      total += f.name.length + f.value.length;
    }
    expect(total).to.be.at.most(6000);
    expect(embed.fields[0].value).to.include('/readmail 1');
  });
});

describe('chat stats', () => {
  it('ranks words by count and caps the list', () => {
    const words = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`w${i}`, i]),
    );
    const { embeds } = createChatStatsEmbed({ username: 'a', id: '1' }, {
      words,
      messages: 99,
    });
    const lines = embeds[0].description.split('\n');
    expect(lines).to.have.lengthOf(15);
    expect(lines[0]).to.include('w39');
    expect(embeds[0].footer.text).to.include('99');
  });
});

describe('DM support', () => {
  it('scopes every command to a context, and none is left undeclared', () => {
    for (const [name, cmd] of Object.entries(commands)) {
      expect(cmd.contexts, name).to.be.an('array').that.is.not.empty;
      expect(cmd.integration_types, name).to.be.an('array').that.is.not.empty;
    }
  });

  it('keeps guild-only commands out of DMs', () => {
    for (const cmd of [
      commands.EMOTE_COMMAND,
      commands.PICK_RANDOM_USER_COMMAND,
      commands.CHAT_TRACK_COMMAND,
      commands.TEST_COMMAND,
      commands.UPDATE_STATS_COMMAND,
    ]) {
      expect(cmd.contexts, cmd.name).to.deep.equal([0]);
      expect(cmd.integration_types, cmd.name).to.deep.equal([0]);
    }
  });

  it('lets personal commands run in a DM and as a user install', () => {
    for (const cmd of [
      commands.CHECK_MAILBOX_COMMAND,
      commands.READ_MAIL_COMMAND,
      commands.GET_SETTINGS_COMMAND,
      commands.EIGHTBALL_COMMAND,
    ]) {
      expect(cmd.contexts, cmd.name).to.include(1); // bot DM
      expect(cmd.integration_types, cmd.name).to.include(1); // user install
    }
  });

  it('does not require a user on /getstats, so it works alone in a DM', () => {
    const userOption = commands.GET_STATS_COMMAND.options.find(
      (o) => o.name === 'user',
    );
    expect(userOption.required).to.equal(false);
  });

  it('handles the mailbox button that the new-mail DM carries', async () => {
    const stub = sinon.stub(server, 'verifyDiscordRequest').resolves({
      isValid: true,
      interaction: {
        type: InteractionType.MESSAGE_COMPONENT,
        user: { id: '7', username: 'nox', avatar: null }, // a DM: no `member`
        data: { custom_id: 'check_mailbox' },
      },
    });

    try {
      const env = {
        NOXBOT_DATA: {
          idFromName: (n) => n,
          get: () => ({
            fetch: async () =>
              new Response(JSON.stringify({ mailbox: [
                { sender: 'a', subject: 's', message: 'hello' },
              ] })),
          }),
        },
      };
      const res = await server.fetch(
        { method: 'POST', url: new URL('/', 'http://discordo.example') },
        env,
      );
      const body = await res.json();
      expect(body.data.embeds[0].author.name).to.include("nox's Mailbox");
      expect(body.data.embeds[0].fields[0].value).to.equal('hello');
    } finally {
      stub.restore();
    }
  });

  it('puts the sender and subject in the new-mail DM, with an open button', async () => {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'dm1' }));
    };

    try {
      await sendMailNotification(
        '123',
        { sender: 'nox', subject: 'hi there', timestamp: '2026-01-01T00:00:00Z' },
        { DISCORD_TOKEN: 't' },
      );
      const message = sent.at(-1).body;
      expect(message.embeds[0].description).to.include('hi there');
      expect(message.embeds[0].footer.text).to.include('nox');
      expect(message.components[0].components[0].custom_id).to.equal(
        'check_mailbox',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
