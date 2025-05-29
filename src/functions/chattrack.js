const DISCORD_API = 'https://discord.com/api/v10';
const WORD_REGEX = /\b(\w{3,}|<:\w+:\w+>)\b/g;


export async function getStatsOnUser(interaction, userId, userChatData, token) {
    const messages = await getUserMessages(interaction.channel_id, userId, userChatData?.lastMessageId, token);
    messages.map(msg => msg.content).forEach(content => {
        const match = content.match(WORD_REGEX);
        if (match) {
            match.forEach(matchedWord => {
                userChatData.words[matchedWord] = (userChatData.words[matchedWord] || 0) + 1;
            });
        }
    })
    console.log(`Stats for user ${userId}:\n`, userChatData.words);
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