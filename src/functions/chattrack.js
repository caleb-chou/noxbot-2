const DISCORD_API = 'https://discord.com/api/v10';

export async function getStatsOnUser(interaction, userId, token) {

}

async function getUserMessages(channelId, userId, token) {
    const messages = [];
    let lastMessageId = null;
  
    while (true) {
      const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
      url.searchParams.set('limit', 100);
      if (lastMessageId) {
        url.searchParams.set('before', lastMessageId);
      }
  
      const res = await fetch(url, {
        headers: { Authorization: `Bot ${token}` },
      });
  
      if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
      const batch = await res.json();
      if (batch.length === 0) break;
  
      const filtered = batch.filter(msg => msg.author.id === userId);
      messages.push(...filtered);
  
      lastMessageId = batch[batch.length - 1].id;
    }
  
    return messages;
  }