import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import {
  InteractionResponseType,
  InteractionType,
  InteractionResponseFlags,
} from 'discord-interactions';
import { INVITE_COMMAND, MIND_COMMAND } from '../src/commands.js';
import sinon from 'sinon';
import server from '../src/server.js';

describe('Server', () => {
  describe('GET /', () => {
    it('should return a greeting message with the Discord application ID', async () => {
      const request = {
        method: 'GET',
        url: new URL('/', 'http://discordo.example'),
      };
      const env = { DISCORD_APPLICATION_ID: '123456789' };

      const response = await server.fetch(request, env);
      const body = await response.text();

      expect(body).to.equal('👋 123456789');
    });
  });

  describe('POST /', () => {
    let verifyDiscordRequestStub;

    beforeEach(() => {
      verifyDiscordRequestStub = sinon.stub(server, 'verifyDiscordRequest');
    });

    afterEach(() => {
      verifyDiscordRequestStub.restore();
    });

    it('should handle a PING interaction', async () => {
      const interaction = {
        type: InteractionType.PING,
      };

      const request = {
        method: 'POST',
        url: new URL('/', 'http://discordo.example'),
      };

      const env = {};

      verifyDiscordRequestStub.resolves({
        isValid: true,
        interaction: interaction,
      });

      const response = await server.fetch(request, env);
      const body = await response.json();
      expect(body.type).to.equal(InteractionResponseType.PONG);
    });

    it('should handle an invite command interaction', async () => {
      const interaction = {
        type: InteractionType.APPLICATION_COMMAND,
        data: {
          name: INVITE_COMMAND.name,
        },
      };

      const request = {
        method: 'POST',
        url: new URL('/', 'http://discordo.example'),
      };

      const env = {
        DISCORD_APPLICATION_ID: '123456789',
      };

      verifyDiscordRequestStub.resolves({
        isValid: true,
        interaction: interaction,
      });

      const response = await server.fetch(request, env);
      const body = await response.json();
      expect(body.type).to.equal(
        InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      );
      expect(body.data.content).to.include(
        'https://discord.com/oauth2/authorize?client_id=123456789&scope=applications.commands',
      );
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    });

    it('should handle an unknown command interaction', async () => {
      const interaction = {
        type: InteractionType.APPLICATION_COMMAND,
        data: {
          name: 'unknown',
        },
      };

      const request = {
        method: 'POST',
        url: new URL('/', 'http://discordo.example'),
      };

      verifyDiscordRequestStub.resolves({
        isValid: true,
        interaction: interaction,
      });

      const response = await server.fetch(request, {});
      const body = await response.json();
      expect(response.status).to.equal(400);
      expect(body.error).to.equal('Unknown Type');
    });
  });

  describe('The Mind routing', () => {
    let verifyDiscordRequestStub;
    let calls;
    let respond;
    let env;

    // Stand-in for the MindGame Durable Object: records calls, answers from `respond`.
    beforeEach(() => {
      verifyDiscordRequestStub = sinon.stub(server, 'verifyDiscordRequest');
      calls = [];
      respond = () => ({ error: 'unexpected call' });
      env = {
        DISCORD_APPLICATION_ID: '1',
        NOXBOT_MIND: {
          idFromName: (name) => name,
          get: () => ({
            fetch: async (url, init) => {
              const path = new URL(url).pathname;
              const body = JSON.parse(init.body);
              calls.push({ path, body });
              return Response.json(respond(path, body));
            },
          }),
        },
      };
    });

    afterEach(() => {
      verifyDiscordRequestStub.restore();
      sinon.restore();
    });

    const send = (interaction) => {
      verifyDiscordRequestStub.resolves({ isValid: true, interaction });
      return server.fetch(
        { method: 'POST', url: new URL('/', 'http://discordo.example') },
        env,
      );
    };

    const user = (id, extra = {}) => ({ user: { id, username: id, ...extra } });
    const button = (customId, who = user('111111111111111111'), messageId = 'm1') => ({
      type: InteractionType.MESSAGE_COMPONENT,
      channel_id: 'c1',
      guild_id: 'g1',
      member: who,
      message: { id: messageId },
      data: { custom_id: customId },
    });

    it('refuses /mind start when the channel already has a game', async () => {
      respond = () => ({ error: 'This channel already has a game in progress.' });
      const res = await send({
        type: InteractionType.APPLICATION_COMMAND,
        channel_id: 'c1',
        guild_id: 'g1',
        member: user('111111111111111111'),
        data: { name: MIND_COMMAND.name, options: [{ name: 'start', type: 1 }] },
      });
      const body = await res.json();
      expect(body.data.content).to.include('already has a game');
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls.map((c) => c.path)).to.deep.equal(['/lobby']);
    });

    it('posts the lobby and stores the posted message id', async () => {
      respond = (path) =>
        path === '/lobby'
          ? { state: { players: ['111111111111111111'], channelId: 'c1' }, message: { content: 'lobby' } }
          : { state: {} };
      const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
        Response.json({ id: 'posted-1' }),
      );
      const res = await send({
        type: InteractionType.APPLICATION_COMMAND,
        token: 'tok',
        channel_id: 'c1',
        guild_id: 'g1',
        member: user('111111111111111111'),
        data: { name: MIND_COMMAND.name, options: [{ name: 'start', type: 1 }] },
      });
      expect((await res.json()).type).to.equal(
        InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      );
      expect(fetchStub.firstCall.args[0]).to.include('/messages/@original');
      const set = calls.find((c) => c.path === '/setMessage');
      expect(set.body.messageId).to.equal('posted-1');
    });

    it('answers a non-participant pressing a game button ephemerally', async () => {
      respond = () => ({ error: 'You are not in this game.' });
      const res = await send(button('mind_play|c1', user('222222222222222222')));
      const body = await res.json();
      expect(body.type).to.equal(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
      expect(body.data.content).to.equal('You are not in this game.');
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls[0].body.userId).to.equal('222222222222222222');
    });

    it('forwards the message id so a stale button is refused', async () => {
      respond = (path, body) =>
        body.messageId === 'current'
          ? { state: {}, message: { content: 'panel' } }
          : { error: 'This game is over. That message is out of date.' };
      const stale = await (await send(button('mind_play|c1', undefined, 'old'))).json();
      expect(stale.data.content).to.include('out of date');
      expect(stale.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);

      const fresh = await (await send(button('mind_play|c1', undefined, 'current'))).json();
      expect(fresh.type).to.equal(InteractionResponseType.UPDATE_MESSAGE);
      expect(fresh.data.content).to.equal('panel');
    });

    it('refuses a bot pressing Join without touching the game', async () => {
      const res = await send(button('mind_join|c1', user('333333333333333333', { bot: true })));
      const body = await res.json();
      expect(body.data.content).to.include('Bots');
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('uses the interaction channel, not the one in the custom_id', async () => {
      const res = await send(button('mind_play|other'));
      const body = await res.json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('sends My hand as an ephemeral reply', async () => {
      respond = () => ({ state: {}, message: { content: 'Your hand: **4**', flags: 64 } });
      const body = await (await send(button('mind_hand|c1'))).json();
      expect(body.type).to.equal(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
      expect(body.data.content).to.equal('Your hand: **4**');
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    });
  });

  describe('All other routes', () => {
    it('should return a "Not Found" response', async () => {
      const request = {
        method: 'GET',
        url: new URL('/unknown', 'http://discordo.example'),
      };
      const response = await server.fetch(request, {});
      expect(response.status).to.equal(404);
      const body = await response.text();
      expect(body).to.equal('Not Found.');
    });
  });
});
