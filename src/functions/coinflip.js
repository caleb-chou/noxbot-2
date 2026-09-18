import { InteractionResponseFlags } from 'discord-interactions';
import { InteractionResponseType } from 'discord-interactions';
import { JsonResponse, interactionUser } from '../util.js';

export async function coinFlip(interaction, ephemeral) {
  const result = Math.random() < 0.5 ? 'Heads! 💿' : 'Tails! 📀';
  const user = interactionUser(interaction);
  const body = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
        embeds: [
            {
              author: {
                name: `${user.username} flipped a coin!`,
                icon_url: user.avatar
                  ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                  : undefined,
              },
              description: `🪙 The coin spins...\n→ **${result}**`,
              color: 0xFFD700, // gold-ish
            },
          ]
    },
  };
  if (ephemeral) {
    body.data.flags = InteractionResponseFlags.EPHEMERAL;
  }
  return new JsonResponse(body);
}
