import { DISCORD_API, avatarUrl } from '../util.js';

// Emotes first: `\b` never matches before `<`, so `<:name:id>` loses to the
// alternation if it comes second.
const WORD_REGEX = /<a?:\w+:\d+>|\b\w{3,}\b/g;
const TOP_N = 15;
// Workers allow 50 subrequests per invocation on the free plan; leave room
// for the Durable Object calls around this.
const MAX_PAGES = 40;

// `content` comes back empty unless the Message Content intent is on in the
// dev portal.
async function fetchMessages(channelId, token, params) {
  const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) {
    throw new Error(`could not read <#${channelId}>: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Newest message id in a channel, used as the "start counting here" watermark. */
export async function newestMessageId(channelId, token) {
  const [newest] = await fetchMessages(channelId, token, { limit: 1 });
  return newest?.id;
}

/**
 * Fold a user's new messages in this channel into their word counts.
 * Pages forward from `chatData.lastMessageId`, at most MAX_PAGES per run, so
 * a busy channel catches up over several runs instead of failing every time.
 */
export async function getStatsOnUser(channelId, userId, chatData, token) {
  const words = { ...(chatData.words ?? {}) };
  let messages = chatData.messages ?? 0;
  let after = chatData.lastMessageId;
  let caughtUp = false;

  for (let page = 0; page < MAX_PAGES && !caughtUp; page++) {
    const batch = await fetchMessages(channelId, token, { after, limit: 100 });
    caughtUp = batch.length < 100;

    for (const msg of batch) {
      // Snowflakes sort chronologically; don't rely on the batch order.
      if (BigInt(msg.id) > BigInt(after)) {
        after = msg.id;
      }
      if (msg.author.id !== userId) {
        continue;
      }
      messages++;
      for (const word of msg.content.match(WORD_REGEX) ?? []) {
        words[word] = (words[word] || 0) + 1;
      }
    }
  }

  return { chatData: { words, messages, lastMessageId: after }, caughtUp };
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
          icon_url: avatarUrl(user),
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
