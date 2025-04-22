/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { COINFLIP_COMMAND, GET_USER_DATA, INVITE_COMMAND, TEST_COMMAND, EIGHTBALL_COMMAND } from './commands.js';
import { InteractionResponseFlags } from 'discord-interactions';
import { createCoolRole, assignRole } from './functions/coolrole.js';
import { UserData } from './resources/UserData.js';
import { JsonResponse } from './util.js';
import { coinFlip } from './functions/coinflip.js';
import { eightBall } from './functions/eightball.js';
import { isAdmin } from './util.js';



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

      case GET_USER_DATA.name.toLowerCase(): {
        // if (!isAdmin(interaction)) {
        //   return new JsonResponse({
        //     type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        //     data: {
        //       content: `You can't do that!`,
        //       flags: InteractionResponseFlags.EPHEMERAL,
        //     }
        //   });
        // }
        console.log('id part')
        const id = env.NOXBOT_DATA.idFromName(interaction.member.user.id);
        console.log(id)
        console.log('get part')
        const stub = env.NOXBOT_DATA.get(id);
        console.log('id part')
        const res = await stub.fetch('https://dummy/increment');
        console.log('data part')
        const data = await res.json();

        console.log(data);

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `This is a test ${false}`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
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
        } break;
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