import {
  InteractionResponseFlags,
  InteractionResponseType,
} from 'discord-interactions';
import { interactionUser, avatarUrl } from '../util.js';

export function coinFlip(interaction, ephemeral) {
  const result = Math.random() < 0.5 ? 'Heads! 💿' : 'Tails! 📀';
  const user = interactionUser(interaction);
  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          author: {
            name: `${user.username} flipped a coin!`,
            icon_url: avatarUrl(user),
          },
          description: `🪙 The coin spins...\n→ **${result}**`,
          color: 0xffd700, // gold-ish
        },
      ],
      flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : undefined,
    },
  });
}
