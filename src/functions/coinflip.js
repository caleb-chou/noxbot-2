import { InteractionResponseFlags } from 'discord-interactions';
import { InteractionResponseType } from 'discord-interactions';
import { JsonResponse } from '../util.js';

export async function coinFlip(interaction, ephemeral) {
  const result = Math.random() < 0.5 ? 'Heads! 💿' : 'Tails! 📀';
  let body = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
        embeds: [
            {
              author: {
                name: `${interaction.member.user.username} flipped a coin!`,
                icon_url: interaction.member.user.avatar 
                  ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png`
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
