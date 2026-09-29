import {
  InteractionResponseFlags,
  InteractionResponseType,
} from 'discord-interactions';
import { interactionUser, avatarUrl } from '../util.js';

// [answer, mood]: 0 = yes, 1 = unsure, 2 = no
const eightBallResponses = [
  ['It is certain.', 0],
  ['It is decidedly so.', 0],
  ['Without a doubt.', 0],
  ['Yes definitely.', 0],
  ['You may rely on it.', 0],
  ['As I see it, yes.', 0],
  ['Most likely.', 0],
  ['Outlook good.', 0],
  ['Yes.', 0],
  ['Signs point to yes.', 0],
  ['Reply hazy, try again.', 1],
  ['Ask again later.', 1],
  ['Better not tell you now.', 1],
  ['Cannot predict now.', 1],
  ['Concentrate and ask again.', 1],
  ["Don't count on it.", 2],
  ['My reply is no.', 2],
  ['My sources say no.', 2],
  ['Outlook not so good.', 2],
  ['Very doubtful.', 2],
];
const MOOD_COLORS = [0x00ff00, 0xffff00, 0xff0000];

export function eightBall(question, interaction, ephemeral) {
  const user = interactionUser(interaction);
  const [answer, mood] =
    eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          author: {
            name: `${user.username} asked: "${question}"`,
            icon_url: avatarUrl(user),
          },
          description: `🎱 8Ball says...\n→ **${answer}**`,
          color: MOOD_COLORS[mood],
        },
      ],
      flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : undefined,
    },
  });
}
