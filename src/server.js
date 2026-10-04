/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import {
  COINFLIP_COMMAND,
  INCREMENT_STATS_COMMAND,
  INVITE_COMMAND,
  TEST_COMMAND,
  EIGHTBALL_COMMAND,
  GET_STATS_COMMAND,
  UPDATE_STATS_COMMAND,
  DROP_STATS_COMMAND,
  SEND_MAIL_COMMAND,
  CHECK_MAILBOX_COMMAND,
  GET_SETTINGS_COMMAND,
  UPDATE_SETTINGS_COMMAND,
  DELETE_MAIL_COMMAND,
  LENGTHWAVE_COMMAND,
  EMOTE_COMMAND,
  READ_MAIL_COMMAND,
  PICK_RANDOM_USER_COMMAND,
  CHAT_TRACK_COMMAND,
  LEADERBOARD_COMMAND,
  ROLL_COMMAND,
  REMINDME_COMMAND,
  REMINDERS_COMMAND,
  SEND_MAIL_MENU,
  GET_STATS_MENU,
  STEAL_EMOJI_MENU,
  MIND_COMMAND,
} from './commands.js';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import { MindGame } from './resources/MindGame.js';
import {
  sendMailNotification,
  interactionUser,
  deferred,
  background,
  opt,
  avatarUrl,
  editOriginalResponse,
  DISCORD_API,
} from './util.js';
import { coinFlip } from './functions/coinflip.js';
import { eightBall } from './functions/eightball.js';
import {
  ALL_PROMPTS,
  createLengthWaveClueModal,
  createLengthWaveGuessModal,
  generate_guess_response_message_embed,
  generate_guesser_message_embed,
  generate_message_embed,
  PROMPTS,
} from './functions/lengthwave.js';
import {
  createMailboxModal,
  createMailboxEmbed,
  createSingleMailEmbed,
} from './functions/mailbox.js';
import {
  createChatStatsEmbed,
  getStatsOnUser,
  newestMessageId,
} from './functions/chattrack.js';
import { add_emoji, image_to_buffer, stealEmoji } from './functions/emoji.js';
import { rollDice } from './functions/roll.js';
import {
  parseDuration,
  remindersListMessage,
  MIN_REMINDER_MS,
  MAX_REMINDER_MS,
} from './functions/remind.js';
import { lobbyMessage } from './functions/mind.js';

const router = AutoRouter();

const SNOWFLAKE = /^\d{17,20}$/;
const ADMINISTRATOR = 8n;

const ephemeralText = (content) =>
  Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  });

const reply = (data, ephemeral) =>
  Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      ...data,
      flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : undefined,
    },
  });

const userData = (env, name) =>
  env.NOXBOT_DATA.get(env.NOXBOT_DATA.idFromName(name));

