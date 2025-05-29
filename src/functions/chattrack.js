const DISCORD_API = 'https://discord.com/api/v10';
const WORD_REGEX = /\b(\w{3,}|<:\w+:\w+>)\b/g;


export async function getStatsOnUser(interaction, userId, userChatData, token) {
    const messages = await getUserMessages(interaction.channel_id, userId, userChatData?.lastMessageId, token);
    const filtered_messages = messages.filter(msg => WORD_REGEX.test(msg.content));

}

async function getUserMessages(channelId, userId, userLastMessageId, token) {
    const messages = [];
    let lastMessageId = null;

    do {
        const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
        url.searchParams.set('limit', 100);
        if (lastMessageId) {
            url.searchParams.set('before', lastMessageId);
        }
        
        if (userLastMessageId) {
            url.searchParams.set('after', userLastMessageId);
        }

        const res = await fetch(url, {
            headers: { Authorization: `Bot ${token}` },
        });

        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        const batch = await res.json();
        const filtered = batch.filter(msg => msg.author.id === userId);
        messages.push(...filtered);
        lastMessageId = batch[batch.length - 1].id;

    } while (batch.length > 0);

    return messages;
}