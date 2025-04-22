import { InteractionResponseFlags } from 'discord-interactions';
import { InteractionResponseType } from 'discord-interactions';
import { JsonResponse } from '../util.js';

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
export async function eightBall(question, interaction, ephemeral) {
  const result =
    eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
  let color;
  switch (result[1]) {
    case 0:
      color = 0x00ff00;
      break;
    case 1:
      color = 0xffff00;
      break;
    case 2:
      color = 0xff0000;
      break;
    default:
      color = 0x000000;
      break;
  }
  let body = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          author: {
            name: `${interaction.member.user.username} asked ${question}`,
            icon_url: interaction.member.user.avatar
              ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png`
              : undefined,
          },
          description: `🎱 8Ball says...\n→ **${result.answer}**`,
          color: color, // gold-ish
        },
      ],
    },
  };
  if (ephemeral) {
    body.data.flags = InteractionResponseFlags.EPHEMERAL;
  }
  return new JsonResponse(body);
}
