import { InteractionResponseFlags } from 'discord-interactions';
import { InteractionResponseType } from 'discord-interactions';
import { JsonResponse } from '../util.js';

export async function coinFlip(interaction, ephemeral) {
  const result = Math.random() < 0.5 ? 'Heads! 💿' : 'Tails! 📀';
  const user = interaction.member.user;
  let body = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
        embeds: [
            {
              title: "🪙 Coin Flip",
              description: `${user.username} flipped a...\n→ **${result}**`,
              color: 0xFFD700, // gold-ish
            }
          ]
    },
  };
  if (ephemeral) {
    body.data.flags = InteractionResponseFlags.EPHEMERAL;
  }
  return new JsonResponse(body);
}
