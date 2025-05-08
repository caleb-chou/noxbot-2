/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
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
import { InteractionResponseFlags } from 'discord-interactions';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import { JsonResponse, sendMailNotification } from './util.js';
import { coinFlip } from './functions/coinflip.js';
import { eightBall } from './functions/eightball.js';
import { ALL_PROMPTS, createLengthWaveClueModal, createLengthWaveGuessModal, generate_gamut, generate_guess_response_message_embed, generate_guesser_message_embed, generate_message_embed, PROMPTS } from './functions/lengthwave.js';
import { createMailboxModal, createMailboxEmbed } from './functions/mailbox.js';
import { add_emoji, image_to_buffer } from './functions/emoji.js';

const router = AutoRouter();

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

      const mail = {
        sender: interaction.member.user.username,
        subject: subject,
        message: message,
        timestamp: new Date().toISOString(),
      }

      console.log(JSON.stringify(interaction.data))

      const id = env.NOXBOT_DATA.idFromName(recipient);
      const stub = env.NOXBOT_DATA.get(id);

      const res = await stub.fetch('https://dummy/addToMailbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mail),
      });
      const response = await res.json();

      const shouldNotify = await stub.fetch('https://dummy/getSettings', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      const userSettings = await shouldNotify.json();

      console.log(userSettings)
      if (userSettings.notifyForMail === 'true') {
        await sendMailNotification(recipient, env)
      }

      return (new JsonResponse({
        type: 4,
        data: {
          content: response.message,
          flags: InteractionResponseFlags.EPHEMERAL
        }
      }))
    }

    if (interaction.data.custom_id.startsWith('lengthwave_clue_modal')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      const clue = interaction.data.components?.[0]?.components?.find(
        (component) => component.custom_id === 'clue_input'
      )?.value;

      const id = env.NOXBOT_DATA.idFromName('lengthwave');
      const stub = env.NOXBOT_DATA.get(id);
      const res = await stub.fetch(`https://dummy/lengthwave?gameId=${game_id}`, {
        method: 'GET',
      });
      const game_data = await res.json();
      game_data.clue = clue;
      console.log(game_data)
      const message = generate_guesser_message_embed(game_id, game_data, interaction.member.user);



      return new JsonResponse(message);
    }

    if (interaction.data.custom_id.startsWith('lengthwave_guess_modal')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      const guess_value = interaction.data.components?.[0]?.components?.find(
        (component) => component.custom_id === 'guess_input'
      )?.value;

      const id = env.NOXBOT_DATA.idFromName('lengthwave');
      const stub = env.NOXBOT_DATA.get(id);
      const res = await stub.fetch(`https://dummy/lengthwave?gameId=${game_id}`, {
        method: 'GET',
      });
      const game_data = await res.json();
      console.log(game_data)
      const message = generate_guess_response_message_embed(game_id, game_data, guess_value, interaction.member.user);

      return new JsonResponse(message);
    }
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {

    const customId = interaction.data.custom_id;
    const user = interaction.member.user;

    if (customId === 'gamut_clue_button') {
      const game_id = interaction.message.embeds[0].footer.text;
      console.log(game_id)
      const response = createLengthWaveClueModal(game_id);
      console.log(response)
      return new JsonResponse(response);
    }

    if (customId === 'new_gamut_button') {
      const prompts = [["cool", "not cool"]];
      return new JsonResponse(
        generate_message_embed(
          prompts
        )
      );
    }

    if (customId.startsWith('gamut_guess_button')) {
      const game_id = interaction.data.custom_id.split('|')[1];
      return new JsonResponse(createLengthWaveGuessModal(game_id));
    }
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    console.debug(interaction.data);
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
        const hasAdmin =
          (BigInt(interaction.member.permissions) & BigInt(0x00000008)) !== 0n; // ADMINISTRATOR bit
        if (!hasAdmin) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "You don't have permission to use this command.",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
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

        const resolvedUser = interaction.data.resolved?.users?.[user];
        const username = resolvedUser?.username;

        const id = env.NOXBOT_DATA.idFromName(user);
        const stub = env.NOXBOT_DATA.get(id);
        const res = await stub.fetch('https://dummy/increment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: stat }),
        });
        const data = await res.json();

        console.log(data);

        let body = {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Incremented stat ${stat} to ${data[stat]} for user ${username}.`,
            flags: InteractionResponseFlags.EPHEMERAL,
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

        const id = env.NOXBOT_DATA.idFromName(userId);
        const stub = env.NOXBOT_DATA.get(id);
        const res = await stub.fetch('https://dummy/get');
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
          for (const [key, value] of Object.entries(data)) {
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
        const hasAdmin =
          (BigInt(interaction.member.permissions) & BigInt(0x00000008)) !== 0n; // ADMINISTRATOR bit

        if (!hasAdmin) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "You don't have permission to use this command.",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
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

        const resolvedUser = interaction.data.resolved?.users?.[user];

        const username = resolvedUser?.username;

        const id = env.NOXBOT_DATA.idFromName(user);
        const stub = env.NOXBOT_DATA.get(id);
        const res = await stub.fetch('https://dummy/set', {
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
        const hasAdmin =
          (BigInt(interaction.member.permissions) & BigInt(0x00000008)) !== 0n; // ADMINISTRATOR bit
        if (!hasAdmin) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "You don't have permission to use this command.",
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }
        const user = interaction.data.options?.find(
          (option) => option.name === 'user',
        )?.value;
        const ephemeral = interaction.data.options?.find(
          (option) => option.name === 'ephemeral',
        )?.value;
        const id = env.NOXBOT_DATA.idFromName(user);
        const stub = env.NOXBOT_DATA.get(id);
        const res = await stub.fetch('https://dummy/deleteAll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await res.json();
        console.log(data);
        let body = {
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
        const user = interaction.member?.user || interaction.user;
        const id = env.NOXBOT_DATA.idFromName(user.id);
        const stub = env.NOXBOT_DATA.get(id);

        const res = await stub.fetch('https://dummy/getMailbox');

        const response = await res.json()

        return new JsonResponse(createMailboxEmbed(user, response.mailbox))
      }

      case DELETE_MAIL_COMMAND.name.toLowerCase(): {
        const index = interaction.data.options?.find(
          (option) => option.name === 'index',
        )?.value;

        const user = interaction.member.user;
        const id = env.NOXBOT_DATA.idFromName(user.id);
        const stub = env.NOXBOT_DATA.get(id);

        const res = await stub.fetch('https://dummy/deleteMail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ index: index || -1 })
        });

        const response = await res.json()

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `${response.message}`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        })
      }

      case GET_SETTINGS_COMMAND.name.toLowerCase(): {
        const user = interaction.member.user;
        const id = env.NOXBOT_DATA.idFromName(user.id);
        const stub = env.NOXBOT_DATA.get(id);

        const res = await stub.fetch('https://dummy/getSettings')

        const response = await res.json()

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `${JSON.stringify(response)}`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        })
      }

      case UPDATE_SETTINGS_COMMAND.name.toLowerCase(): {
        const setting = interaction.data.options?.find(
          (option) => option.name === 'setting',
        )?.value;
        const value = interaction.data.options?.find(
          (option) => option.name === 'value',
        )?.value;

        const user = interaction.member.user;
        const id = env.NOXBOT_DATA.idFromName(user.id);
        const stub = env.NOXBOT_DATA.get(id);

        const res = await stub.fetch('https://dummy/updateSettings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ [setting]: value })
        });

        const response = await res.json()

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Updated the ${setting} value to ${value}`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        })
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
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'Position must be a number between 0 and 1',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        if ((!left || !right) && (left || right)) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'Please provide a left and right prompt',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        let prompts;

        if (left && right) {
          prompts = [[left, right]];
        } else {
          const selected = (prompts_category) ? PROMPTS[prompts_category] : undefined;
          prompts = selected ? selected : ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)];
        }

        console.log(position)
        const response_body = generate_message_embed(
          prompts,
          position
        );

        const id = env.NOXBOT_DATA.idFromName('lengthwave');
        const stub = env.NOXBOT_DATA.get(id);
        await stub.fetch('https://dummy/lengthwave', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ gameId: response_body.data.embeds[0].footer.text, game_data: response_body.data.game_data })
        });


        return new JsonResponse(
          response_body
        );
      }

      case EMOTE_COMMAND.name.toLowerCase(): {
        const emoteUrl = interaction.data.options?.find(
          (option) => option.name === 'url',
        )?.value;

        const emoteName = interaction.data.options?.find(
          (option) => option.name === 'emote',
        )?.value;

        console.log(emoteUrl)
        console.log(emoteName)

        const guild = interaction.guild;
        console.log(interaction.guild)
        const emoteData = await image_to_buffer(emoteUrl);
        console.log('got emote data')
        const response = await add_emoji(env.DISCORD_TOKEN, guild.id, emoteName, emoteData);

        if (!response.ok) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Failed to add ${emoteName} to the server!`,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          })
        }

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Added ${emoteName} to the server!`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        })
      }

      case TEST_COMMAND.name.toLowerCase(): {
        const user = interaction.member.user;
        const guild = interaction.guild;
        console.log(`Test Command Invoked by ${user.id} in guild ${guild.id}`);
        if (user.id === env.COOL_GUY) {
          console.log('Cool guy invoked function');
          const roleId = await createCoolRole(guild.id, env.DISCORD_TOKEN);
          const assignedRole = await assignRole(
            guild.id,
            user.id,
            roleId,
            env.DISCORD_TOKEN,
          );

          if (assignedRole.ok) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `You have been given the cool role!`,
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          } else {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `You are not the cool guy!`,
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }
        }
        break;
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
