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
} from './commands.js';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import {
  sendMailNotification,
  interactionUser,
  deferred,
  background,
  opt,
  avatarUrl,
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
import { add_emoji, image_to_buffer } from './functions/emoji.js';

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

const guildIdOf = (interaction) => interaction.guild_id ?? interaction.guild?.id;

const randomCategory = () =>
  ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)];

async function mailboxResponse(env, user) {
  const res = await userData(env, user.id).fetch('https://dummy/getMailbox');
  const { mailbox } = await res.json();
  return Response.json(createMailboxEmbed(user, mailbox));
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
        const self = interactionUser(interaction);
        const userId = opt(interaction, 'user') ?? self.id;
        const stat = opt(interaction, 'stat');

        const data = await (await userData(env, userId).fetch('https://dummy/get')).json();
        const resolvedUser = interaction.data.resolved?.users?.[userId] ?? self;

        const embed = {
          type: 'rich',
          author: {
            name: `Stats for ${resolvedUser?.username}`,
            icon_url:
              avatarUrl(resolvedUser) ?? 'https://cdn.discordapp.com/embed/avatars/0.png',
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
            const response = await add_emoji(
              env.DISCORD_TOKEN,
              guildId,
              emoteName,
              emoteData,
            );

            if (!response.ok) {
              const err = await response.text();
              console.error('add_emoji failed:', response.status, err);
              throw new Error(`Discord rejected it (${response.status})`);
            }

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
export { UserData };
