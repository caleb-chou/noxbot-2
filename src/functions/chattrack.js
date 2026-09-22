import { DISCORD_API } from '../util.js';

// Emotes first: `\b` never matches before `<`, so `<:name:id>` loses to the
// alternation if it comes second.
const WORD_REGEX = /<a?:\w+:\d+>|\b\w{3,}\b/g;
const TOP_N = 15;

/** Newest message id in a channel, used as the "start counting here" watermark. */
export async function newestMessageId(channelId, token) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=1`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    throw new Error(`could not read #${channelId}: ${res.status} ${res.statusText}`);
  }
  const [newest] = await res.json();
  return newest?.id;
}

/**
 * Fold a user's new messages in this channel into their word counts.
 * Only counts forward from `chatData.lastMessageId` — backfilling a whole
 * channel would be tens of thousands of rate-limited requests.
 */
export async function getStatsOnUser(channelId, userId, chatData, token) {
  const words = { ...(chatData.words ?? {}) };
  const messages = await getUserMessages(
    channelId,
    userId,
    chatData.lastMessageId,
    token,
  );

  for (const { content } of messages) {
    for (const word of content.match(WORD_REGEX) ?? []) {
      words[word] = (words[word] || 0) + 1;
    }
  }

  return {
    words,
    messages: (chatData.messages ?? 0) + messages.length,
    // messages is newest-first, so [0] is the new watermark.
    lastMessageId: messages[0]?.id ?? chatData.lastMessageId,
  };
}

async function getUserMessages(channelId, userId, sinceMessageId, token) {
  const messages = [];
  let before = null;

  // Page backwards from newest until we reach the last message we already counted.
  for (;;) {
    const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
    url.searchParams.set('limit', '100');
    if (before) {
      url.searchParams.set('before', before);
    }

    const res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
    if (!res.ok) {
      throw new Error(`Failed to fetch messages: ${res.status} ${res.statusText}`);
    }

    const batch = await res.json();
    if (batch.length === 0) {
      return messages;
    }

    for (const msg of batch) {
      // Snowflakes sort chronologically.
      if (sinceMessageId && BigInt(msg.id) <= BigInt(sinceMessageId)) {
        return messages;
      }
      if (msg.author.id === userId) {
        messages.push(msg);
      }
    }

    before = batch[batch.length - 1].id;
  }
}

export function createChatStatsEmbed(user, chatData) {
  const top = Object.entries(chatData.words ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);

  return {
    embeds: [
      {
        author: {
          name: `${user.username}'s most used words`,
          icon_url: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : undefined,
        },
        description: top.length
          ? top.map(([word, n], i) => `${i + 1}. **${word}** — ${n}`).join('\n')
          : '_Nothing counted yet. Say something and run this again._',
        color: 0x5865f2,
        footer: { text: `${chatData.messages ?? 0} messages counted in this channel` },
      },
    ],
  };
}