const post = (stub, path, body) =>
  stub.fetch(`https://dummy${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const isAdmin = (interaction) =>
  (BigInt(interaction.member?.permissions ?? 0) & ADMINISTRATOR) !== 0n;

/** Value of a modal text input by its custom_id. */
const modalValue = (interaction, id) =>
  interaction.data.components
    ?.flatMap((row) => row.components ?? [])
    .find((c) => c.custom_id === id)?.value;

/** The user a right-click "user" menu command was used on. */
const targetUser = (interaction) =>
  interaction.data.resolved?.users?.[interaction.data.target_id];

const guildIdOf = (interaction) => interaction.guild_id ?? interaction.guild?.id;

const randomCategory = () =>
  ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)];

async function mailboxResponse(env, user) {
  const res = await userData(env, user.id).fetch('https://dummy/getMailbox');
  const { mailbox } = await res.json();
  return Response.json(createMailboxEmbed(user, mailbox));
}

async function statsResponse(env, user, stat, ephemeral) {
  const data = await (await userData(env, user.id).fetch('https://dummy/get')).json();

  const embed = {
    type: 'rich',
    author: {
      name: `Stats for ${user.username}`,
      icon_url: avatarUrl(user) ?? 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    color: 0x5865f2, // blurple
    fields: [],
  };

  if (stat) {
    embed.fields.push({ name: stat, value: `${data[stat] ?? '0'}`, inline: true });
  } else {
    // Discord rejects embeds with more than 25 fields.
    for (const [key, value] of Object.entries(data).slice(0, 25)) {
      embed.fields.push({ name: key, value: `${value}`, inline: true });
    }
    if (embed.fields.length === 0) {
      embed.description = 'No stats found for this user.';
    }
  }

  return reply({ embeds: [embed] }, ephemeral);
}

/** Create a gamut and persist it so the clue/guess modals can look it up later. */
async function newGamut(env, prompts, position, creatorId) {
  const { message, gameId, game_data } = generate_message_embed(prompts, position);
  await post(userData(env, 'lengthwave'), '/lengthwave', {
    gameId,
    // The creator saw the position, so their own guess must never score.
    game_data: { ...game_data, creator: creatorId },
  });
  return Response.json(message);
}

const mindGame = (env, channelId) =>
  env.NOXBOT_MIND.get(env.NOXBOT_MIND.idFromName(`mind:${channelId}`));

/** Redraw the message a button sits on. */
const updateMessage = (data) =>
  Response.json({ type: InteractionResponseType.UPDATE_MESSAGE, data });

/** Call one MindGame route as the acting user. The DO owns every rule and the stale-button check. */
async function mindCall(env, interaction, path, extra = {}) {
  const res = await post(mindGame(env, interaction.channel_id), path, {
    userId: interactionUser(interaction).id,
    hostId: interactionUser(interaction).id,
    isAdmin: isAdmin(interaction),
    channelId: interaction.channel_id,
    guildId: guildIdOf(interaction),
    messageId: interaction.message?.id,
    token: interaction.token,
    ...extra,
  });
  return res.json();
}

/**
 * End the game. The DO decides who may: the host, a participant or an
 * administrator for /end, the host or an administrator for the Cancel button.
 */
const mindEnd = (env, interaction, { cancel = false, redraw = false } = {}) =>
  mindCall(env, interaction, cancel ? '/cancel' : '/end', {
    redraw,
    // /mind end is not pressed on the panel, so it has no message id to check.
    messageId: cancel ? interaction.message?.id : undefined,
  });

/** Handle a mind_<action>|<channelId>[|yes|no] button press. */
async function mindComponent(env, interaction) {
  const [action, channelId, choice] = interaction.data.custom_id
    .slice('mind_'.length)
    .split('|');
  // The id in the custom_id is only a sanity check against a mangled payload.
  if (!interaction.channel_id || channelId !== interaction.channel_id) {
    return ephemeralText('This game belongs to a different channel.');
  }

  const routes = {
    leave: '/leave',
    begin: '/begin',
    play: '/play',
    shuriken: '/shuriken',
    next: '/next',
  };

  let result;
  if (action === 'hand') {
    result = await mindCall(env, interaction, '/hand');
    return result.error || !result.message
      ? ephemeralText(result.error ?? 'You are not in this game.')
      : reply(result.message, true);
  }
  if (action === 'join') {
    if (interactionUser(interaction).bot) {
      return ephemeralText('Bots cannot play The Mind.');
    }
    result = await mindCall(env, interaction, '/join');
  } else if (action === 'cancel') {
    result = await mindEnd(env, interaction, { cancel: true });
  } else if (action === 'vote') {
    if (choice !== 'yes' && choice !== 'no') {
      return ephemeralText('That vote button is not valid.');
    }
    result = await mindCall(env, interaction, '/vote', { agree: choice === 'yes' });
  } else if (routes[action]) {
    result = await mindCall(env, interaction, routes[action]);
  } else {
    return ephemeralText('Unknown Mind action.');
  }

  if (result.error || !result.message) {
    return ephemeralText(result.error ?? 'Something went wrong with that game.');
  }
  return updateMessage(result.message);
}

/** /mind start: open the lobby, post it, then remember the posted message's id. */
async function mindStart(env, ctx, interaction) {
  if (!interaction.channel_id) {
    return ephemeralText('Run /mind start in a channel.');
  }
  const created = await mindCall(env, interaction, '/lobby');
  if (created.error) {
    return ephemeralText(created.error);
  }

  // A slash command reply carries no message id, so defer, fill the placeholder
  // with PATCH @original (which returns the message), and store its id.
  await background(
    ctx,
    (async () => {
      try {
        const res = await editOriginalResponse(
          env,
          interaction,
          created.message ?? lobbyMessage(created.state),
        );
        if (!res.ok) {
          throw new Error(`Discord returned ${res.status}`);
        }
        const posted = await res.json();
        await mindCall(env, interaction, '/setMessage', { messageId: posted.id });
      } catch (err) {
        console.error('mind lobby post failed:', err);
        // Free the channel so the host is not locked out by a lobby nobody can see.
        await mindCall(env, interaction, '/end', { reason: 'ended' });
        await editOriginalResponse(env, interaction, {
          content: `Could not post the lobby: ${err.message}`,
        });
      }
    })(),
  );
  return Response.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {},
  });
}

/** /mind end: end the game; the DO redraws the panel. */
async function mindEndCommand(env, ctx, interaction) {
  if (!interaction.channel_id) {
    return ephemeralText('Run /mind end in a channel.');
  }
  const result = await mindEnd(env, interaction, { redraw: true });
  if (result.error) {
    return ephemeralText(result.error);
  }
  return ephemeralText('Game ended.');
}

function mindLeaderboard(env, ctx, interaction) {
  return deferred(env, ctx, interaction, async () => {
    // MindGame stores the aggregate under the 'mind' key of the 'mind' UserData.
    const { mind: scores } = await (
      await userData(env, 'mind').fetch('https://dummy/get')
    ).json();
    const rows = Object.entries(scores ?? {})
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.bestLevel - a.bestLevel || b.wins - a.wins);

    if (rows.length === 0) {
      return { content: 'Nobody has played The Mind yet. `/mind start`!' };
    }
    return {
      embeds: [
        {
          title: '🧠 The Mind leaderboard',
          description: rows
            .slice(0, 10)
            .map(
              (r, i) =>
                `${i + 1}. <@${r.id}> — level **${r.bestLevel}**, ${r.wins} win${r.wins === 1 ? '' : 's'} in ${r.games} game${r.games === 1 ? '' : 's'}`,
            )
            .join('\n'),
          color: 0x5865f2,
        },
      ],
      allowed_mentions: { parse: [] },
    };
  });
}

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/', async (request, env, ctx) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );

  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    const customId = interaction.data.custom_id;

    if (customId === 'mailbox_modal') {
      const recipient = modalValue(interaction, 'recipient_input');

      // Mailboxes are keyed by user id; a username would silently post into a
      // mailbox nobody ever reads.
      if (!SNOWFLAKE.test(recipient ?? '')) {
        return ephemeralText(
          `"${recipient}" is not a user ID. Pick the recipient with the \`user\` option on /sendmail, or paste their ID.`,
        );
      }

      const mail = {
        sender: interactionUser(interaction).username,
        senderId: interactionUser(interaction).id,
        subject: modalValue(interaction, 'subject_input'),
        message: modalValue(interaction, 'message_input'),
        timestamp: new Date().toISOString(),
      };

      const stub = userData(env, recipient);
      const res = await post(stub, '/addToMailbox', mail);
      const response = await res.json();

      if (!res.ok) {
        return ephemeralText(response.error ?? 'Could not deliver that mail.');
      }

      const userSettings = await (await stub.fetch('https://dummy/getSettings')).json();
      if (userSettings.notifyForMail === 'true') {
        // Two Discord calls; don't spend the 3s interaction window on them.
        await background(ctx, sendMailNotification(recipient, mail, env));
      }

      return ephemeralText(response.message);
    }

    if (customId.startsWith('lengthwave_clue_modal')) {
      const game_id = customId.split('|')[1];
      const res = await userData(env, 'lengthwave').fetch(
        `https://dummy/lengthwave?gameId=${game_id}`,
      );
      if (!res.ok) {
        return ephemeralText('That gamut is gone — start a new one with /lengthwave.');
      }
      const game_data = await res.json();
      game_data.clue = modalValue(interaction, 'clue_input');

      return Response.json(
        generate_guesser_message_embed(game_id, game_data, interactionUser(interaction)),
      );
    }

    if (customId.startsWith('lengthwave_guess_modal')) {
      const game_id = customId.split('|')[1];
      const guess = parseFloat(modalValue(interaction, 'guess_input'));
      if (Number.isNaN(guess) || guess < 0 || guess > 1) {
        return ephemeralText('Your guess must be a number between 0 and 1.');
      }

      const user = interactionUser(interaction);
      const res = await post(userData(env, 'lengthwave'), '/lengthwave/guess', {
        gameId: game_id,
        userId: user.id,
        guess,
      });
      if (!res.ok) {
        return ephemeralText('That gamut is gone — start a new one with /lengthwave.');
      }
      // In a 1:1 DM you can see your own gamut, so the DO refuses to score it.
      const { game_data, already, ownGamut } = await res.json();

      return Response.json(
        generate_guess_response_message_embed(
          game_id,
          game_data,
          guess,
          user,
          already
            ? ' (already guessed - not counted)'
            : ownGamut
              ? ' (your own gamut - not counted)'
              : '',
        ),
      );
    }
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = interaction.data.custom_id;

    if (customId === 'check_mailbox') {
      return mailboxResponse(env, interactionUser(interaction));
    }

    // Picked from the /reminders dropdown: cancel it and redraw the list in place.
    if (customId === 'cancel_reminder') {
      const user = interactionUser(interaction);
      const res = await post(userData(env, user.id), '/cancelReminder', {
        id: interaction.data.values?.[0],
      });
      return Response.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: remindersListMessage(await res.json()),
      });
    }

    if (customId.startsWith('mail_reply|')) {
      return Response.json(createMailboxModal({ id: customId.split('|')[1] }));
    }

    if (customId.startsWith('mind_')) {
      return mindComponent(env, interaction);
    }

    if (customId === 'gamut_clue_button') {
      const game_id = interaction.message.embeds[0].footer.text;
      return Response.json(createLengthWaveClueModal(game_id));
    }

    if (customId === 'new_gamut_button') {
      return newGamut(env, randomCategory(), undefined, interactionUser(interaction).id);
    }

    if (customId.startsWith('gamut_guess_button')) {
      return Response.json(createLengthWaveGuessModal(customId.split('|')[1]));
    }
  }

  // Only the `stat` options autocomplete: suggest stats the target already has.
  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    const typed = String(
      interaction.data.options?.find((o) => o.focused)?.value ?? '',
    ).toLowerCase();
    const userId = opt(interaction, 'user') ?? interactionUser(interaction).id;
    const stats = await (await userData(env, userId).fetch('https://dummy/get')).json();

    return Response.json({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: {
        // Discord caps choices at 25 and names/values at 100 characters.
        choices: Object.keys(stats)
          .filter((k) => k.length <= 100 && k.toLowerCase().includes(typed))
          .slice(0, 25)
          .map((k) => ({ name: k, value: k })),
      },
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    const ephemeral = opt(interaction, 'ephemeral');

    switch (interaction.data.name) {
      case INVITE_COMMAND.name: {
        return ephemeralText(
          `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}&scope=applications.commands`,
        );
      }

      case INCREMENT_STATS_COMMAND.name: {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }
        const user = opt(interaction, 'user');
        const stat = opt(interaction, 'stat');
        if (!stat) {
          return ephemeralText('Tell me which stat to increment.');
        }

        const res = await post(userData(env, user), '/increment', { key: stat });
        const data = await res.json();
        if (!res.ok) {
          return ephemeralText(data.error);
        }

        const username = interaction.data.resolved?.users?.[user]?.username;
        return reply(
          { content: `Incremented stat ${stat} to ${data[stat]} for user ${username}.` },
          ephemeral,
        );
      }

      case GET_STATS_COMMAND.name: {
        const target = opt(interaction, 'user');
        const user = target
          ? interaction.data.resolved?.users?.[target]
          : interactionUser(interaction);
        return statsResponse(env, user, opt(interaction, 'stat'), ephemeral);
      }

      case GET_STATS_MENU.name:
        return statsResponse(env, targetUser(interaction), undefined, true);

      case SEND_MAIL_MENU.name:
        return Response.json(createMailboxModal(targetUser(interaction)));

      case STEAL_EMOJI_MENU.name: {
        const guildId = guildIdOf(interaction);
        if (!guildId) {
          return ephemeralText('Use this inside a server.');
        }
        const message = interaction.data.resolved?.messages?.[interaction.data.target_id];

        return deferred(
          env,
          ctx,
          interaction,
          async () => {
            const { name, data } = await stealEmoji(message?.content);
            await add_emoji(env.DISCORD_TOKEN, guildId, name, data);
            return { content: `Added :${name}: to the server!` };
          },
          true,
        );
      }

      case ROLL_COMMAND.name: {
        const dice = opt(interaction, 'dice') ?? '1d6';
        let result;
        try {
          result = rollDice(dice);
        } catch (err) {
          return ephemeralText(err.message);
        }
        const { rolls, modifier, total } = result;
        const mod = modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : '';
        return reply({
          content: `🎲 ${interactionUser(interaction).username} rolled \`${dice}\`: [${rolls.join(', ')}]${mod} = **${total}**`,
        });
      }

      case REMINDME_COMMAND.name: {
        const ms = parseDuration(opt(interaction, 'in'));
        // NaN fails both comparisons, so unparseable input lands here too.
        if (!(ms >= MIN_REMINDER_MS && ms <= MAX_REMINDER_MS)) {
          return ephemeralText(
            'Give a time between 1m and 365d, like `10m`, `2h30m` or `3d`.',
          );
        }

        const user = interactionUser(interaction);
        const now = Date.now();
        const at = now + ms;
        const res = await post(userData(env, user.id), '/addReminder', {
          userId: user.id,
          at,
          text: opt(interaction, 'text'),
          createdAt: now,
        });
        if (!res.ok) {
          return ephemeralText((await res.json()).error);
        }
        return ephemeralText(
          `⏰ I'll DM you <t:${Math.floor(at / 1000)}:R>. Make sure your DMs are open to the bot. See or cancel it with \`/reminders\`.`,
        );
      }

      case REMINDERS_COMMAND.name: {
        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/getReminders');
        return reply(remindersListMessage(await res.json()), true);
      }

      case UPDATE_STATS_COMMAND.name: {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }
        const user = opt(interaction, 'user');
        const stat = opt(interaction, 'stat');

        const res = await post(userData(env, user), '/set', {
          [stat]: opt(interaction, 'value'),
        });
        const data = await res.json();
        if (!res.ok) {
          return ephemeralText(data.error);
        }

        const username = interaction.data.resolved?.users?.[user]?.username;
        return reply(
          { content: `Set stat ${stat} to ${data[stat]} for user ${username}.` },
          ephemeral,
        );
      }

      case DROP_STATS_COMMAND.name: {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }
        const user = opt(interaction, 'user');
        await post(userData(env, user), '/dropStats', {});
        return reply({ content: `All stats for user ${user} have been deleted.` }, ephemeral);
      }

      case EIGHTBALL_COMMAND.name:
        return eightBall(opt(interaction, 'question'), interaction, ephemeral);

      case COINFLIP_COMMAND.name:
        return coinFlip(interaction, ephemeral);

      case SEND_MAIL_COMMAND.name: {
        const resolvedUser = interaction.data.resolved?.users?.[opt(interaction, 'user')];
        return Response.json(createMailboxModal(resolvedUser));
      }

      case CHECK_MAILBOX_COMMAND.name:
        return mailboxResponse(env, interactionUser(interaction));

      case DELETE_MAIL_COMMAND.name: {
        const user = interactionUser(interaction);
        const res = await post(userData(env, user.id), '/deleteMail', {
          index: opt(interaction, 'index'),
        });
        const response = await res.json();
        return ephemeralText(response.message ?? response.error);
      }

      case GET_SETTINGS_COMMAND.name: {
        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/getSettings');
        return ephemeralText(JSON.stringify(await res.json()));
      }

      case UPDATE_SETTINGS_COMMAND.name: {
        const setting = opt(interaction, 'setting');
        const value = opt(interaction, 'value');
        const user = interactionUser(interaction);
        await post(userData(env, user.id), '/updateSettings', { [setting]: value });
        return ephemeralText(`Updated the ${setting} value to ${value}`);
      }

      case MIND_COMMAND.name: {
        switch (interaction.data.options?.[0]?.name) {
          case 'start':
            return mindStart(env, ctx, interaction);
          case 'end':
            return mindEndCommand(env, ctx, interaction);
          case 'leaderboard':
            return mindLeaderboard(env, ctx, interaction);
          default:
            return ephemeralText('Unknown /mind subcommand.');
        }
      }

      case LENGTHWAVE_COMMAND.name: {
        const category = opt(interaction, 'category');
        const left = opt(interaction, 'left');
        const right = opt(interaction, 'right');

        if (!left !== !right) {
          return ephemeralText('Please provide a left and right prompt');
        }

        if (category && !Object.hasOwn(PROMPTS, category)) {
          return ephemeralText(
            `Unknown category. Pick one of: ${Object.keys(PROMPTS).join(', ')}`,
          );
        }

        const prompts =
          left && right ? [[left, right]] : (PROMPTS[category] ?? randomCategory());

        // Discord validates `position` (NUMBER, 0..1); undefined means random.
        return newGamut(
          env,
          prompts,
          opt(interaction, 'position'),
          interactionUser(interaction).id,
        );
      }

      case EMOTE_COMMAND.name: {
        const emoteUrl = opt(interaction, 'url');
        const emoteName = opt(interaction, 'emote');

        const guildId = guildIdOf(interaction);
        if (!guildId) {
          return ephemeralText('Run /emote inside a server.');
        }

        return deferred(
          env,
          ctx,
          interaction,
          async () => {
            const emoteData = await image_to_buffer(emoteUrl);
            await add_emoji(env.DISCORD_TOKEN, guildId, emoteName, emoteData);
            return { content: `Added ${emoteName} to the server!` };
          },
          true,
        );
      }

      case READ_MAIL_COMMAND.name: {
        const index = opt(interaction, 'index');
        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/getMailbox');
        const { mailbox } = await res.json();
        const mail = mailbox[index - 1];

        if (!mail) {
          return ephemeralText(
            mailbox.length
              ? `Pick a mail between 1 and ${mailbox.length}.`
              : 'You have no mail.',
          );
        }

        return Response.json(createSingleMailEmbed(mail, index));
      }

      case LEADERBOARD_COMMAND.name: {
        // Deferred: the first call after deploy migrates the old roster.
        return deferred(env, ctx, interaction, async () => {
          const scores = await (
            await userData(env, 'lengthwave').fetch('https://dummy/lengthwave/scores')
          ).json();

          const rows = Object.entries(scores)
            .map(([id, s]) => ({ id, ...s }))
            .sort((a, b) => b.score - a.score);

          if (rows.length === 0) {
            return { content: 'Nobody has guessed a gamut yet. `/lengthwave`!' };
          }

          return {
            embeds: [
            {
              title: '🧠 Gamut leaderboard',
              description: rows
                .slice(0, 10)
                .map(
                  (r, i) =>
                    `${i + 1}. <@${r.id}> — **${r.score}** over ${r.games} guess${r.games === 1 ? '' : 'es'}`,
                )
                .join('\n'),
              color: 0x5865f2,
            },
          ],
          allowed_mentions: { parse: [] },
          };
        });
      }

      case PICK_RANDOM_USER_COMMAND.name: {
        const guildId = guildIdOf(interaction);
        if (!guildId) {
          return ephemeralText('Run /choosesomeone inside a server.');
        }

        return deferred(env, ctx, interaction, async () => {
          // Needs the GUILD_MEMBERS privileged intent in the dev portal.
          const res = await fetch(
            `${DISCORD_API}/guilds/${guildId}/members?limit=1000`,
            { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` } },
          );
          if (!res.ok) {
            throw new Error(
              `couldn't list members (${res.status}) — is the GUILD_MEMBERS intent on?`,
            );
          }

          const members = (await res.json()).filter((m) => !m.user.bot);
          if (members.length === 0) {
            throw new Error('nobody here to choose from');
          }

          const picked = members[Math.floor(Math.random() * members.length)];
          return {
            content: `🎲 I choose <@${picked.user.id}>!`,
            // Render the mention without actually pinging them.
            allowed_mentions: { parse: [] },
          };
        });
      }

      case CHAT_TRACK_COMMAND.name: {
        const target = opt(interaction, 'user');
        const self = interactionUser(interaction);
        const userId = target ?? self.id;
        const user = target ? interaction.data.resolved?.users?.[target] : self;
        const channelId = interaction.channel_id;

        if (!channelId) {
          return ephemeralText('Run /chattrack in a channel.');
        }

        return deferred(env, ctx, interaction, async () => {
          const stub = userData(env, userId);
          const chatData = await (
            await stub.fetch(`https://dummy/getChat?channelId=${channelId}`)
          ).json();

          const save = (data) => post(stub, `/setChat?channelId=${channelId}`, data);

          // First run: mark where to start. Backfilling a whole channel is
          // tens of thousands of rate-limited requests, so we count forward.
          if (!chatData.lastMessageId) {
            const watermark = await newestMessageId(channelId, env.DISCORD_TOKEN);
            if (!watermark) {
              throw new Error('this channel has no messages yet');
            }
            await save({ words: {}, messages: 0, lastMessageId: watermark });
            return {
              content: `Now tracking ${user?.username ?? 'that user'} in this channel from here on. Run \`/chattrack\` again later to see counts.`,
            };
          }

          const { chatData: updated, caughtUp } = await getStatsOnUser(
            channelId,
            userId,
            chatData,
            env.DISCORD_TOKEN,
          );
          await save(updated);

          return {
            ...createChatStatsEmbed(user ?? { username: 'that user' }, updated),
            content: caughtUp
              ? undefined
              : 'Still catching up on this channel — run `/chattrack` again to count more.',
          };
        });
      }

      case TEST_COMMAND.name: {
        const user = interactionUser(interaction);
        const guildId = guildIdOf(interaction);

        if (!guildId || user?.id !== env.COOL_GUY) {
          return ephemeralText('You are not the cool guy!');
        }

        const roleId = await createCoolRole(guildId, env.DISCORD_TOKEN);
        if (!roleId) {
          return ephemeralText('Could not create the cool role.');
        }

        const assignedRole = await assignRole(
          guildId,
          user.id,
          roleId,
          env.DISCORD_TOKEN,
        );

        return ephemeralText(
          assignedRole.ok
            ? 'You have been given the cool role!'
            : 'Could not give you the cool role.',
        );
      }

      default:
        return Response.json({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return Response.json({ error: 'Unknown Type' }, { status: 400 });
});
router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
export { UserData, MindGame };
