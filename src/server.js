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
} from './commands.js';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import { JsonResponse, sendMailNotification, interactionUser } from './util.js';
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
import { createMailboxModal, createMailboxEmbed } from './functions/mailbox.js';
import { add_emoji, image_to_buffer } from './functions/emoji.js';

const router = AutoRouter();

const SNOWFLAKE = /^\d{17,20}$/;
const ADMINISTRATOR = 8n;

const ephemeralText = (content) =>
  new JsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  });

const userData = (env, name) =>
  env.NOXBOT_DATA.get(env.NOXBOT_DATA.idFromName(name));

const isAdmin = (interaction) =>
  (BigInt(interaction.member?.permissions ?? 0) & ADMINISTRATOR) !== 0n;

/** Persist a gamut so the clue/guess modals can look its answer up later. */
async function saveGamut(env, body) {
  await userData(env, 'lengthwave').fetch('https://dummy/lengthwave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: body.data.embeds[0].footer.text,
      game_data: body.data.game_data,
    }),
  });
  return body;
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
router.post('/', async (request, env) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  // console.log(env);

  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    if (interaction.data.custom_id === 'mailbox_modal') {
      const recipient = interaction.data.components?.[0]?.components?.find(
        (component) => component.custom_id === 'recipient_input'
      )?.value;

      const subject = interaction.data.components?.[1]?.components?.find(
        (component) => component.custom_id === 'subject_input'
      )?.value;

      const message = interaction.data.components?.[2]?.components?.find(
        (component) => component.custom_id === 'message_input'
      )?.value;

      // Mailboxes are keyed by user id; a username would silently post into a
      // mailbox nobody ever reads.
      if (!SNOWFLAKE.test(recipient ?? '')) {
        return ephemeralText(
          `"${recipient}" is not a user ID. Pick the recipient with the \`user\` option on /sendmail, or paste their ID.`,
        );
      }

      const mail = {
        sender: interactionUser(interaction).username,
        subject: subject,
        message: message,
        timestamp: new Date().toISOString(),
      };

      const stub = userData(env, recipient);

      const res = await stub.fetch('https://dummy/addToMailbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mail),
      });
      const response = await res.json();

      if (!res.ok) {
        return ephemeralText(response.error ?? 'Could not deliver that mail.');
      }

      const settingsRes = await stub.fetch('https://dummy/getSettings');
      const userSettings = await settingsRes.json();

      if (userSettings.notifyForMail === 'true') {
        await sendMailNotification(recipient, env);
      }

      return ephemeralText(response.message);
    }

    if (interaction.data.custom_id.startsWith('lengthwave_clue_modal')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      const clue = interaction.data.components?.[0]?.components?.find(
        (component) => component.custom_id === 'clue_input'
      )?.value;

      const res = await userData(env, 'lengthwave').fetch(
        `https://dummy/lengthwave?gameId=${game_id}`,
      );
      if (!res.ok) {
        return ephemeralText('That gamut is gone — start a new one with /lengthwave.');
      }
      const game_data = await res.json();
      game_data.clue = clue;

      return new JsonResponse(
        generate_guesser_message_embed(game_id, game_data, interactionUser(interaction)),
      );
    }

    if (interaction.data.custom_id.startsWith('lengthwave_guess_modal')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      const guess_value = interaction.data.components?.[0]?.components?.find(
        (component) => component.custom_id === 'guess_input'
      )?.value;

      const guess = parseFloat(guess_value);
      if (Number.isNaN(guess) || guess < 0 || guess > 1) {
        return ephemeralText('Your guess must be a number between 0 and 1.');
      }

      const res = await userData(env, 'lengthwave').fetch(
        `https://dummy/lengthwave?gameId=${game_id}`,
      );
      if (!res.ok) {
        return ephemeralText('That gamut is gone — start a new one with /lengthwave.');
      }
      const game_data = await res.json();

      return new JsonResponse(
        generate_guess_response_message_embed(
          game_id,
          game_data,
          guess,
          interactionUser(interaction),
        ),
      );
    }
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {

    const customId = interaction.data.custom_id;

    if (customId === 'gamut_clue_button') {
      const game_id = interaction.message.embeds[0].footer.text;
      return new JsonResponse(createLengthWaveClueModal(game_id));
    }

    if (customId === 'new_gamut_button') {
      const prompts = ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)];
      return new JsonResponse(
        await saveGamut(env, generate_message_embed(prompts)),
      );
    }

    if (customId.startsWith('gamut_guess_button')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      return new JsonResponse(createLengthWaveGuessModal(game_id));
    }
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    switch (interaction.data.name.toLowerCase()) {
      case INVITE_COMMAND.name.toLowerCase(): {
        const applicationId = env.DISCORD_APPLICATION_ID;
        const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=applications.commands`;
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: INVITE_URL,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      case INCREMENT_STATS_COMMAND.name.toLowerCase(): {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }
        const user = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;
        const stat = interaction.data.options?.find(
          (option) => option.name === 'stat',
        )?.value;
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;

        if (!stat) {
          return ephemeralText('Tell me which stat to increment.');
        }

        const username = interaction.data.resolved?.users?.[user]?.username;

        const res = await userData(env, user).fetch('https://dummy/increment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: stat }),
        });
        const data = await res.json();

        const body = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Incremented stat ${stat} to ${data[stat]} for user ${username}.`,
          },
        };
        if (ephemeral) {
          body.data.flags = InteractionResponseFlags.EPHEMERAL;
        }
        return new JsonResponse(body);
      }

      case GET_STATS_COMMAND.name.toLowerCase(): {
        const userId = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;

        const stat = interaction.data.options?.find(
          (option) => option.name === 'stat',
        )?.value;

        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;

        const res = await userData(env, userId).fetch('https://dummy/get');
        const data = await res.json();

        const resolvedUser = interaction.data.resolved?.users?.[userId];

        const username = resolvedUser?.username;
        const avatar = resolvedUser?.avatar;

        const avatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`;

        // Basic embed setup
        const embed = {
          type: 'rich',
          author: {
            name: `Stats for ${username}`,
            icon_url: avatarUrl,
          },
          color: 0x5865f2, // blurple
          fields: [],
        };

        if (stat) {
          embed.fields.push({
            name: stat,
            value: `${data[stat] ?? '0'}`,
            inline: true,
          });
        } else {
          // Discord rejects embeds with more than 25 fields.
          for (const [key, value] of Object.entries(data).slice(0, 25)) {
            embed.fields.push({
              name: key,
              value: `${value}`,
              inline: true,
            });
          }

          if (embed.fields.length === 0) {
            embed.description = 'No stats found for this user.';
          }
        }

        const body = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed],
          },
        };

        if (ephemeral) {
          body.data.flags = InteractionResponseFlags.EPHEMERAL;
        }

        return new JsonResponse(body);
      }

      case UPDATE_STATS_COMMAND.name.toLowerCase(): {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }

        const user = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;
        const stat = interaction.data.options?.find(
          (option) => option.name === 'stat',
        )?.value;
        const value = interaction.data.options?.find(
          (option) => option.name === 'value',
        )?.value;
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;

        const username = interaction.data.resolved?.users?.[user]?.username;

        const res = await userData(env, user).fetch('https://dummy/set', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ [stat]: value }),
        });
        const data = await res.json();

        let body = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Set stat ${stat} to ${data[stat]} for user ${username}.`,
          },
        };

        if (ephemeral) {
          body.data.flags = InteractionResponseFlags.EPHEMERAL;
        }

        return new JsonResponse(body);
      }

      case DROP_STATS_COMMAND.name.toLowerCase(): {
        if (!isAdmin(interaction)) {
          return ephemeralText("You don't have permission to use this command.");
        }
        const user = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;
        await userData(env, user).fetch('https://dummy/deleteAll', {
          method: 'POST',
        });
        const body = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `All stats for user ${user} have been deleted.`,
          },
        };
        if (ephemeral) {
          body.data.flags = InteractionResponseFlags.EPHEMERAL;
        }
        return new JsonResponse(body);
      }

      case EIGHTBALL_COMMAND.name.toLowerCase(): {
        const question = interaction.data.options?.find(
          (option) => option.name === 'question',
        )?.value;
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;
        return eightBall(question, interaction, ephemeral);
      }

      case COINFLIP_COMMAND.name.toLowerCase(): {
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;
        return coinFlip(interaction, ephemeral);
      }

      case SEND_MAIL_COMMAND.name.toLowerCase(): {
        const user = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;

        const resolvedUser = interaction.data.resolved?.users?.[user];

        return new JsonResponse(createMailboxModal(resolvedUser))
      }

      case CHECK_MAILBOX_COMMAND.name.toLowerCase(): {
        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/getMailbox');
        const { mailbox } = await res.json();

        return new JsonResponse(createMailboxEmbed(user, mailbox));
      }

      case DELETE_MAIL_COMMAND.name.toLowerCase(): {
        const index = interaction.data.options?.find(
          (option) => option.name === 'index',
        )?.value;

        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/deleteMail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ index: index ?? -1 }),
        });

        const response = await res.json();

        return ephemeralText(response.message ?? response.error);
      }

      case GET_SETTINGS_COMMAND.name.toLowerCase(): {
        const user = interactionUser(interaction);
        const res = await userData(env, user.id).fetch('https://dummy/getSettings');
        const settings = await res.json();

        return ephemeralText(JSON.stringify(settings));
      }

      case UPDATE_SETTINGS_COMMAND.name.toLowerCase(): {
        const setting = interaction.data.options?.find(
          (option) => option.name === 'setting',
        )?.value;
        const value = interaction.data.options?.find(
          (option) => option.name === 'value',
        )?.value;

        const user = interactionUser(interaction);
        await userData(env, user.id).fetch('https://dummy/updateSettings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ [setting]: value }),
        });

        return ephemeralText(`Updated the ${setting} value to ${value}`);
      }

      case LENGTHWAVE_COMMAND.name.toLowerCase(): {
        const prompts_category = interaction.data.options?.find(
          (option) => option.name === 'category',
        )?.value;

        const left = interaction.data.options?.find(
          (option) => option.name === 'left',
        )?.value;

        const right = interaction.data.options?.find(
          (option) => option.name === 'right',
        )?.value;

        const position_raw = interaction.data.options?.find(
          (option) => option.name === 'position',
        )?.value;

        const position = position_raw ? parseFloat(position_raw) : Math.random();
        if (Number.isNaN(position) || position < 0 || position > 1) {
          return ephemeralText('Position must be a number between 0 and 1');
        }

        if (!left !== !right) {
          return ephemeralText('Please provide a left and right prompt');
        }

        if (prompts_category && !Object.hasOwn(PROMPTS, prompts_category)) {
          return ephemeralText(
            `Unknown category. Pick one of: ${Object.keys(PROMPTS).join(', ')}`,
          );
        }

        const prompts =
          left && right
            ? [[left, right]]
            : (PROMPTS[prompts_category] ??
              ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)]);

        return new JsonResponse(
          await saveGamut(env, generate_message_embed(prompts, position)),
        );
      }

      case EMOTE_COMMAND.name.toLowerCase(): {
        const emoteUrl = interaction.data.options?.find(
          (option) => option.name === 'url',
        )?.value;

        const emoteName = interaction.data.options?.find(
          (option) => option.name === 'emote',
        )?.value;

        const guildId = interaction.guild_id ?? interaction.guild?.id;
        if (!guildId) {
          return ephemeralText('Run /emote inside a server.');
        }

        let emoteData;
        try {
          emoteData = await image_to_buffer(emoteUrl);
        } catch (err) {
          return ephemeralText(`Couldn't fetch that emote: ${err.message}`);
        }

        const response = await add_emoji(
          env.DISCORD_TOKEN,
          guildId,
          emoteName,
          emoteData,
        );

        if (!response.ok) {
          const err = await response.text();
          console.error('add_emoji failed:', response.status, err);
          return ephemeralText(
            `Failed to add ${emoteName} to the server! (${response.status})`,
          );
        }

        return ephemeralText(`Added ${emoteName} to the server!`);
      }

      case TEST_COMMAND.name.toLowerCase(): {
        const user = interactionUser(interaction);
        const guildId = interaction.guild_id ?? interaction.guild?.id;

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
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
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
