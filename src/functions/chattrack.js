const DISCORD_API = 'https://discord.com/api/v10';
// Emotes first: `\b` never matches before `<`, so `<:name:id>` loses to the
// alternation if it comes second.
const WORD_REGEX = /<a?:\w+:\d+>|\b\w{3,}\b/g;

/**
 * Fold a user's new messages in this channel into their word counts.
 * Returns updated chat data; `lastMessageId` is the watermark for the next run.
 */
export async function getStatsOnUser(interaction, userId, userChatData, token) {
  const words = { ...(userChatData?.words ?? {}) };
  const messages = await getUserMessages(
    interaction.channel_id,
    userId,
    userChatData?.lastMessageId,
    token,
  );

  for (const { content } of messages) {
    for (const word of content.match(WORD_REGEX) ?? []) {
      words[word] = (words[word] || 0) + 1;
    }
  }

  return {
    words,
    // messages is newest-first, so [0] is the new watermark.
    lastMessageId: messages[0]?.id ?? userChatData?.lastMessageId,
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
