import { InteractionResponseFlags } from 'discord-interactions';
import { InteractionResponseType } from 'discord-interactions';
import { JsonResponse } from '../util.js';

export async function coinFlip(interaction, ephemeral) {
  const result = Math.random() < 0.5 ? 'Heads! 💿' : 'Tails! 📀';
  const user = interaction.member.user.nick;
  let body = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `🪙 ${user} flipped...\n→ ${result}!`,
    },
  };
  if (ephemeral) {
    body.data.flags = InteractionResponseFlags.EPHEMERAL;
  }
  return new JsonResponse(body);
}
