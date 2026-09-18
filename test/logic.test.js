import { expect } from 'chai';
import { describe, it } from 'mocha';
import { InteractionType } from 'discord-interactions';
import {
  ALL_PROMPTS,
  calculate_score,
  generate_guess_response_message_embed,
} from '../src/functions/lengthwave.js';
import { UserData } from '../src/resources/UserData.js';
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
