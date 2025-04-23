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
} from './commands.js';
import { InteractionResponseFlags } from 'discord-interactions';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import { JsonResponse } from './util.js';
import { coinFlip } from './functions/coinflip.js';
import { eightBall } from './functions/eightball.js';

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
  console.log(env);

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
        console.log(id);
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
