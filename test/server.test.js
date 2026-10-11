import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import {
  InteractionResponseType,
  InteractionType,
  InteractionResponseFlags,
} from 'discord-interactions';
import { INVITE_COMMAND, MIND_COMMAND, POKER_COMMAND } from '../src/commands.js';
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

  describe('Poker routing', () => {
    let verifyDiscordRequestStub;
    let calls;
    let respond;
    let env;

    // Stand-in for the PokerTable Durable Object: records calls, answers from `respond`.
    beforeEach(() => {
      verifyDiscordRequestStub = sinon.stub(server, 'verifyDiscordRequest');
      calls = [];
      respond = () => ({ error: 'unexpected call' });
      env = {
        DISCORD_APPLICATION_ID: '1',
        NOXBOT_POKER: {
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

    const send = (interaction, ctx) => {
      verifyDiscordRequestStub.resolves({ isValid: true, interaction });
      return server.fetch(
        { method: 'POST', url: new URL('/', 'http://discordo.example') },
        env,
        ctx,
      );
    };

    const user = (id, extra = {}) => ({ user: { id, username: id, ...extra } });
    const slash = (options = [], name = 'start') => ({
      type: InteractionType.APPLICATION_COMMAND,
      token: 'tok',
      channel_id: 'c1',
      guild_id: 'g1',
      member: user('111111111111111111'),
      data: { name: POKER_COMMAND.name, options: [{ name, type: 1, options }] },
    });
    const button = (customId, who = user('111111111111111111'), messageId = 'm1') => ({
      type: InteractionType.MESSAGE_COMPONENT,
      token: 'tok',
      channel_id: 'c1',
      guild_id: 'g1',
      member: who,
      message: { id: messageId },
      data: { custom_id: customId },
    });
    const modalSubmit = (customId, inputId, value, who = user('111111111111111111')) => ({
      type: InteractionType.MODAL_SUBMIT,
      channel_id: 'c1',
      guild_id: 'g1',
      member: who,
      message: { id: 'm1' },
      data: {
        custom_id: customId,
        components: [{ components: [{ custom_id: inputId, value }] }],
      },
    });

    it('refuses /poker start with an invalid blinds ladder before the table', async () => {
      const res = await send(slash([{ name: 'blinds', type: 3, value: '5/2' }]));
      const body = await res.json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('posts the table and stores the posted message id', async () => {
      respond = (path) =>
        path === '/table' ? { message: { content: 'lobby' } } : { ok: true };
      const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
        Response.json({ id: 'posted-1' }),
      );
      const res = await send(
        slash([
          { name: 'variant', type: 3, value: 'plo' },
          { name: 'seats', type: 4, value: 4 },
        ]),
      );
      expect((await res.json()).type).to.equal(
        InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      );
      expect(fetchStub.firstCall.args[0]).to.include('/messages/@original');
      const table = calls.find((c) => c.path === '/table');
      expect(table.body.hostId).to.equal('111111111111111111');
      expect(table.body.config.variant).to.equal('plo');
      expect(table.body.config.seats).to.equal(4);
      expect(calls.find((c) => c.path === '/setMessage').body.messageId).to.equal(
        'posted-1',
      );
    });

    it('ends the table when the lobby cannot be posted', async () => {
      respond = (path) =>
        path === '/table' ? { message: { content: 'lobby' } } : { ok: true };
      sinon.stub(globalThis, 'fetch').resolves(new Response('no', { status: 500 }));
      await send(slash());
      expect(calls.map((c) => c.path)).to.include('/end');
    });

    it('takes the user id from the interaction, not the custom_id', async () => {
      respond = () => ({ message: { content: 'panel' } });
      await send(button('pk_fold|c1', user('222222222222222222')));
      expect(calls[0].path).to.equal('/fold');
      expect(calls[0].body.userId).to.equal('222222222222222222');
      expect(calls[0].body.messageId).to.equal('m1');

      calls.length = 0;
      await send(button('pk_fold|c1|333333333333333333', user('222222222222222222')));
      expect(calls[0].body.userId).to.equal('222222222222222222');
    });

    it('refuses a custom_id for a different channel', async () => {
      const body = await (await send(button('pk_fold|other'))).json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('refuses a non-numeric buy-in before the table', async () => {
      const body = await (
        await send(modalSubmit('pk_sit_modal|c1', 'buyin_input', 'lots'))
      ).json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('refuses a non-numeric raise before the table', async () => {
      const body = await (
        await send(modalSubmit('pk_raise_modal|c1', 'raise_input', '12abc'))
      ).json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('passes numeric buy-ins and raises to the table', async () => {
      respond = () => ({ message: { content: 'panel' } });
      const sit = await (
        await send(modalSubmit('pk_sit_modal|c1', 'buyin_input', '300'))
      ).json();
      expect(sit.type).to.equal(InteractionResponseType.UPDATE_MESSAGE);
      expect(calls[0]).to.deep.include({ path: '/sit' });
      expect(calls[0].body.buyIn).to.equal(300);

      await send(modalSubmit('pk_raise_modal|c1', 'raise_input', '40'));
      expect(calls[1].path).to.equal('/raise');
      expect(calls[1].body.amount).to.equal(40);
    });

    it('answers error replies ephemerally', async () => {
      respond = () => ({ error: "It's not your turn." });
      const body = await (await send(button('pk_call|c1'))).json();
      expect(body.type).to.equal(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
      expect(body.data.content).to.equal("It's not your turn.");
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    });

    it('passes a modal reply through as a modal response', async () => {
      respond = () => ({ modal: { custom_id: 'pk_raise_modal|c1', title: 'Raise', components: [] } });
      const body = await (await send(button('pk_raise|c1'))).json();
      expect(body.type).to.equal(InteractionResponseType.MODAL);
      expect(body.data.custom_id).to.equal('pk_raise_modal|c1');
      expect(calls[0].path).to.equal('/raiseModal');
    });

    it('answers a fixed-buy-in Sit (no modal in the reply) by updating the message', async () => {
      respond = () => ({ message: { content: 'seated panel' } });
      const body = await (await send(button('pk_sit|c1'))).json();
      expect(body.type).to.equal(InteractionResponseType.UPDATE_MESSAGE);
      expect(body.data.content).to.equal('seated panel');
      expect(calls[0].path).to.equal('/sitModal');
    });

    it('sends the Sit out button with no value so the table toggles', async () => {
      respond = () => ({ message: { content: 'panel' } });
      await send(button('pk_sitout|c1'));
      expect(calls[0].path).to.equal('/sitout');
      expect(calls[0].body).to.not.have.property('value');
    });

    it('sends isAdmin false for a normal member whatever the button claims', async () => {
      respond = () => ({ message: { content: 'panel' } });
      await send(button('pk_fold|c1|isAdmin|true'));
      expect(calls[0].body.isAdmin).to.equal(false);
    });

    it('sends My hand as an ephemeral reply', async () => {
      respond = () => ({ message: { content: 'Your hand', flags: 64 }, ephemeral: true });
      const body = await (await send(button('pk_hand|c1'))).json();
      expect(body.type).to.equal(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    });

    it('posts the ping and showdown as background follow-ups', async () => {
      respond = () => ({
        message: { content: 'panel' },
        ping: { content: '<@2> your turn', allowed_mentions: { users: ['2'] } },
        showdown: { content: 'results' },
      });
      const fetchStub = sinon.stub(globalThis, 'fetch').resolves(Response.json({}));
      const waits = [];
      const body = await (
        await send(button('pk_call|c1'), { waitUntil: (p) => waits.push(p) })
      ).json();
      expect(body.type).to.equal(InteractionResponseType.UPDATE_MESSAGE);
      await Promise.all(waits);
      expect(fetchStub.callCount).to.equal(2);
      expect(fetchStub.firstCall.args[0]).to.equal('https://discord.com/api/v10/webhooks/1/tok');
      const sent = fetchStub.getCalls().map((c) => JSON.parse(c.args[1].body));
      expect(sent.map((m) => m.content)).to.have.members(['results', '<@2> your turn']);
    });

    it('refuses a bot taking a seat without touching the table', async () => {
      const body = await (
        await send(button('pk_sit|c1', user('333333333333333333', { bot: true })))
      ).json();
      expect(body.data.content).to.include('Bots');
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
    });

    it('shows the rules ephemerally without a table', async () => {
      const body = await (await send(slash([], 'rules'))).json();
      expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
      expect(calls).to.have.length(0);
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
